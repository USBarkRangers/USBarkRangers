import BarkDomain
import MapKit
import XCTest

@testable import BarkRanger

nonisolated final class MapPresentationTests: XCTestCase {
    @MainActor
    private func park(_ id: String = "test", category: ParkCategory = .national) throws -> Park {
        Park(
            id: ParkID(rawValue: id), siteID: SiteID(rawValue: id), name: "Test park",
            coordinate: try XCTUnwrap(Coordinate(latitude: 44, longitude: -68)), category: category)
    }

    @MainActor
    func testReuseClearsPersonalAndSelectedAppearanceWithoutChangingIdentity() throws {
        XCTAssertNotNil(UIImage(named: "BarkBadge"))
        XCTAssertNotNil(UIImage(named: "BarkTag"))
        let first = try park()
        let annotation = ParkAnnotation(park: first)
        let view = ParkAnnotationView(annotation: annotation, reuseIdentifier: "park")
        view.configure(park: first, clustering: true, visited: true, inTrip: true)
        view.setSelected(true, animated: false)
        XCTAssertEqual(view.clusteringIdentifier, "parks")
        XCTAssertEqual(view.accessibilityValue, "Visited, In trip")
        XCTAssertTrue(view.accessibilityTraits.contains(.selected))
        XCTAssertTrue(view.annotation === annotation)
        view.prepareForReuse()
        XCTAssertNil(view.accessibilityValue)
        let next = try park("next", category: .state)
        view.annotation = ParkAnnotation(park: next)
        view.configure(park: next, clustering: false)
        XCTAssertFalse(view.isSelected)
        XCTAssertFalse(view.accessibilityTraits.contains(.selected))
        XCTAssertEqual(view.accessibilityValue, "")
        XCTAssertEqual(view.accessibilityIdentifier, "park-pin-next")
        XCTAssertNil(view.clusteringIdentifier)
    }

    @MainActor
    func testClusterReuseUsesExactMembershipAndRenderAllPinStates() throws {
        let park = try park()
        let canvas = UIView(frame: CGRect(x: 0, y: 0, width: 440, height: 160))
        canvas.backgroundColor = .lightGray
        for (index, flags) in [(false, false), (false, false), (true, false), (false, true), (true, true)]
            .enumerated()
        {
            let view = ParkAnnotationView(annotation: ParkAnnotation(park: park), reuseIdentifier: "park")
            view.configure(park: park, clustering: true, visited: flags.0, inTrip: flags.1)
            view.setSelected(index == 1 || index == 4, animated: false)
            view.center = CGPoint(x: 40 + index * 82, y: 40)
            canvas.addSubview(view)
        }
        let clusterView = ParkClusterView(annotation: nil, reuseIdentifier: "cluster")
        for count in [219, 2, 5000] {
            let members = (0..<count).map { _ in ParkAnnotation(park: park) }
            let cluster = MKClusterAnnotation(memberAnnotations: members)
            clusterView.annotation = cluster
            clusterView.configure(cluster)
            XCTAssertEqual(clusterView.accessibilityValue, String(count))
            XCTAssertEqual(cluster.memberAnnotations.count, count)
            XCTAssertNil(clusterView.clusteringIdentifier)
            clusterView.prepareForReuse()
        }
        for (index, count) in [2, 219, 5000].enumerated() {
            let cluster = MKClusterAnnotation(
                memberAnnotations: (0..<count).map { _ in ParkAnnotation(park: park) })
            let view = ParkClusterView(annotation: cluster, reuseIdentifier: "cluster")
            view.configure(cluster)
            view.center = CGPoint(x: 65 + index * 145, y: 120)
            canvas.addSubview(view)
        }
        let rendered = UIGraphicsImageRenderer(size: canvas.bounds.size).image {
            canvas.layer.render(in: $0.cgContext)
        }
        let attachment = XCTAttachment(image: rendered)
        attachment.name = "Normal, selected, visited, in-trip, combined; clusters 2, 219, 5000"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
