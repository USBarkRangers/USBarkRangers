import MapKit
import SwiftUI

/// The only SwiftUI/MapKit bridge. The MKMapView instance persists across catalog and filter changes.
struct NativeMapView: UIViewRepresentable {
    let model: MapFeatureModel
    var detailPosition = ParkSheetPosition.low
    var detailHeight: CGFloat = 0
    var detailMaximumHeight: CGFloat = 0
    var topObstruction: CGFloat = 0
    var interactionBegan: () -> Void = {}
    func makeCoordinator() -> MapCoordinator { MapCoordinator(model: model) }
    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
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
            target: context.coordinator, action: #selector(MapCoordinator.mapTapped(_:)))
        touchObserver.cancelsTouchesInView = false
        touchObserver.delaysTouchesEnded = false
        touchObserver.delegate = context.coordinator
        map.addGestureRecognizer(touchObserver)
        context.coordinator.interactionBegan = interactionBegan
        map.delegate = context.coordinator
        context.coordinator.apply(
            to: map, detailPosition: detailPosition, detailHeight: detailHeight,
            detailMaximumHeight: detailMaximumHeight, topObstruction: topObstruction)
        return map
    }
    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.interactionBegan = interactionBegan
        context.coordinator.apply(
            to: map, detailPosition: detailPosition, detailHeight: detailHeight,
            detailMaximumHeight: detailMaximumHeight, topObstruction: topObstruction)
    }
    static func dismantleUIView(_ map: MKMapView, coordinator: MapCoordinator) { map.delegate = nil }
}
