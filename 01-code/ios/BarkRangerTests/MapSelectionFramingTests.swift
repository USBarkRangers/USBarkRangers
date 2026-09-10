import BarkDomain
import MapKit
import XCTest

@testable import BarkRanger

nonisolated final class MapSelectionFramingTests: XCTestCase {
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
                to: map, annotation: nil, position: .low, maximumSheetHeight: 430, topObstruction: 100)
            let camera = map.camera
            camera.heading = heading
            map.setCamera(camera, animated: false)
            let distance = map.camera.centerCoordinateDistance
            framing.apply(
                to: map, annotation: annotation, position: .low, maximumSheetHeight: 430, topObstruction: 100)
            let point = map.convert(annotation.coordinate, toPointTo: map)
            XCTAssertLessThan(point.y, 314)
            XCTAssertGreaterThan(point.y, 164)
            XCTAssertEqual(map.camera.heading, heading, accuracy: 0.1)
            XCTAssertEqual(map.camera.centerCoordinateDistance, distance, accuracy: 10)
            XCTAssertTrue(map.annotations.contains { $0 === annotation })
            map.setCenter(.init(latitude: 44.5, longitude: -68.3), animated: false)
            let panned = map.centerCoordinate
            framing.apply(
                to: map, annotation: annotation, position: .low, maximumSheetHeight: 430, topObstruction: 100)
            XCTAssertEqual(map.centerCoordinate.latitude, panned.latitude, accuracy: 0.000001)
            XCTAssertEqual(map.centerCoordinate.longitude, panned.longitude, accuracy: 0.000001)
            framing.apply(
                to: map, annotation: annotation, position: .medium, maximumSheetHeight: 430,
                topObstruction: 100)
            XCTAssertLessThan(map.convert(annotation.coordinate, toPointTo: map).y, 314)
        }
        map.setCenter(annotation.coordinate, animated: false)
        framing.apply(
            to: map, annotation: annotation, position: .medium, cameraChanged: true, maximumSheetHeight: 430,
            topObstruction: 100)
        XCTAssertLessThan(map.convert(annotation.coordinate, toPointTo: map).y, 314)
        let distance = map.camera.centerCoordinateDistance
        framing.apply(to: map, annotation: annotation, position: .high)
        XCTAssertEqual(map.camera.centerCoordinateDistance, distance, accuracy: 10)
        XCTAssertEqual(map.layoutMargins.bottom, 8)
    }
}
