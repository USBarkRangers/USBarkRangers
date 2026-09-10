import BarkDomain
import MapKit
import SwiftUI
import XCTest

@testable import BarkRanger

nonisolated final class MapPresentationTests: XCTestCase {
    @MainActor
    func testDetailScrollLockLeavesHorizontalRowsEnabled() throws {
        let model = ParkDetailModel(maps: MapsHandoff(open: { _ in true }))
        model.show(try park())
        let content = ParkDetailView(
            model: model, position: .medium, allowsScrolling: false, bottomOverlap: 83,
            expand: {}, dismiss: {}, atTopChanged: { _ in })
        let host = UIHostingController(rootView: content)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        host.view.layoutIfNeeded()
        func scrollViews(in view: UIView) -> [UIScrollView] {
            (view as? UIScrollView).map { [$0] } ?? view.subviews.flatMap { scrollViews(in: $0) }
        }
        let outer = try XCTUnwrap(scrollViews(in: host.view).first)
        let rows = outer.subviews.flatMap { scrollViews(in: $0) }
        XCTAssertFalse(outer.isScrollEnabled)
        XCTAssertEqual(rows.count, 3)
        XCTAssertTrue(rows.allSatisfy(\.isScrollEnabled), "Tags, actions and thumbnails remain swipeable")
    }

    @MainActor
    func testTabBarSlideSharesSheetProgressAndRestoresNativeInteraction() {
        let controller = MapTabBarTransition.Controller()
        let tabs = UITabBarController()
        tabs.viewControllers = [controller]
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = tabs
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        tabs.view.layoutIfNeeded()
        controller.beginAppearanceTransition(true, animated: false)
        controller.endAppearanceTransition()
        let restingFrame = tabs.tabBar.frame
        let restingInsets = controller.view.safeAreaInsets
        let layout = ParkSheetLayout(availableHeight: 760, bottomOverlap: 83, searchHeight: 100)
        let medium = layout.height(at: .medium)
        let high = layout.height(at: .high)
        XCTAssertEqual(layout.chromeProgress(at: medium - 50), 0)
        controller.progress = layout.chromeProgress(at: (medium + high) / 2)
        controller.apply()
        XCTAssertEqual(controller.progress, 0.5, accuracy: 0.001)
        XCTAssertEqual(
            tabs.tabBar.layer.sublayerTransform.m42, (tabs.tabBar.bounds.height + 32) / 2, accuracy: 0.001)
        XCTAssertEqual(tabs.tabBar.frame, restingFrame, "Visual travel must never move UIKit’s layout frame")
        XCTAssertFalse(tabs.tabBar.isUserInteractionEnabled)
        XCTAssertTrue(tabs.tabBar.accessibilityElementsHidden)
        controller.progress = layout.chromeProgress(at: high + 50)
        controller.apply()
        XCTAssertEqual(controller.progress, 1)
        XCTAssertGreaterThanOrEqual(
            tabs.tabBar.frame.minY + tabs.tabBar.layer.sublayerTransform.m42, tabs.view.bounds.maxY)
        for _ in 0..<6 {
            // UIKit can re-layout while details scroll. Returning to medium must not accumulate offsets.
            tabs.view.setNeedsLayout()
            tabs.view.layoutIfNeeded()
            controller.progress = 0
            controller.apply()
            XCTAssertEqual(tabs.tabBar.frame, restingFrame)
            XCTAssertEqual(controller.view.safeAreaInsets, restingInsets)
            XCTAssertTrue(CATransform3DIsIdentity(tabs.tabBar.layer.sublayerTransform))
            controller.progress = 1
            controller.apply()
        }
        controller.reduceMotion = true
        controller.apply()
        XCTAssertTrue(CATransform3DIsIdentity(tabs.tabBar.layer.sublayerTransform))
        XCTAssertEqual(tabs.tabBar.alpha, 0)
        controller.beginAppearanceTransition(false, animated: false)
        controller.endAppearanceTransition()
        XCTAssertEqual(tabs.tabBar.alpha, 1)
        XCTAssertTrue(tabs.tabBar.isUserInteractionEnabled)
        XCTAssertFalse(tabs.tabBar.accessibilityElementsHidden)
        controller.apply()
        XCTAssertEqual(tabs.tabBar.alpha, 1, "An offscreen map must not hide another tab's controls")
    }

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
        XCTAssertEqual(view.displayPriority, .required)
        view.setSelected(true, animated: false)
        view.setSelected(false, animated: false)
        XCTAssertEqual(view.displayPriority, .required, "Ungrouped pins stay visible after deselection")
        view.configure(park: next, clustering: true)
        XCTAssertEqual(view.displayPriority, .defaultHigh)
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
