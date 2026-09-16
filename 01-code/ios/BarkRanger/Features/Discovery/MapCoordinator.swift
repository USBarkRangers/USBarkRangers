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
    private var personal = PersonalParkProjection.Value()
    private var numberedStops: [ParkID: [Int]] = [:]
    private var rawStopNumbers: [ParkID: [Int]] = [:]
    private var numberingRevision: Int64?
    private let basemap = OfflineBasemapOverlay(urlTemplate: nil)
    private let outlines = OfflineBasemapOverlay.loadOutlines()
    private var applying = false
    private var reduceMotion = false
    private var consumesMapTap = false
    // Current touch target only; the feature model remains the selection authority.
    private weak var tappedPark: ParkAnnotation?
    private weak var tappedPlace: PlaceAnnotation?
    private let places = MapPlaceAnnotations()
    private var tappedRoute: TripDayID?
    let routeOverlays = MapRouteOverlays()
    let expeditionOverlays = MapExpeditionRenderer()
    private let selectionFraming = MapSelectionFraming()
    init(model: MapFeatureModel) {
        self.model = model
        cameraID = model.cameraRequest?.id
    }

    func apply(
        to map: MKMapView, detailFramingHeight: CGFloat = 0, topObstruction: CGFloat = 0,
        reduceMotion: Bool = false
    ) {
        self.reduceMotion = reduceMotion
        applying = true
        defer { applying = false }
        updateAnnotations(on: map)
        updatePersonalAppearance(on: map)
        // Only viewport marker metadata plus selected/active-trip identities. Never
        // read the whole device library or future journal/photo bodies during panning.
        model.savedPlaces?.viewport(map.region, including:
            (model.routeDay?.draft?.trip.allStops ?? []) + [model.detail.place].compactMap { $0 })
        places.apply(
            model.personal?.value.places ?? [:], selected: model.detail.place,
            dayID: model.routeDay?.target?.dayID, saved: model.savedPlaces?.places ?? [:],
            showSaved: model.settings.value.showSavedPins, to: map)
        updateStopNumbers(on: map)
        updateSelectionGrouping(on: map)
        updateOverlays(on: map)
        routeOverlays.apply(model.routeDay?.visibleRoutes, selection: model.routeDay?.target, to: map)
        map.mapType =
            model.settings.value.mapStyle == .satellite && !model.usesOfflineMap ? .satellite : .standard
        let cameraChanged = model.cameraRequest?.id != cameraID
        if let request = model.cameraRequest, cameraChanged {
            cameraID = request.id
            if model.selectionID == nil {
                map.setRegion(request.region, animated: false)
            }
        }
        selectionFraming.apply(
            to: map,
            annotation: (model.selectedID.flatMap { annotations[$0] } as (any MKAnnotation)?)
                ?? places.selectedAnnotation,
            cameraChanged: cameraChanged,
            framingSheetHeight: detailFramingHeight, topObstruction: topObstruction,
            animated: !reduceMotion,
            focusRegion: cameraChanged ? model.cameraRequest?.region : nil)
        if let id = model.selectedID, visible.contains(id), let annotation = annotations[id],
            !map.selectedAnnotations.contains(where: { $0 === annotation })
        {
            map.selectAnnotation(annotation, animated: false)
        }
        if model.selectionID == nil {
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
                configure(view, park: park, grouping: view.clusteringIdentifier != nil)
            }
        }
        map.addAnnotations(
            (groupingChanged ? next : next.subtracting(visible)).compactMap { annotations[$0] })
        visible = next
    }
    private func groups(_ id: ParkID) -> Bool {
        model.settings.value.clustering && model.selectedID != id && numberedStops[id] == nil
    }
    private func configure(_ view: ParkAnnotationView, park: Park, grouping: Bool) {
        let value = model.personal?.value ?? .init()
        view.configure(
            park: park, clustering: grouping,
            visited: value.visited.contains(park.id) || park.aliases.contains(where: value.visited.contains),
            visitUnconfirmed: value.visitIsUnconfirmed(for: park),
            day: value.day(for: park), numbers: numberedStops[park.id] ?? [])
    }
    /// Numbering is a selected-day presentation projection, independent of search and road requests.
    private func updateStopNumbers(on map: MKMapView) {
        let dayID = model.routeDay?.target?.dayID ?? ""
        let raw = model.personal?.value.stopNumbers[dayID] ?? [:]
        let revision = model.catalogState.snapshot?.revision
        guard raw != rawStopNumbers || revision != numberingRevision else { return }
        rawStopNumbers = raw
        numberingRevision = revision
        var next: [ParkID: [Int]] = [:]
        for (id, numbers) in raw {
            if let canonical = model.catalogState.snapshot?.resolveAlias(id) {
                next[canonical, default: []].append(contentsOf: numbers)
            }
        }
        next = next.mapValues { $0.sorted() }
        guard next != numberedStops else { return }
        let previous = numberedStops
        numberedStops = next
        let changed = Set(previous.keys).union(next.keys).filter { previous[$0] != next[$0] }
        let regrouped = changed.filter {
            model.settings.value.clustering && (previous[$0] == nil) != (next[$0] == nil)
        }.compactMap { visible.contains($0) ? annotations[$0] : nil }
        if !regrouped.isEmpty {
            map.removeAnnotations(regrouped)
            map.addAnnotations(regrouped)
        }
        for id in changed {
            guard let annotation = annotations[id],
                let view = map.view(for: annotation) as? ParkAnnotationView
            else { continue }
            configure(view, park: annotation.park, grouping: groups(id))
        }
    }
    private func updatePersonalAppearance(on map: MKMapView) {
        let next = model.personal?.value ?? .init()
        guard next != personal else { return }
        let changed = next.changedMarkers(from: personal)
        personal = next
        for id in changed {
            guard let canonical = model.catalogState.snapshot?.resolveAlias(id),
                let annotation = annotations[canonical],
                let view = map.view(for: annotation) as? ParkAnnotationView
            else { continue }
            configure(view, park: annotation.park, grouping: view.clusteringIdentifier != nil)
        }
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
            map.removeOverlays(routeOverlays.overlays)
            map.addOverlay(basemap, level: .aboveLabels)
            map.addOverlays(outlines, level: .aboveLabels)
            map.addOverlays(routeOverlays.overlays, level: .aboveLabels)
        } else {
            map.removeOverlay(basemap)
            map.removeOverlays(outlines)
        }
    }
    func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
        if let renderer = expeditionOverlays.renderer(overlay) { return renderer }
        if let route = overlay as? DayRoutePolyline { return routeOverlays.renderer(for: route) }
        return MapOverlayRenderer.renderer(for: overlay)
    }
    func mapView(_ mapView: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
        if let place = annotation as? PlaceAnnotation { return places.view(for: place, on: mapView) }
        if let park = annotation as? ParkAnnotation,
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: "park", for: park)
                as? ParkAnnotationView
        {
            configure(view, park: park.park, grouping: groups(park.park.id))
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
        } else if let place = annotation as? PlaceAnnotation {
            model.selectPlace(
                .init(stop: place.stop, subtitle: place.stop.state), focusOnMap: false
            )
        } else if let cluster = annotation as? MKClusterAnnotation {
            model.cancelPlaceSelection()
            mapView.deselectAnnotation(cluster, animated: false)
            mapView.showAnnotations(cluster.memberAnnotations, animated: !reduceMotion)
        }
    }
    // Resolve a completed pin tap directly; native selection otherwise waits for competing gestures.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if let map = gestureRecognizer.view as? MKMapView { stopCameraMotion(on: map) }
        consumesMapTap = false
        tappedPark = nil
        tappedPlace = nil
        tappedRoute = nil
        interactionBegan()
        var view = touch.view
        while let current = view {
            if let annotationView = current as? MKAnnotationView {
                if let place = annotationView.annotation as? PlaceAnnotation {
                    tappedPlace = place
                    consumesMapTap = true
                    return true
                }
                guard let park = annotationView.annotation as? ParkAnnotation else { return false }
                tappedPark = park
                consumesMapTap = true
                return true
            }
            if current is UIControl { return false }
            view = current.superview
        }
        // Capture this touch's intent before dismissal clears selection. Consuming its first tap
        // stops MapKit from treating the next quick drag as the second half of one-finger zoom.
        if let map = gestureRecognizer.view as? MKMapView {
            tappedRoute = routeOverlays.target(at: touch.location(in: map), in: map)
        }
        consumesMapTap = tappedRoute != nil || model.selectionID != nil || model.routeDay?.target != nil
        return true
    }
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool { !consumesMapTap }
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        // Continuous navigation must start immediately rather than waiting for tap tolerance.
        if otherGestureRecognizer is UIPanGestureRecognizer
            || otherGestureRecognizer is UIPinchGestureRecognizer
            || otherGestureRecognizer is UIRotationGestureRecognizer
        {
            return false
        }
        guard consumesMapTap, let map = gestureRecognizer.view else { return false }
        return otherGestureRecognizer.view?.isDescendant(of: map) == true
    }
    @objc func mapTapped(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        defer {
            tappedPark = nil
            tappedPlace = nil
            tappedRoute = nil
        }
        if let tappedPark {
            model.selectPark(id: tappedPark.park.id, focusOnMap: false)
        } else if let tappedPlace {
            model.selectPlace(
                .init(stop: tappedPlace.stop, subtitle: tappedPlace.stop.state),
                focusOnMap: false)
        } else if let target = tappedRoute {
            model.selectRouteDay(target)
        } else if model.selectionID != nil {
            model.cancelPlaceSelection()
        } else {
            model.routeDay?.close()
        }
        if let map = recognizer.view as? MKMapView {
            routeOverlays.updateSelection(model.routeDay?.target, on: map)
        }
    }
    func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
        model.savedPlaces?.viewport(mapView.region, including:
            (model.routeDay?.draft?.trip.allStops ?? []) + [model.detail.place].compactMap { $0 })
        guard !selectionFraming.isAnimating else { return }
        model.cameraChanged(mapView.region)
    }
    func stopCameraMotion(on map: MKMapView) {
        guard selectionFraming.isAnimating else { return }
        selectionFraming.cancel()
        model.cameraChanged(map.region)
    }
}
