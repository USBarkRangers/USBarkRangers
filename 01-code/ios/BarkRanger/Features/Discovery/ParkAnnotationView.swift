import BarkDomain
import MapKit

/// Approved badge artwork with a consistent ring and optional personal-state accents.
final class ParkAnnotationView: MKAnnotationView {
    private let outline = CAShapeLayer()
    private let visitedRing = CAShapeLayer()
    private let selectionRing = CAShapeLayer()
    private let artwork = UIImageView()
    private let numberLabel = UILabel()
    private var baseColor = UIColor.black
    private var isVisited = false
    private var visitUnconfirmed = false
    private var dayColor: UIColor?
    private let pendingColor = UIColor(red: 1, green: 0.9, blue: 0.45, alpha: 1)

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        bounds = CGRect(x: 0, y: 0, width: 44, height: 54)
        centerOffset = CGPoint(x: 0, y: -27)
        collisionMode = .rectangle
        canShowCallout = false
        displayPriority = .defaultHigh
        isAccessibilityElement = true
        // Reduce padding while retaining artwork size, touch target, map anchor and clustering bounds.
        let badgeBounds = CGRect(x: 7, y: 15, width: 30, height: 36)
        let path = UIBezierPath(roundedRect: badgeBounds.insetBy(dx: 1.25, dy: 1.25), cornerRadius: 10.75)
        outline.path = path.cgPath
        outline.name = "park.state"
        layer.addSublayer(outline)
        visitedRing.name = "park.visited"
        // A short inner accent stays visible below the artwork without stacking a second full ring.
        let visitedPath = UIBezierPath()
        visitedPath.move(to: CGPoint(x: 18, y: 49.5))
        visitedPath.addQuadCurve(to: CGPoint(x: 26, y: 49.5), controlPoint: CGPoint(x: 22, y: 50.5))
        visitedRing.path = visitedPath.cgPath
        visitedRing.fillColor = UIColor.clear.cgColor
        visitedRing.strokeColor = UIColor.systemGreen.cgColor
        visitedRing.lineWidth = 0.8
        visitedRing.lineCap = .round
        layer.addSublayer(visitedRing)
        selectionRing.name = "park.selected"
        selectionRing.path =
            UIBezierPath(roundedRect: badgeBounds.insetBy(dx: -2, dy: -2), cornerRadius: 14).cgPath
        selectionRing.fillColor = UIColor.clear.cgColor
        selectionRing.strokeColor = UIColor.systemYellow.cgColor
        selectionRing.lineWidth = 4
        layer.addSublayer(selectionRing)
        artwork.frame = CGRect(x: 10, y: 18, width: 24, height: 30)
        artwork.contentMode = .scaleAspectFit
        artwork.layer.cornerRadius = 8
        artwork.clipsToBounds = true
        addSubview(artwork)
        numberLabel.font = .monospacedDigitSystemFont(ofSize: 9, weight: .bold)
        numberLabel.textAlignment = .center
        numberLabel.textColor = .label
        numberLabel.backgroundColor = .systemBackground
        numberLabel.layer.cornerRadius = 7.5
        numberLabel.clipsToBounds = true
        numberLabel.isUserInteractionEnabled = false
        numberLabel.isHidden = true
        addSubview(numberLabel)
        updateAppearance()
    }
    required init?(coder: NSCoder) { nil }

    func configure(
        park: Park, clustering: Bool, visited: Bool = false, visitUnconfirmed: Bool = false,
        day: TripDayColor.Assignment? = nil, numbers: [Int] = []
    ) {
        clusteringIdentifier = clustering ? "parks" : nil
        isVisited = visited
        self.visitUnconfirmed = visitUnconfirmed
        dayColor = day?.color.uiColor
        baseColor =
            park.category == .national ? .black : UIColor(red: 0.13, green: 0.59, blue: 0.95, alpha: 1)
        artwork.image = UIImage(named: park.category == .national ? "BarkBadge" : "BarkTag")
        accessibilityIdentifier = "park-pin-\(park.id.rawValue)"
        accessibilityLabel = "\(park.name), \(park.state), \(park.swag.rawValue)"
        numberLabel.text = numbers.map(String.init).joined(separator: ", ")
        numberLabel.isHidden = numbers.isEmpty
        numberLabel.frame = CGRect(
            x: 31, y: 9, width: max(15, numberLabel.intrinsicContentSize.width + 5), height: 15)
        accessibilityValue = [
            visited ? "Visited" : nil, day.map { "Day \($0.index + 1)" },
            visitUnconfirmed ? "Visit change not confirmed" : nil,
            numbers.isEmpty ? nil : "Stop \(numberLabel.text ?? "")",
        ].compactMap { $0 }
            .joined(
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
        visitUnconfirmed = false
        dayColor = nil
        baseColor = .black
        artwork.image = nil
        numberLabel.text = nil
        numberLabel.isHidden = true
        accessibilityLabel = nil
        accessibilityValue = nil
        clusteringIdentifier = nil
        setSelected(false, animated: false)
    }
    private func updateAppearance() {
        transform = isSelected ? CGAffineTransform(scaleX: 1.12, y: 1.12) : .identity
        // No grouping means no collision-based hiding, including after deselection or reuse.
        displayPriority = isSelected || clusteringIdentifier == nil ? .required : .defaultHigh
        // Restore the compact category-colored body. The default edge joins its fill, not a detached halo.
        outline.fillColor = baseColor.cgColor
        // Unconfirmed visits temporarily tint the state ring; bright yellow remains selection-only.
        outline.strokeColor =
            (visitUnconfirmed ? pendingColor : dayColor ?? (isVisited ? UIColor.systemGreen : baseColor))
            .cgColor
        outline.lineWidth = 2.5
        visitedRing.isHidden = visitUnconfirmed || !isVisited || dayColor == nil
        selectionRing.isHidden = !isSelected
        accessibilityTraits = isSelected ? [.button, .selected] : [.button]
    }
}
