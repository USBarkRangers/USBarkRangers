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
}
