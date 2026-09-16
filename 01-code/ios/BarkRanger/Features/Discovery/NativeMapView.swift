import MapKit
import SwiftUI

/// One native map for the app composition's lifetime. SwiftUI may remount its bridge after
/// backgrounding; retaining both the view and coordinator preserves warm tiles and route overlays.
@MainActor final class NativeMapSurface {
    let map = MKMapView()
    private var coordinator: MapCoordinator?
    private var configured = false

    func coordinator(for model: MapFeatureModel) -> MapCoordinator {
        if let coordinator { return coordinator }
        let value = MapCoordinator(model: model)
        coordinator = value
        return value
    }

    func mount(model: MapFeatureModel, coordinator: MapCoordinator) -> MKMapView {
        if !configured {
            map.register(ParkAnnotationView.self, forAnnotationViewWithReuseIdentifier: "park")
            map.register(ParkClusterView.self, forAnnotationViewWithReuseIdentifier: "cluster")
            map.pointOfInterestFilter = .excludingAll
            map.showsCompass = true
            map.showsScale = true
            map.setRegion(
                model.lastRegion ?? model.cameraRequest?.region
                    ?? MKCoordinateRegion(
                        center: CLLocationCoordinate2D(latitude: 38, longitude: -105),
                        span: MKCoordinateSpan(latitudeDelta: 60, longitudeDelta: 110)), animated: false)
            let touchObserver = UITapGestureRecognizer(
                target: coordinator, action: #selector(MapCoordinator.mapTapped(_:)))
            touchObserver.cancelsTouchesInView = false
            touchObserver.delaysTouchesEnded = false
            touchObserver.delegate = coordinator
            map.addGestureRecognizer(touchObserver)
            configured = true
        }
        map.delegate = coordinator
        return map
    }
}

/// The only SwiftUI/MapKit bridge. The MKMapView instance persists across catalog and filter changes.
struct NativeMapView: UIViewRepresentable {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.expeditionOverlay) private var expeditionOverlay
    let model: MapFeatureModel
    var detailFramingHeight: CGFloat = 0
    var topObstruction: CGFloat = 0
    var interactionBegan: () -> Void = {}
    func makeCoordinator() -> MapCoordinator { model.nativeMapSurface.coordinator(for: model) }
    func makeUIView(context: Context) -> MKMapView {
        let map = model.nativeMapSurface.mount(model: model, coordinator: context.coordinator)
        context.coordinator.interactionBegan = interactionBegan
        context.coordinator.apply(
            to: map, detailFramingHeight: detailFramingHeight, topObstruction: topObstruction,
            reduceMotion: reduceMotion)
        context.coordinator.expeditionOverlays.apply(expeditionOverlay, on: map)
        return map
    }
    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.interactionBegan = interactionBegan
        context.coordinator.apply(
            to: map, detailFramingHeight: detailFramingHeight, topObstruction: topObstruction,
            reduceMotion: reduceMotion)
        context.coordinator.expeditionOverlays.apply(expeditionOverlay, on: map)
    }
    static func dismantleUIView(_ map: MKMapView, coordinator: MapCoordinator) {
        coordinator.stopCameraMotion(on: map)
        map.delegate = nil
    }
}
