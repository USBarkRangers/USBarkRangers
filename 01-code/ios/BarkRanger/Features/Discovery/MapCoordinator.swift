import BarkDomain
import MapKit

/// Reconciles annotations by canonical ID; catalog updates never refit the camera or clear filters.
final class MapCoordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
    var interactionBegan: () -> Void = {}
    let model: MapFeatureModel
    private(set) var annotations: [ParkID: ParkAnnotation] = [:]
    private var visible = Set<ParkID>()
    private var cameraID: UUID?
    private var overview: Bool?
    private let basemap = OfflineBasemapOverlay(urlTemplate: nil)
    private let outlines = OfflineBasemapOverlay.loadOutlines()
    private var applying = false
    init(model: MapFeatureModel) {
        self.model = model
        cameraID = model.cameraRequest?.id
    }

    func apply(to map: MKMapView) {
        applying = true
        defer { applying = false }
        updateAnnotations(on: map)
        updateOverlays(on: map)
        map.mapType =
            model.settings.value.mapStyle == .satellite && !model.usesOfflineMap ? .satellite : .standard
        if let request = model.cameraRequest, request.id != cameraID {
            cameraID = request.id
            map.setRegion(request.region, animated: false)
        }
        if let id = model.selectedID, visible.contains(id), let annotation = annotations[id],
            !map.selectedAnnotations.contains(where: { $0 === annotation })
        {
            map.selectAnnotation(annotation, animated: false)
        }
        if model.selectedID == nil {
            for annotation in map.selectedAnnotations { map.deselectAnnotation(annotation, animated: false) }
        }
    }
    func updateAnnotations(on map: MKMapView) {
        let next = Set(model.result.matchingIDs)
        map.removeAnnotations(visible.subtracting(next).compactMap { annotations[$0] })
        let knownIDs = Set(model.catalogState.snapshot?.parks.map(\.id) ?? [])
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
                view.configure(park: park, clustering: model.settings.value.clustering)
            }
        }
        map.addAnnotations(next.subtracting(visible).compactMap { annotations[$0] })
        visible = next
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
            view.configure(park: park.park, clustering: model.settings.value.clustering)
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
            model.selectPark(id: park.park.id)
        } else if let cluster = annotation as? MKClusterAnnotation {
            mapView.showAnnotations(cluster.memberAnnotations, animated: true)
        }
    }
    // Observe touch-down, then decline recognition so native pan, zoom and pin taps continue normally.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        interactionBegan()
        return false
    }
    func mapViewDidFailLoadingMap(_ mapView: MKMapView, withError error: any Error) { model.imageryFailed() }
    func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
        model.cameraChanged(mapView.region)
    }
}
