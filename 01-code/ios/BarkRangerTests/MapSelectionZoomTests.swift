import BarkDomain
import MapKit
import XCTest

@testable import BarkRanger

nonisolated final class MapSelectionZoomTests: XCTestCase {
    @MainActor
    func testCoordinatorPinSelectionAtCloseZoomDoesNotResetNativeCamera() async throws {
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try await context.start()
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        map.register(ParkAnnotationView.self, forAnnotationViewWithReuseIdentifier: "park")
        map.register(ParkClusterView.self, forAnnotationViewWithReuseIdentifier: "cluster")
        let coordinator = MapCoordinator(model: context.model)
        map.delegate = coordinator
        let host = UIViewController()
        host.view = map
        let window = UIWindow(frame: map.frame)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            map.delegate = nil
            window.isHidden = true
        }
        coordinator.apply(to: map)
        for grouping in [true, false] {
            var settings = context.settings.value
            settings.clustering = grouping
            settings.rememberMapPosition = false
            context.settings.update(settings)
            coordinator.apply(to: map)
            for park in context.model.parks.prefix(2) {
                context.model.dismissPark()
                coordinator.apply(to: map)
                let annotation = try XCTUnwrap(coordinator.annotations[park.id])
                map.setCamera(
                    MKMapCamera(
                        lookingAtCenter: annotation.coordinate, fromDistance: 200, pitch: 0, heading: 0),
                    animated: false)
                map.layoutIfNeeded()
                try await Task.sleep(for: .milliseconds(100))
                let distance = map.camera.centerCoordinateDistance
                let priorRegion = try XCTUnwrap(context.model.lastRegion)
                coordinator.mapView(map, didSelect: annotation)
                for sample in 0..<30 {
                    coordinator.apply(to: map, detailFramingHeight: 480, topObstruction: 120)
                    XCTAssertEqual(map.camera.centerCoordinateDistance, distance, accuracy: 2)
                    if sample < 3 {
                        XCTAssertEqual(
                            context.model.lastRegion?.center.latitude, priorRegion.center.latitude,
                            "Intermediate animation frames must not publish or persist camera preferences")
                    }
                    try await Task.sleep(for: .milliseconds(16))
                }
                XCTAssertEqual(context.model.selectedID, park.id)
                XCTAssertEqual(
                    try XCTUnwrap(context.model.lastRegion).center.latitude,
                    map.region.center.latitude, accuracy: 0.000001)
                print(
                    "PINZOOM coordinator grouped=\(grouping) before=\(distance) after=\(map.camera.centerCoordinateDistance)"
                )
            }
        }
    }

    @MainActor
    func testAnimatedSelectionKeepsScaleThroughoutTheGlide() async throws {
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        let host = UIViewController()
        host.view = map
        let window = UIWindow(frame: map.frame)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        for distance in [150.0, 1500, 15000, 1_500_000, 15_000_000] {
            for pitch in [0.0, 45] {
                map.setCamera(
                    MKMapCamera(
                        lookingAtCenter: .init(latitude: 44.4, longitude: -68.2),
                        fromDistance: distance, pitch: pitch, heading: 38), animated: false)
                map.layoutIfNeeded()
                try await Task.sleep(for: .milliseconds(50))
                let framing = MapSelectionFraming()
                let original = try XCTUnwrap(map.camera.copy() as? MKMapCamera)
                for (index, point) in [CGPoint(x: 330, y: 650), CGPoint(x: 80, y: 210)].enumerated() {
                    let location = map.convert(point, toCoordinateFrom: map)
                    let coordinate = try XCTUnwrap(
                        Coordinate(latitude: location.latitude, longitude: location.longitude))
                    let annotation = ParkAnnotation(
                        park: Park(
                            id: ParkID(rawValue: "zoom-\(index)"), siteID: SiteID(rawValue: "zoom-\(index)"),
                            name: "Close park", coordinate: coordinate))
                    framing.apply(
                        to: map, annotation: annotation, framingSheetHeight: 480,
                        topObstruction: 120, animated: true)
                    var minimum = Double.greatestFiniteMagnitude
                    var maximum = 0.0
                    var centers: [Double] = []
                    for _ in 0..<30 {
                        let current = map.camera.centerCoordinateDistance
                        centers.append(map.centerCoordinate.latitude)
                        minimum = min(minimum, current)
                        maximum = max(maximum, current)
                        try await Task.sleep(for: .milliseconds(16))
                    }
                    print(
                        "PINZOOM requested=\(distance) pitch=\(pitch) before=\(original.centerCoordinateDistance) min=\(minimum) max=\(maximum) after=\(map.camera.centerCoordinateDistance)"
                    )
                    XCTAssertGreaterThan(Set(centers).count, 2, "The camera must glide, not jump")
                    XCTAssertEqual(
                        minimum, original.centerCoordinateDistance, accuracy: max(1, distance * 0.01))
                    XCTAssertEqual(
                        maximum, original.centerCoordinateDistance, accuracy: max(1, distance * 0.01))
                    XCTAssertEqual(map.camera.heading, original.heading, accuracy: 0.1)
                    XCTAssertEqual(map.camera.pitch, original.pitch, accuracy: 0.1)
                }
            }
        }
    }

    @MainActor
    func testRetargetAndCancellationPreserveZoomAndReleaseTheDisplayLinkOwner() async throws {
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        let host = UIViewController()
        host.view = map
        let window = UIWindow(frame: map.frame)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        map.setCamera(
            MKMapCamera(
                lookingAtCenter: .init(latitude: 38, longitude: -100),
                fromDistance: 15_000_000, pitch: 0, heading: 0), animated: false)
        let distance = map.camera.centerCoordinateDistance
        var framing: MapSelectionFraming? = MapSelectionFraming()
        weak var owner = framing
        for index in 0..<3 {
            let location = map.convert(CGPoint(x: index == 1 ? 80 : 320, y: 620), toCoordinateFrom: map)
            let park = Park(
                id: ParkID(rawValue: "rapid-\(index)"), siteID: SiteID(rawValue: "rapid"),
                name: "Rapid selection",
                coordinate: try XCTUnwrap(
                    Coordinate(latitude: location.latitude, longitude: location.longitude)))
            framing?.apply(
                to: map, annotation: ParkAnnotation(park: park),
                framingSheetHeight: 480, topObstruction: 120, animated: true)
            try await Task.sleep(for: .milliseconds(100))
            XCTAssertEqual(map.camera.centerCoordinateDistance, distance, accuracy: distance * 0.001)
            XCTAssertTrue(framing?.isAnimating == true)
        }
        framing?.cancel()
        let stopped = map.centerCoordinate
        try await Task.sleep(for: .milliseconds(350))
        XCTAssertEqual(map.centerCoordinate.latitude, stopped.latitude, accuracy: 0.000001)
        XCTAssertEqual(map.centerCoordinate.longitude, stopped.longitude, accuracy: 0.000001)
        framing = nil
        XCTAssertNil(owner, "A display link must not retain its framing owner")
        owner = nil
    }

}
