import MapKit
import SwiftUI

/// The only SwiftUI/MapKit bridge. The MKMapView instance persists across catalog and filter changes.
struct NativeMapView: UIViewRepresentable {
    let model: MapFeatureModel
    func makeCoordinator() -> MapCoordinator { MapCoordinator(model: model) }
    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "park")
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "cluster")
        map.pointOfInterestFilter = .excludingAll
        map.showsCompass = true
        map.showsScale = true
        map.setRegion(
            model.lastRegion ?? model.cameraRequest?.region
                ?? MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: 38, longitude: -105),
                    span: MKCoordinateSpan(latitudeDelta: 60, longitudeDelta: 110)), animated: false)
        map.delegate = context.coordinator
        context.coordinator.apply(to: map)
        return map
    }
    func updateUIView(_ map: MKMapView, context: Context) { context.coordinator.apply(to: map) }
    static func dismantleUIView(_ map: MKMapView, coordinator: MapCoordinator) { map.delegate = nil }
}
