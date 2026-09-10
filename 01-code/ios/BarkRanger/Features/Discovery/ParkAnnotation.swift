import BarkDomain
import MapKit

/// Stable annotation identity survives updates. MapKit reuses the corresponding marker views.
final class ParkAnnotation: NSObject, MKAnnotation {
    private(set) var park: Park
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var title: String? { park.name }
    var subtitle: String? { "\(park.state) · \(park.swag.rawValue)" }
    init(park: Park) {
        self.park = park
        coordinate = CLLocationCoordinate2D(
            latitude: park.coordinate.latitude, longitude: park.coordinate.longitude)
    }
    func update(_ park: Park) {
        guard self.park != park else { return }
        self.park = park
        let next = CLLocationCoordinate2D(
            latitude: park.coordinate.latitude, longitude: park.coordinate.longitude)
        if next.latitude != coordinate.latitude || next.longitude != coordinate.longitude {
            coordinate = next
        }
    }
    static func configure(_ view: MKMarkerAnnotationView, park: Park, clustering: Bool) {
        view.clusteringIdentifier = clustering ? "parks" : nil
        view.canShowCallout = false
        view.displayPriority = .defaultHigh
        view.glyphImage = UIImage(systemName: "pawprint.fill")
        view.glyphText = nil
        switch park.swag {
        case .tag: view.markerTintColor = .systemBlue
        case .bandana: view.markerTintColor = .systemOrange
        case .certificate: view.markerTintColor = .systemGreen
        case .other: view.markerTintColor = .systemGray
        }
        view.accessibilityLabel = "\(park.name), \(park.state), \(park.swag.rawValue)"
        view.accessibilityHint = "Opens park details"
    }
}
