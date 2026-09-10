import BarkDomain
import MapKit

/// Approved badge artwork with a consistent ring and optional personal-state accents.
final class ParkAnnotationView: MKAnnotationView {
    private let outline = CAShapeLayer()
    private let artwork = UIImageView()
    private let visitBadge = UIImageView(image: UIImage(systemName: "checkmark.circle.fill"))
    private let tripBadge = UIImageView(
        image: UIImage(systemName: "point.topleft.down.to.point.bottomright.curvepath"))
    private var baseColor = UIColor.black
    private var isVisited = false
    private var isInTrip = false

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        bounds = CGRect(x: 0, y: 0, width: 44, height: 54)
        centerOffset = CGPoint(x: 0, y: -27)
        collisionMode = .rectangle
        canShowCallout = false
        displayPriority = .defaultHigh
        isAccessibilityElement = true
        // Smaller artwork keeps the original touch target, map anchor and clustering bounds.
        let badgeBounds = CGRect(x: 3, y: 8, width: 38, height: 46)
        let path = UIBezierPath(roundedRect: badgeBounds.insetBy(dx: 1, dy: 1), cornerRadius: 17)
        outline.path = path.cgPath
        layer.addSublayer(outline)
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.25
        layer.shadowRadius = 3
        layer.shadowOffset = CGSize(width: 0, height: 2)
        layer.shadowPath = path.cgPath
        artwork.frame = CGRect(x: 8, y: 14, width: 28, height: 34)
        artwork.contentMode = .scaleAspectFit
        artwork.layer.cornerRadius = 8
        artwork.clipsToBounds = true
        addSubview(artwork)
        for (index, badge) in [visitBadge, tripBadge].enumerated() {
            badge.frame = CGRect(x: index == 0 ? 0 : 28, y: 4, width: 16, height: 16)
            badge.contentMode = .scaleAspectFit
            badge.backgroundColor = .white
            badge.layer.cornerRadius = 8
            addSubview(badge)
        }
        visitBadge.tintColor = .systemGreen
        tripBadge.tintColor = .systemPurple
    }
    required init?(coder: NSCoder) { nil }

    func configure(park: Park, clustering: Bool, visited: Bool = false, inTrip: Bool = false) {
        clusteringIdentifier = clustering ? "parks" : nil
        isVisited = visited
        isInTrip = inTrip
        baseColor =
            park.category == .national ? .black : UIColor(red: 0.13, green: 0.59, blue: 0.95, alpha: 1)
        artwork.image = UIImage(named: park.category == .national ? "BarkBadge" : "BarkTag")
        accessibilityIdentifier = "park-pin-\(park.id.rawValue)"
        accessibilityLabel = "\(park.name), \(park.state), \(park.swag.rawValue)"
        accessibilityValue = [visited ? "Visited" : nil, inTrip ? "In trip" : nil].compactMap { $0 }.joined(
            separator: ", ")
        accessibilityHint = "Opens park details"
        updateAppearance()
    }
    override func setSelected(_ selected: Bool, animated: Bool) {
        super.setSelected(selected, animated: animated)
        updateAppearance()
    }
    override func prepareForReuse() {
        super.prepareForReuse()
        isVisited = false
        isInTrip = false
        artwork.image = nil
        accessibilityLabel = nil
        accessibilityValue = nil
        clusteringIdentifier = nil
        setSelected(false, animated: false)
    }
    private func updateAppearance() {
        outline.fillColor = baseColor.cgColor
        outline.strokeColor =
            (isSelected ? UIColor.systemYellow : isVisited ? .systemGreen : isInTrip ? .systemPurple : .white)
            .cgColor
        outline.lineWidth = isSelected || isVisited || isInTrip ? 2 : 1.5
        visitBadge.isHidden = !isVisited
        tripBadge.isHidden = !isInTrip
        accessibilityTraits = isSelected ? [.button, .selected] : [.button]
    }
}
