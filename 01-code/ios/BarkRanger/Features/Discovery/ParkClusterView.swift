import MapKit

/// A larger dark logo/count bubble. Membership and zooming remain entirely MapKit-owned.
final class ParkClusterView: MKAnnotationView {
    private let outline = CAShapeLayer()
    private let artwork = UIImageView(image: UIImage(named: "BarkBadge"))
    private let countLabel = UILabel()

    override init(annotation: (any MKAnnotation)?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        outline.fillColor = UIColor.black.cgColor
        outline.lineWidth = 2
        layer.addSublayer(outline)
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.3
        layer.shadowRadius = 4
        layer.shadowOffset = CGSize(width: 0, height: 2)
        collisionMode = .rectangle
        displayPriority = .defaultHigh
        canShowCallout = false
        isAccessibilityElement = true
        artwork.contentMode = .scaleAspectFit
        artwork.layer.cornerRadius = 8
        artwork.clipsToBounds = true
        artwork.frame = CGRect(x: 9, y: 7, width: 32, height: 42)
        countLabel.font = .monospacedDigitSystemFont(ofSize: 19, weight: .bold)
        countLabel.textColor = .white
        countLabel.textAlignment = .center
        addSubview(artwork)
        addSubview(countLabel)
        accessibilityIdentifier = "park-cluster"
    }
    required init?(coder: NSCoder) { nil }

    func configure(_ cluster: MKClusterAnnotation) {
        let count = cluster.memberAnnotations.count
        let width = CGFloat(84 + max(0, String(count).count - 2) * 12)
        bounds = CGRect(x: 0, y: 0, width: width, height: 56)
        countLabel.frame = CGRect(x: 44, y: 0, width: width - 51, height: 56)
        countLabel.text = String(count)
        clusteringIdentifier = nil
        accessibilityLabel = "\(count) parks"
        accessibilityValue = String(count)
        accessibilityHint = "Zooms to show these parks"
        outline.path = UIBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 1), cornerRadius: 27).cgPath
        layer.shadowPath = outline.path
        setSelected(isSelected, animated: false)
    }
    override func setSelected(_ selected: Bool, animated: Bool) {
        super.setSelected(selected, animated: animated)
        outline.strokeColor = (selected ? UIColor.systemYellow : .white).cgColor
        accessibilityTraits = selected ? [.button, .selected] : [.button]
    }
    override func prepareForReuse() {
        super.prepareForReuse()
        countLabel.text = nil
        accessibilityLabel = nil
        accessibilityValue = nil
        setSelected(false, animated: false)
    }
}
