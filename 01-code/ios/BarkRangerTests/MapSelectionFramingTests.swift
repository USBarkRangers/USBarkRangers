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
                to: map, detailPosition: .medium, detailFramingHeight: 430, topObstruction: 100,
                reduceMotion: index == 2)
            XCTAssertEqual((map.selectedAnnotations.first as? ParkAnnotation)?.park.id, park.id)
            XCTAssertEqual(model.detail.park?.id, park.id)
        }
        XCTAssertEqual(map.centerAnimations, [true, true, false])
        for height in 200..<500 {
            coordinator.apply(
                to: map, detailPosition: .medium, detailHeight: CGFloat(height), detailFramingHeight: 430,
                topObstruction: 100, reduceMotion: true)
        }
        XCTAssertEqual(map.centerAnimations, [true, true, false], "Sheet movement must not restart a glide")
        let cluster = MKClusterAnnotation(memberAnnotations: Array(coordinator.annotations.values.prefix(2)))
        coordinator.mapView(map, didSelect: cluster)
        XCTAssertEqual(map.clusterAnimations, [false])
        coordinator.apply(
            to: map, detailPosition: .medium, detailFramingHeight: 430, topObstruction: 100,
            reduceMotion: false)
        coordinator.mapView(map, didSelect: cluster)
        XCTAssertEqual(map.clusterAnimations, [false, true])
        XCTAssertEqual(
            map.centerAnimations, [true, true, false], "Changing the preference must not replay motion")
    }

    @MainActor
    func testFramingPreservesZoomHeadingIdentityAndUserPanUntilDetentChanges() throws {
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
        let framing = MapSelectionFraming()
        for heading in [0.0, 38.0] {
            framing.apply(
                to: map, annotation: nil, position: .low, framingSheetHeight: 430, topObstruction: 100)
            let camera = map.camera
            camera.heading = heading
            map.setCamera(camera, animated: false)
            let distance = map.camera.centerCoordinateDistance
            framing.apply(
                to: map, annotation: annotation, position: .low, framingSheetHeight: 430, topObstruction: 100)
            let point = map.convert(annotation.coordinate, toPointTo: map)
            XCTAssertLessThan(point.y, 314)
            XCTAssertGreaterThan(point.y, 164)
            XCTAssertEqual(map.camera.heading, heading, accuracy: 0.1)
            XCTAssertEqual(map.camera.centerCoordinateDistance, distance, accuracy: 10)
            XCTAssertTrue(map.annotations.contains { $0 === annotation })
            map.setCenter(.init(latitude: 44.5, longitude: -68.3), animated: false)
            let panned = map.centerCoordinate
            framing.apply(
                to: map, annotation: annotation, position: .low, framingSheetHeight: 430, topObstruction: 100)
            XCTAssertEqual(map.centerCoordinate.latitude, panned.latitude, accuracy: 0.000001)
            XCTAssertEqual(map.centerCoordinate.longitude, panned.longitude, accuracy: 0.000001)
            framing.apply(
                to: map, annotation: annotation, position: .medium, framingSheetHeight: 430,
                topObstruction: 100)
            XCTAssertLessThan(map.convert(annotation.coordinate, toPointTo: map).y, 314)
        }
        map.setCenter(annotation.coordinate, animated: false)
        framing.apply(
            to: map, annotation: annotation, position: .medium, cameraChanged: true, framingSheetHeight: 430,
            topObstruction: 100)
        XCTAssertLessThan(map.convert(annotation.coordinate, toPointTo: map).y, 314)
        annotation.update(
            Park(
                id: park.id, siteID: park.siteID, name: park.name,
                coordinate: try XCTUnwrap(Coordinate(latitude: 45, longitude: -69))))
        framing.apply(
            to: map, annotation: annotation, position: .medium, framingSheetHeight: 430, topObstruction: 100)
        XCTAssertEqual(
            map.convert(annotation.coordinate, toPointTo: map).y, 290, accuracy: 1,
            "A corrected coordinate must reframe even when the selected ID is unchanged")
        let distance = map.camera.centerCoordinateDistance
        framing.apply(to: map, annotation: annotation, position: .high)
        XCTAssertEqual(map.camera.centerCoordinateDistance, distance, accuracy: 10)
        XCTAssertEqual(map.layoutMargins.bottom, 8)
    }
}

/// Captures native movement policy while keeping geometry assertions deterministic.
@MainActor
private final class MotionRecordingMap: MKMapView {
    var centerAnimations: [Bool] = []
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
        super.setCenter(coordinate, animated: false)
    }
    override func showAnnotations(_ annotations: [any MKAnnotation], animated: Bool) {
        clusterAnimations.append(animated)
    }
}
