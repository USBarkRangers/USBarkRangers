import BarkDomain
import MapKit

/// Reconciles annotations by canonical ID; catalog updates never refit the camera or clear filters.
final class MapCoordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
    var interactionBegan: () -> Void = {}
    let model: MapFeatureModel
    private(set) var annotations: [ParkID: ParkAnnotation] = [:]
    private var visible = Set<ParkID>()
    private var cameraID: UUID?
    private var annotationVersion: UInt64?
    private var clustering: Bool?
    private var renderedSelection: ParkID?
    private var overview: Bool?
    private let basemap = OfflineBasemapOverlay(urlTemplate: nil)
    private let outlines = OfflineBasemapOverlay.loadOutlines()
    private var applying = false
    private var reduceMotion = false
    private let selectionFraming = MapSelectionFraming()
    init(model: MapFeatureModel) {
        self.model = model
        cameraID = model.cameraRequest?.id
    }

    func apply(
        to map: MKMapView, detailPosition: ParkSheetPosition = .low, detailHeight: CGFloat = 0,
        detailFramingHeight: CGFloat = 0, topObstruction: CGFloat = 0, reduceMotion: Bool = false
    ) {
        self.reduceMotion = reduceMotion
        applying = true
        defer { applying = false }
        updateAnnotations(on: map)
        updateSelectionGrouping(on: map)
        updateOverlays(on: map)
        map.mapType =
            model.settings.value.mapStyle == .satellite && !model.usesOfflineMap ? .satellite : .standard
        let cameraChanged = model.cameraRequest?.id != cameraID
        if let request = model.cameraRequest, cameraChanged {
            cameraID = request.id
            map.setRegion(request.region, animated: false)
        }
        if let id = model.selectedID, visible.contains(id), let annotation = annotations[id],
            !map.selectedAnnotations.contains(where: { $0 === annotation })
        {
            map.selectAnnotation(annotation, animated: false)
        }
        selectionFraming.apply(
            to: map, annotation: model.selectedID.flatMap { annotations[$0] },
            position: detailPosition, sheetHeight: detailHeight, cameraChanged: cameraChanged,
            framingSheetHeight: detailFramingHeight, topObstruction: topObstruction,
            animated: !reduceMotion)
        if model.selectedID == nil {
            for annotation in map.selectedAnnotations { map.deselectAnnotation(annotation, animated: false) }
        }
    }
    private func updateAnnotations(on map: MKMapView) {
        guard annotationVersion != model.annotationVersion || clustering != model.settings.value.clustering
        else { return }
        let groupingChanged = clustering != nil && clustering != model.settings.value.clustering
        annotationVersion = model.annotationVersion
        clustering = model.settings.value.clustering
        let next = model.projection?.matchingIDs ?? []
        // Re-enroll the same objects when grouping changes; changing only materialized views leaves
        // MapKit's existing clusters and offscreen members using the previous grouping policy.
        map.removeAnnotations(
            (groupingChanged ? visible : visible.subtracting(next)).compactMap { annotations[$0] })
        let knownIDs = model.projection?.catalogIDs ?? []
        annotations = annotations.filter { knownIDs.contains($0.key) }
        for park in model.parks {
            if let annotation = annotations[park.id] {
                annotation.update(park)
            } else {
                annotations[park.id] = ParkAnnotation(park: park)
            }
            if let annotation = annotations[park.id],
                let view = map.view(for: annotation) as? ParkAnnotationView
            {
                // Refresh facts here; an attached member keeps its grouping until re-registration.
                view.configure(park: park, clustering: view.clusteringIdentifier != nil)
            }
        }
        map.addAnnotations(
            (groupingChanged ? next : next.subtracting(visible)).compactMap { annotations[$0] })
        visible = next
    }
    private func groups(_ id: ParkID) -> Bool {
        model.settings.value.clustering && model.selectedID != id
    }
    /// The selected park must remain a real pin, not disappear inside a native cluster.
    private func updateSelectionGrouping(on map: MKMapView) {
        let next = model.selectedID
        guard renderedSelection != next else { return }
        let changed = [renderedSelection, next].compactMap { $0 }
            .filter { visible.contains($0) }.compactMap { annotations[$0] }
        renderedSelection = next
        guard model.settings.value.clustering else { return }
        // Remove first: changing an attached member's grouping ID can invalidate its live cluster.
        // The delegate applies the new policy when MapKit requests its representation again.
        map.removeAnnotations(changed)
        map.addAnnotations(changed)
    }
    private func updateOverlays(on map: MKMapView) {
        guard overview != model.usesOfflineMap else { return }
        overview = model.usesOfflineMap
        if model.usesOfflineMap {
            map.addOverlay(basemap, level: .aboveLabels)
            map.addOverlays(outlines, level: .aboveLabels)
        } else {
            map.removeOverlay(basemap)
            map.removeOverlays(outlines)
        }
    }
    func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
        MapOverlayRenderer.renderer(for: overlay)
    }
    func mapView(_ mapView: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
        if let park = annotation as? ParkAnnotation,
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: "park", for: park)
                as? ParkAnnotationView
        {
            view.configure(park: park.park, clustering: groups(park.park.id))
            return view
        }
        if let cluster = annotation as? MKClusterAnnotation,
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: "cluster", for: cluster)
                as? ParkClusterView
        {
            view.configure(cluster)
            return view
        }
        return nil
    }
    func mapView(_ mapView: MKMapView, didSelect annotation: any MKAnnotation) {
        guard !applying else { return }
        if let park = annotation as? ParkAnnotation {
            model.selectPark(id: park.park.id, focusOnMap: false)
        } else if let cluster = annotation as? MKClusterAnnotation {
            model.dismissPark()
            mapView.deselectAnnotation(cluster, animated: false)
            mapView.showAnnotations(cluster.memberAnnotations, animated: !reduceMotion)
        }
    }
    // All touches collapse search; only a completed background tap dismisses park selection.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        interactionBegan()
        var view = touch.view
        while let current = view {
            if current is MKAnnotationView || current is UIControl { return false }
            view = current.superview
        }
        return true
    }
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool { true }
    @objc func mapTapped(_ recognizer: UITapGestureRecognizer) {
        if recognizer.state == .ended {
            model.dismissPark()
        }
    }
    func mapViewDidFailLoadingMap(_ mapView: MKMapView, withError error: any Error) { model.imageryFailed() }
    func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
        model.cameraChanged(mapView.region)
    }
}
