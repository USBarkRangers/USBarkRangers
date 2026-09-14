import BarkDomain
import MapKit

final class PlaceAnnotation: NSObject, MKAnnotation {
    private(set) var stop: Trip.Stop
    @objc dynamic var coordinate: CLLocationCoordinate2D
    var title: String? { stop.name }
    init?(stop: Trip.Stop) {
        guard let point = stop.coordinate else { return nil }
        self.stop = stop
        coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
    }
    func update(_ stop: Trip.Stop) {
        guard self.stop != stop, let point = stop.coordinate else { return }
        self.stop = stop
        if point.latitude != coordinate.latitude || point.longitude != coordinate.longitude {
            coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
        }
    }
}

/// Compact badge with the same day/selection meanings as park rings; never claims park membership.
final class PlaceAnnotationView: MKAnnotationView {
    var color: UIColor = .systemBlue
    var number: Int?
    var isSaved = false
    var savePending = false
    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        collisionMode = .circle
        displayPriority = .required
        canShowCallout = false
        isAccessibilityElement = true
    }
    required init?(coder: NSCoder) { nil }
    override func setSelected(_ selected: Bool, animated: Bool) {
        super.setSelected(selected, animated: false)
        image = UIGraphicsImageRenderer(size: CGSize(width: 48, height: 52)).image { context in
            let rect = CGRect(x: 7, y: 7, width: 34, height: 38)
            if selected {
                UIColor.systemYellow.setStroke()
                let outer = UIBezierPath(roundedRect: rect.insetBy(dx: -3, dy: -3), cornerRadius: 19)
                outer.lineWidth = 5
                outer.stroke()
            }
            (savePending ? UIColor(red: 1, green: 0.9, blue: 0.45, alpha: 1) : .secondarySystemBackground)
                .setFill()
            let badge = UIBezierPath(roundedRect: rect, cornerRadius: 16)
            badge.fill()
            color.setStroke()
            badge.lineWidth = 3
            badge.stroke()
            UIImage(
                systemName: isSaved ? "star.fill" : "mappin",
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold))?
                .withTintColor(.label, renderingMode: .alwaysOriginal).draw(
                    in: CGRect(x: 15, y: 15, width: 18, height: 23))
            if let number {
                let label = "\(number)" as NSString
                UIColor.systemBackground.setFill()
                UIBezierPath(ovalIn: CGRect(x: 31, y: 0, width: 17, height: 17)).fill()
                label.draw(
                    at: CGPoint(x: 35, y: 2),
                    withAttributes: [
                        .font: UIFont.boldSystemFont(ofSize: 10), .foregroundColor: UIColor.label,
                    ])
            }
        }
        accessibilityValue = [
            isSaved ? "Saved place" : nil, savePending ? "Waiting for server confirmation" : nil,
            selected ? "Selected" : nil,
        ]
        .compactMap { $0 }.joined(separator: ", ")
    }
}
