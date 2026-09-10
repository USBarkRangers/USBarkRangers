import BarkDomain
import MapKit
import SwiftUI
import XCTest

@testable import BarkRanger

nonisolated final class MapPresentationTests: XCTestCase {
    @MainActor
    func testDetailRevealGrowsGraduallyAndReversesWithoutScrolling() async throws {
        let model = ParkDetailModel(maps: MapsHandoff(open: { _ in true }))
        model.show(try park(name: "Acadia National Park Hulls Cove Visitor Center"))
        let layout = ParkSheetLayout(availableHeight: 760, bottomOverlap: 83, searchHeight: 100)
        func content(_ fraction: CGFloat) -> some View {
            let height =
                layout.height(at: .low)
                + (layout.height(at: .medium) - layout.height(at: .low)) * fraction
            return ParkDetailView(
                model: model, position: layout.presentation(at: height),
                expansion: layout.expansion(at: height), allowsScrolling: false,
                bottomOverlap: 83, expand: {}, dismiss: {}, atTopChanged: { _ in }
            ).frame(height: height - 32).frame(maxHeight: .infinity, alignment: .bottom)
        }
        let host = UIHostingController(rootView: content(0))
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousWindow = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 760)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            previousWindow?.makeKeyAndVisible()
        }
        func outerScroll(in view: UIView) -> UIScrollView? {
            (view as? UIScrollView) ?? view.subviews.lazy.compactMap { outerScroll(in: $0) }.first
        }
        var heights: [CGFloat] = []
        for fraction: CGFloat in [0, 0.02, 0.15, 0.4, 0.7, 1, 0.4, 0] {
            host.rootView = content(fraction)
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(20))
            let scroll = try XCTUnwrap(outerScroll(in: host.view))
            heights.append(scroll.contentSize.height)
            XCTAssertEqual(scroll.contentOffset.y, 0, accuracy: 1)
            XCTAssertFalse(scroll.isScrollEnabled)
            let image = UIGraphicsImageRenderer(size: window.bounds.size).image { _ in
                XCTAssertTrue(window.drawHierarchy(in: window.bounds, afterScreenUpdates: true))
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "Detail reveal \(fraction)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertLessThan(heights[1] - heights[0], 10, "A small lift must not install the full medium layout")
        for index in 1..<6 { XCTAssertGreaterThan(heights[index], heights[index - 1]) }
        XCTAssertEqual(heights[6], heights[3], accuracy: 1, "Reversing has no separate reveal state")
        XCTAssertEqual(heights[7], heights[0], accuracy: 1)
    }

    @MainActor
    func testDetailScrollLockLeavesHorizontalRowsEnabled() throws {
        let model = ParkDetailModel(maps: MapsHandoff(open: { _ in true }))
        model.show(try park())
        let content = ParkDetailView(
            model: model, position: .medium, expansion: 1, allowsScrolling: false, bottomOverlap: 83,
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
    func testTabBarFinishesShortSlideAtThresholdAndRestoresNativeInteraction() async throws {
        let controller = MapTabBarTransition.Controller()
        let tabs = UITabBarController()
        tabs.viewControllers = [controller, UIViewController()]
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousWindow = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = tabs
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            previousWindow?.makeKeyAndVisible()
        }
        tabs.view.layoutIfNeeded()
        try await waitForRendering { controller.isVisible }
        let restingFrame = tabs.tabBar.frame
        let restingInsets = controller.view.safeAreaInsets
        let layout = ParkSheetLayout(availableHeight: 760, bottomOverlap: 83, searchHeight: 100)
        let medium = layout.height(at: .medium)
        XCTAssertFalse(layout.hidesChrome(at: medium))
        controller.hidesChrome = layout.hidesChrome(at: medium + 20)
        try await waitForRendering {
            controller.apply()
            return tabs.tabBar.layer.animation(forKey: "bark.chrome") != nil
        }
        XCTAssertTrue(controller.hidesChrome)
        let travel = tabs.tabBar.bounds.height + 32
        XCTAssertEqual(tabs.tabBar.layer.sublayerTransform.m42, travel, accuracy: 0.001)
        XCTAssertEqual(tabs.tabBar.frame, restingFrame, "Visual travel must never move UIKit’s layout frame")
        XCTAssertFalse(tabs.tabBar.isUserInteractionEnabled)
        XCTAssertTrue(tabs.tabBar.accessibilityElementsHidden)
        let animation = try XCTUnwrap(tabs.tabBar.layer.animation(forKey: "bark.chrome"))
        XCTAssertLessThan(animation.duration, 0.3, "A slight drag beyond medium starts the whole quick slide")
        CATransaction.flush()
        try await waitForRendering {
            let y = tabs.tabBar.layer.presentation()?.sublayerTransform.m42 ?? 0
            return y > 1 && y < travel - 1
        }
        // Reverse while the outward slide is still visible; the next animation starts there.
        let visibleOffset = try XCTUnwrap(tabs.tabBar.layer.presentation()).sublayerTransform.m42
        controller.hidesChrome = false
        controller.apply()
        let reverse = try XCTUnwrap(tabs.tabBar.layer.animation(forKey: "bark.chrome") as? CAAnimationGroup)
        let move = try XCTUnwrap(reverse.animations?.first as? CABasicAnimation)
        let from = try XCTUnwrap(move.fromValue as? NSValue).caTransform3DValue.m42
        XCTAssertEqual(from, visibleOffset, accuracy: 4)
        CATransaction.flush()
        try await waitForRendering { abs(tabs.tabBar.layer.presentation()?.sublayerTransform.m42 ?? 0) < 0.5 }
        controller.hidesChrome = true
        controller.apply()
        CATransaction.flush()
        // Holding at medium + 20 must finish; no additional sheet movement is supplied.
        try await waitForRendering {
            abs((tabs.tabBar.layer.presentation()?.sublayerTransform.m42 ?? 0) - travel) < 0.5
        }
        XCTAssertGreaterThanOrEqual(tabs.tabBar.frame.minY + travel, tabs.view.bounds.maxY)
        for _ in 0..<6 {
            // UIKit can re-layout while details scroll. Returning to medium must not accumulate offsets.
            tabs.view.setNeedsLayout()
            tabs.view.layoutIfNeeded()
            controller.hidesChrome = false
            controller.apply()
            XCTAssertEqual(tabs.tabBar.frame, restingFrame)
            XCTAssertEqual(controller.view.safeAreaInsets, restingInsets)
            XCTAssertTrue(CATransform3DIsIdentity(tabs.tabBar.layer.sublayerTransform))
            controller.hidesChrome = true
            controller.apply()
        }
        controller.reduceMotion = true
        controller.apply()
        XCTAssertTrue(CATransform3DIsIdentity(tabs.tabBar.layer.sublayerTransform))
        XCTAssertEqual(tabs.tabBar.alpha, 0)
        tabs.selectedIndex = 1
        try await waitForRendering { tabs.tabBar.alpha == 1 && tabs.tabBar.isUserInteractionEnabled }
        XCTAssertEqual(tabs.tabBar.alpha, 1)
        XCTAssertTrue(tabs.tabBar.isUserInteractionEnabled)
        XCTAssertFalse(tabs.tabBar.accessibilityElementsHidden)
        controller.apply()
        XCTAssertEqual(tabs.tabBar.alpha, 1, "An offscreen map must not hide another tab's controls")
    }

    @MainActor
    private func waitForRendering(_ condition: () -> Bool) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        // Let UIKit's render loop advance between checks; a busy Task.yield loop can starve it.
        while !condition() && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(condition(), "Native presentation did not reach the expected frame")
    }

    @MainActor
    private func park(
        _ id: String = "test", category: ParkCategory = .national, name: String = "Test park"
    ) throws -> Park {
        Park(
            id: ParkID(rawValue: id), siteID: SiteID(rawValue: id), name: name,
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
        XCTAssertEqual(view.transform.a, 1.12, accuracy: 0.001)
        XCTAssertEqual(view.bounds.size, CGSize(width: 44, height: 54))
        view.prepareForReuse()
        XCTAssertNil(view.accessibilityValue)
        let next = try park("next", category: .state)
        view.annotation = ParkAnnotation(park: next)
        view.configure(park: next, clustering: false)
        XCTAssertFalse(view.isSelected)
        XCTAssertEqual(view.transform, .identity)
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
