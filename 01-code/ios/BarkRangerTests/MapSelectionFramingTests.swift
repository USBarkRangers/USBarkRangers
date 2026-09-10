import BarkDomain
import MapKit
import XCTest

@testable import BarkRanger

nonisolated final class MapSelectionFramingTests: XCTestCase {
    @MainActor
    func testGroupingChangesReenrollCanonicalAnnotationsAndPreserveSelection() async throws {
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try await context.start()
        let model = context.model
        let map = MotionRecordingMap(frame: CGRect(x: 0, y: 0, width: 390, height: 760))
        let coordinator = MapCoordinator(model: model)
        coordinator.apply(to: map)
        let original = coordinator.annotations
        let selected = try XCTUnwrap(model.parks.first)
        model.selectPark(id: selected.id, focusOnMap: false)
        coordinator.apply(to: map, reduceMotion: true)
        for grouping in [false, true, false] {
            var settings = context.settings.value
            settings.clustering = grouping
            context.settings.update(settings)
            coordinator.apply(to: map, reduceMotion: true)
            XCTAssertEqual(map.enrolled, Set(original.keys))
            XCTAssertEqual(map.removed, Set(original.keys))
            XCTAssertEqual(map.annotations.compactMap { $0 as? ParkAnnotation }.count, original.count)
            XCTAssertTrue(original.allSatisfy { coordinator.annotations[$0.key] === $0.value })
            XCTAssertEqual((map.selectedAnnotations.first as? ParkAnnotation)?.park.id, selected.id)
            XCTAssertEqual(model.detail.park?.id, selected.id)
        }
        let cluster = MKClusterAnnotation(memberAnnotations: Array(original.values.prefix(2)))
        coordinator.mapView(map, didSelect: cluster)
        coordinator.apply(to: map, reduceMotion: true)
        XCTAssertNil(model.selectedID, "Expanding a cluster must release the old park selection")
        XCTAssertTrue(map.selectedAnnotations.isEmpty)
    }

    @MainActor
    func testUngroupedNativePinsStayMaterializedAtSuccessiveZoomLevels() async throws {
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try await context.start()
        var settings = context.settings.value
        settings.clustering = false
        context.settings.update(settings)
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 760))
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
        let original = coordinator.annotations
        for span in [3.0, 15, 60, 3] {
            map.setRegion(
                .init(
                    center: .init(latitude: 41, longitude: -74),
                    span: .init(latitudeDelta: span, longitudeDelta: span)), animated: false)
            map.layoutIfNeeded()
            let inside = original.values.filter {
                map.bounds.insetBy(dx: 50, dy: 80).contains(map.convert($0.coordinate, toPointTo: map))
            }
            XCTAssertGreaterThan(inside.count, 1)
            try await eventually {
                inside.allSatisfy { annotation in
                    guard let view = map.view(for: annotation) else { return false }
                    return view.window != nil && !view.isHidden && view.alpha > 0
                        && view.displayPriority == .required && view.clusteringIdentifier == nil
                }
            }
            XCTAssertFalse(map.annotations.contains { $0 is MKClusterAnnotation })
            XCTAssertTrue(original.allSatisfy { coordinator.annotations[$0.key] === $0.value })
        }
    }

    @MainActor
    func testCoordinatorRetargetsLatestSelectionAndHonorsReduceMotionWithoutGeometryReplays() async throws {
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try await context.start()
        let model = context.model
        let map = MotionRecordingMap(frame: CGRect(x: 0, y: 0, width: 390, height: 760))
        let coordinator = MapCoordinator(model: model)
        coordinator.apply(to: map)
        let parks = Array(model.parks.prefix(3))
        XCTAssertEqual(parks.count, 3)
        for (index, park) in parks.enumerated() {
            // Select again before any queued work can run; only the latest identity may remain selected.
            model.selectPark(id: park.id, focusOnMap: false)
            coordinator.apply(
                to: map, detailFramingHeight: 430, topObstruction: 100,
                reduceMotion: index == 2)
            XCTAssertEqual((map.selectedAnnotations.first as? ParkAnnotation)?.park.id, park.id)
            XCTAssertEqual(model.detail.park?.id, park.id)
        }
        XCTAssertEqual(map.centerAnimations, [true, true, false])
        XCTAssertEqual(map.centerDurations, [0.3, 0.3, 0])
        for height in 200..<500 {
            coordinator.apply(
                to: map, detailFramingHeight: CGFloat(height),
                topObstruction: 100, reduceMotion: true)
        }
        XCTAssertEqual(map.centerAnimations, [true, true, false], "Sheet movement must not restart a glide")
        let cluster = MKClusterAnnotation(memberAnnotations: Array(coordinator.annotations.values.prefix(2)))
        coordinator.mapView(map, didSelect: cluster)
        XCTAssertEqual(map.clusterAnimations, [false])
        coordinator.apply(
            to: map, detailFramingHeight: 430, topObstruction: 100,
            reduceMotion: false)
        coordinator.mapView(map, didSelect: cluster)
        XCTAssertEqual(map.clusterAnimations, [false, true])
        XCTAssertEqual(
            map.centerAnimations, [true, true, false], "Changing the preference must not replay motion")
    }

    @MainActor
    func testLayoutChangesKeepCameraAndMarginsFixedAfterSelection() async throws {
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try await context.start()
        let park = try XCTUnwrap(context.model.parks.first)
        let map = MotionRecordingMap(frame: CGRect(x: 0, y: 0, width: 390, height: 760))
        map.setRegion(
            .init(
                center: .init(latitude: park.coordinate.latitude, longitude: park.coordinate.longitude),
                span: .init(latitudeDelta: 1, longitudeDelta: 1)), animated: false)
        let coordinator = MapCoordinator(model: context.model)
        coordinator.apply(to: map)
        context.model.selectPark(id: park.id, focusOnMap: false)
        coordinator.apply(
            to: map, detailFramingHeight: 430, topObstruction: 100, reduceMotion: true)
        let annotation = try XCTUnwrap(coordinator.annotations[park.id])
        let anchor = map.convert(annotation.coordinate, toPointTo: map)
        XCTAssertEqual(anchor.y, 290, accuracy: 1)
        let camera = map.camera.centerCoordinateDistance
        let margins = map.layoutMargins
        for height in [280.0, 430, 752, 430, 200] {
            coordinator.apply(
                to: map, detailFramingHeight: height, topObstruction: 100, reduceMotion: true)
            XCTAssertEqual(map.convert(annotation.coordinate, toPointTo: map).x, anchor.x, accuracy: 1)
            XCTAssertEqual(map.convert(annotation.coordinate, toPointTo: map).y, anchor.y, accuracy: 1)
            XCTAssertEqual(map.camera.centerCoordinateDistance, camera, accuracy: 1)
        }
        XCTAssertEqual(map.layoutMargins, margins)
        XCTAssertEqual(
            map.centerAnimations.count, 1, "Presentation layout changes must not command another pan")
    }

    @MainActor
    func testFramingPreservesZoomHeadingIdentityAndUserPanAcrossBrowsingDetents() throws {
        let coordinate = try XCTUnwrap(Coordinate(latitude: 44.4, longitude: -68.2))
        let park = Park(
            id: ParkID(rawValue: "acadia"), siteID: SiteID(rawValue: "acadia"),
            name: "Acadia", coordinate: coordinate)
        let annotation = ParkAnnotation(park: park)
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 760))
        map.setRegion(
            MKCoordinateRegion(
                center: annotation.coordinate,
                span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12)), animated: false)
        map.addAnnotation(annotation)
        let margins = map.layoutMargins
        let framing = MapSelectionFraming()
        for heading in [0.0, 38.0] {
            framing.apply(
                to: map, annotation: nil, framingSheetHeight: 430, topObstruction: 100)
            let camera = map.camera
            camera.heading = heading
            map.setCamera(camera, animated: false)
            let distance = map.camera.centerCoordinateDistance
            framing.apply(
                to: map, annotation: annotation, framingSheetHeight: 430, topObstruction: 100)
            let point = map.convert(annotation.coordinate, toPointTo: map)
            XCTAssertLessThan(point.y, 314)
            XCTAssertGreaterThan(point.y, 164)
            XCTAssertEqual(map.camera.heading, heading, accuracy: 0.1)
            XCTAssertEqual(map.camera.centerCoordinateDistance, distance, accuracy: 10)
            XCTAssertTrue(map.annotations.contains { $0 === annotation })
            map.setCenter(.init(latitude: 44.5, longitude: -68.3), animated: false)
            let panned = map.centerCoordinate
            framing.apply(
                to: map, annotation: annotation, framingSheetHeight: 430, topObstruction: 100)
            XCTAssertEqual(map.centerCoordinate.latitude, panned.latitude, accuracy: 0.000001)
            XCTAssertEqual(map.centerCoordinate.longitude, panned.longitude, accuracy: 0.000001)
            framing.apply(
                to: map, annotation: annotation, framingSheetHeight: 430,
                topObstruction: 100)
            XCTAssertEqual(map.centerCoordinate.latitude, panned.latitude, accuracy: 0.000001)
            XCTAssertEqual(map.centerCoordinate.longitude, panned.longitude, accuracy: 0.000001)
        }
        map.setCenter(annotation.coordinate, animated: false)
        framing.apply(
            to: map, annotation: annotation, cameraChanged: true, framingSheetHeight: 430,
            topObstruction: 100)
        XCTAssertLessThan(map.convert(annotation.coordinate, toPointTo: map).y, 314)
        annotation.update(
            Park(
                id: park.id, siteID: park.siteID, name: park.name,
                coordinate: try XCTUnwrap(Coordinate(latitude: 45, longitude: -69))))
        framing.apply(
            to: map, annotation: annotation, framingSheetHeight: 430, topObstruction: 100)
        XCTAssertEqual(
            map.convert(annotation.coordinate, toPointTo: map).y, 290, accuracy: 1,
            "A corrected coordinate must reframe even when the selected ID is unchanged")
        let distance = map.camera.centerCoordinateDistance
        framing.apply(to: map, annotation: annotation)
        XCTAssertEqual(map.camera.centerCoordinateDistance, distance, accuracy: 10)
        XCTAssertEqual(map.layoutMargins, margins)
    }
}

/// Captures native movement policy while keeping geometry assertions deterministic.
@MainActor
private final class MotionRecordingMap: MKMapView {
    var centerAnimations: [Bool] = []
    var centerDurations: [TimeInterval] = []
    var clusterAnimations: [Bool] = []
    var enrolled: Set<ParkID> = []
    var removed: Set<ParkID> = []
    override func addAnnotations(_ annotations: [any MKAnnotation]) {
        enrolled = Set(annotations.compactMap { ($0 as? ParkAnnotation)?.park.id })
        super.addAnnotations(annotations)
    }
    override func removeAnnotations(_ annotations: [any MKAnnotation]) {
        removed = Set(annotations.compactMap { ($0 as? ParkAnnotation)?.park.id })
        super.removeAnnotations(annotations)
    }
    override func setCenter(_ coordinate: CLLocationCoordinate2D, animated: Bool) {
        centerAnimations.append(animated)
        centerDurations.append(UIView.inheritedAnimationDuration)
        super.setCenter(coordinate, animated: false)
    }
    override func showAnnotations(_ annotations: [any MKAnnotation], animated: Bool) {
        clusterAnimations.append(animated)
    }
}
