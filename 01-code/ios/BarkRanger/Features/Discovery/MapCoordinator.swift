import BarkDomain
import MapKit

/// Everything the park map renders, resolved once per apply. Every reconciliation
/// pass and the delegate read this value, so no pass observes half-updated state.
struct MapRenderState: Equatable {
    let annotationVersion: UInt64
    let matchingIDs: Set<ParkID>
    let catalogIDs: Set<ParkID>
    let clustering: Bool
    let selectedID: ParkID?
    let stopNumbers: [ParkID: [Int]]
    let personal: PersonalParkProjection.Value
    let usesOfflineMap: Bool
    let cameraRequestID: UUID?
    let parks: [Park]
    private let catalogParks: [Park]
    private let rawStopNumbers: [ParkID: [Int]]
    private let catalogRevision: Int64?

    init(model: MapFeatureModel, previous: Self? = nil) {
        annotationVersion = model.annotationVersion
        matchingIDs = model.projection?.matchingIDs ?? []
        catalogIDs = model.projection?.catalogIDs ?? []
        clustering = model.settings.value.clustering
        selectedID = model.selectedID
        personal = model.personal?.value ?? .init()
        usesOfflineMap = model.usesOfflineMap
        cameraRequestID = model.cameraRequest?.id
        parks = model.parks
        let catalog = model.catalogState.snapshot
        catalogParks = catalog?.parks ?? []
        catalogRevision = catalog?.revision
        rawStopNumbers = personal.stopNumbers[model.routeDay?.target?.dayID ?? ""] ?? [:]
        // Share the previously resolved dictionary on layout/camera-only applies.
        // Alias resolution scans the catalog only when its revision or raw numbers change.
        if let previous, previous.rawStopNumbers == rawStopNumbers,
            previous.catalogRevision == catalogRevision
        {
            stopNumbers = previous.stopNumbers
        } else {
            var resolved: [ParkID: [Int]] = [:]
            for (id, numbers) in rawStopNumbers {
                if let canonical = catalog?.resolveAlias(id) {
                    resolved[canonical, default: []].append(contentsOf: numbers)
                }
            }
            stopNumbers = resolved.mapValues { $0.sorted() }
        }
    }
    /// The only definition of grouping, including during synchronous viewFor callbacks.
    func groups(_ id: ParkID) -> Bool {
        clustering && selectedID != id && stopNumbers[id] == nil
    }
    func resolveAlias(_ id: ParkID) -> ParkID? {
        catalogParks.first { $0.matchesIdentity(id) }?.id
    }
    func annotationsChanged(from previous: Self?) -> Bool {
        previous?.annotationVersion != annotationVersion || previous?.clustering != clustering
    }
}

/// Reconciles annotations by canonical ID; catalog updates never refit the camera or clear filters.
final class MapCoordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate {
    #if DEBUG
        // Logical configure count per apply pass. Never includes values.
        var configureObserver: (@Sendable (ParkID) -> Void)?
    #endif
    var interactionBegan: () -> Void = {}
    let model: MapFeatureModel
    private(set) var annotations: [ParkID: ParkAnnotation] = [:]
    private var rendered: MapRenderState?
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
    }

    func apply(
        to map: MKMapView, detailFramingHeight: CGFloat = 0, topObstruction: CGFloat = 0,
        reduceMotion: Bool = false
    ) {
        let next = MapRenderState(model: model, previous: rendered)
        let previous = rendered
        rendered = next
        self.reduceMotion = reduceMotion
        applying = true
        defer { applying = false }
        reconcileAnnotations(from: previous, to: next, on: map)
        reconcileMarkers(from: previous, to: next, on: map)
        reconcileStopNumbers(from: previous, to: next, on: map)
        reconcileSelectionGrouping(from: previous, to: next, on: map)
        reconcileOverlays(from: previous, to: next, on: map)
        // Only viewport marker metadata plus selected/active-trip identities. Never
        // read the whole device library or future journal/photo bodies during panning.
        model.savedPlaces?.viewport(
            map.region,
            including: (model.routeDay?.draft?.trip.allStops ?? []) + [model.detail.place].compactMap { $0 })
        places.apply(
            next.personal.places, selected: model.detail.place,
            dayID: model.routeDay?.target?.dayID, saved: model.savedPlaces?.places ?? [:],
            showSaved: model.settings.value.showSavedPins, to: map)
        routeOverlays.apply(model.routeDay?.visibleRoutes, selection: model.routeDay?.target, to: map)
        map.mapType =
            model.settings.value.mapStyle == .satellite && !next.usesOfflineMap ? .satellite : .standard
        // NativeMapView installs the initial camera before its first apply.
        let cameraChanged = previous.map { $0.cameraRequestID != next.cameraRequestID } ?? false
        if let request = model.cameraRequest, cameraChanged {
            if model.selectionID == nil {
                map.setRegion(request.region, animated: false)
            }
        }
        selectionFraming.apply(
            to: map,
            annotation: (next.selectedID.flatMap { annotations[$0] } as (any MKAnnotation)?)
                ?? places.selectedAnnotation,
            cameraChanged: cameraChanged,
            framingSheetHeight: detailFramingHeight, topObstruction: topObstruction,
            animated: !reduceMotion,
            focusRegion: cameraChanged ? model.cameraRequest?.region : nil)
        if let id = next.selectedID, next.matchingIDs.contains(id), let annotation = annotations[id],
            !map.selectedAnnotations.contains(where: { $0 === annotation })
        {
            map.selectAnnotation(annotation, animated: false)
        }
        if model.selectionID == nil {
            for annotation in map.selectedAnnotations { map.deselectAnnotation(annotation, animated: false) }
        }
    }
    private func reconcileAnnotations(
        from previous: MapRenderState?, to next: MapRenderState, on map: MKMapView
    ) {
        guard next.annotationsChanged(from: previous) else { return }
        let visible = previous?.matchingIDs ?? []
        let groupingChanged = previous != nil && previous?.clustering != next.clustering
        // Re-enroll the same objects when grouping changes, including offscreen members.
        map.removeAnnotations(
            (groupingChanged ? visible : visible.subtracting(next.matchingIDs)).compactMap { annotations[$0] }
        )
        annotations = annotations.filter { next.catalogIDs.contains($0.key) }
        for park in next.parks {
            if let annotation = annotations[park.id] {
                annotation.update(park)
            } else {
                annotations[park.id] = ParkAnnotation(park: park)
            }
            // A retained member whose policy changed is detached by the number/selection
            // pass before changing its grouping. New/re-enrolled members use the delegate.
            let needsRegroup = previous.map { $0.groups(park.id) != next.groups(park.id) } ?? false
            if !needsRegroup || groupingChanged,
                let annotation = annotations[park.id],
                let view = map.view(for: annotation) as? ParkAnnotationView
            {
                configure(view, park: park, in: next)
            }
        }
        map.addAnnotations(
            (groupingChanged ? next.matchingIDs : next.matchingIDs.subtracting(visible))
                .compactMap { annotations[$0] })
    }
    private func configure(_ view: ParkAnnotationView, park: Park, in state: MapRenderState) {
        #if DEBUG
            configureObserver?(park.id)
        #endif
        let value = state.personal
        view.configure(
            park: park, clustering: state.groups(park.id),
            visited: value.visited.contains(park.id) || park.aliases.contains(where: value.visited.contains),
            visitUnconfirmed: value.visitIsUnconfirmed(for: park),
            day: value.day(for: park), numbers: state.stopNumbers[park.id] ?? [])
    }
    private func reconcileMarkers(
        from previous: MapRenderState?, to next: MapRenderState, on map: MKMapView
    ) {
        guard previous?.personal != next.personal else { return }
        let changed = Set(
            next.personal.changedMarkers(from: previous?.personal ?? .init())
                .compactMap { next.resolveAlias($0) })
        for id in changed {
            // Other passes already carry the full appearance, including day color.
            guard previous?.stopNumbers[id] == next.stopNumbers[id],
                previous.map({ $0.groups(id) == next.groups(id) }) ?? true,
                !(next.annotationsChanged(from: previous) && next.matchingIDs.contains(id)),
                let annotation = annotations[id],
                let view = map.view(for: annotation) as? ParkAnnotationView
            else { continue }
            configure(view, park: annotation.park, in: next)
        }
    }
    /// Numbering is a selected-day presentation projection, independent of search and road requests.
    private func reconcileStopNumbers(
        from previous: MapRenderState?, to next: MapRenderState, on map: MKMapView
    ) {
        guard previous?.stopNumbers != next.stopNumbers else { return }
        // First-time and globally re-enrolled annotations already read the complete snapshot.
        guard let previous, previous.clustering == next.clustering else { return }
        let changed = Set(previous.stopNumbers.keys).union(next.stopNumbers.keys).filter {
            previous.stopNumbers[$0] != next.stopNumbers[$0]
                && previous.matchingIDs.contains($0) && next.matchingIDs.contains($0)
        }
        let regrouped = changed.filter { previous.groups($0) != next.groups($0) }
            .compactMap { annotations[$0] }
        if !regrouped.isEmpty {
            map.removeAnnotations(regrouped)
            map.addAnnotations(regrouped)
        }
        for id in changed {
            if next.annotationsChanged(from: previous), previous.groups(id) == next.groups(id) { continue }
            guard let annotation = annotations[id],
                let view = map.view(for: annotation) as? ParkAnnotationView
            else { continue }
            // Refresh any attached representation as well: MapKit can reuse it without
            // a synchronous delegate request. Both paths read the same complete state.
            configure(view, park: annotation.park, in: next)
        }
    }
    /// The selected park must remain a real pin, not disappear inside a native cluster.
    private func reconcileSelectionGrouping(
        from previous: MapRenderState?, to next: MapRenderState, on map: MKMapView
    ) {
        guard previous?.selectedID != next.selectedID else { return }
        guard let previous, previous.clustering == next.clustering else { return }
        let changed = Set([previous.selectedID, next.selectedID].compactMap { $0 }).filter {
            previous.matchingIDs.contains($0) && next.matchingIDs.contains($0)
                && previous.groups($0) != next.groups($0)
                && previous.stopNumbers[$0] == next.stopNumbers[$0]
        }.compactMap { annotations[$0] }
        guard !changed.isEmpty else { return }
        // Remove first: changing an attached member's grouping can invalidate its live cluster.
        map.removeAnnotations(changed)
        map.addAnnotations(changed)
    }
    private func reconcileOverlays(
        from previous: MapRenderState?, to next: MapRenderState, on map: MKMapView
    ) {
        guard previous?.usesOfflineMap != next.usesOfflineMap else { return }
        if next.usesOfflineMap {
            // Changing connectivity must not detach and recreate completed route lines.
            // Insert the bundled fallback underneath the existing foreground overlays so
            // their objects/renderers stay warm through Airplane Mode and foregrounding.
            let foreground = map.overlays.first { overlay in
                overlay !== basemap && !outlines.contains { $0 === overlay }
            }
            if let foreground {
                map.insertOverlay(basemap, below: foreground)
                for outline in outlines { map.insertOverlay(outline, below: foreground) }
            } else {
                map.addOverlay(basemap, level: .aboveLabels)
                map.addOverlays(outlines, level: .aboveLabels)
            }
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
        if let park = annotation as? ParkAnnotation, let state = rendered,
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: "park", for: park)
                as? ParkAnnotationView
        {
            configure(view, park: park.park, in: state)
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
        model.savedPlaces?.viewport(
            mapView.region,
            including: (model.routeDay?.draft?.trip.allStops ?? []) + [model.detail.place].compactMap { $0 })
        guard !selectionFraming.isAnimating else { return }
        model.cameraChanged(mapView.region)
    }
    func stopCameraMotion(on map: MKMapView) {
        guard selectionFraming.isAnimating else { return }
        selectionFraming.cancel()
        model.cameraChanged(map.region)
    }
}
