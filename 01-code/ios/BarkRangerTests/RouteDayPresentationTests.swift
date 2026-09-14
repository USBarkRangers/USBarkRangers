import BarkDomain
import MapKit
import XCTest

@testable import BarkRanger

nonisolated final class RouteDayPresentationTests: XCTestCase {
    @MainActor func testRouteHitSelectionAndGeometryUpdatesNeverMoveCameraOrRebuildPins() async throws {
        let a = try XCTUnwrap(Coordinate(latitude: 44, longitude: -68))
        let b = try XCTUnwrap(Coordinate(latitude: 44, longitude: -67.9))
        let c = try XCTUnwrap(Coordinate(latitude: 44.1, longitude: -67.9))
        var trip = Trip(
            id: "trip",
            days: [
                .init(id: "one", stops: [.init(name: "A", coordinate: a), .init(name: "B", coordinate: b)]),
                .init(id: "two", stops: [.init(name: "C", coordinate: c)]),
            ])
        var requests = 0
        let service = DayRouteService { segment in
            requests += 1
            let coordinates = try [segment.from, segment.to].map { stop in
                let c = try XCTUnwrap(stop.coordinate)
                return CLLocationCoordinate2D(latitude: c.latitude, longitude: c.longitude)
            }
            return .init(
                polyline: MKPolyline(coordinates: coordinates, count: coordinates.count), meters: 1000,
                seconds: 100)
        }
        service.update(tripID: trip.id, plan: TripRoutePlan.build(trip), preferredDay: "one", permitted: true)
        try await eventually { !service.isLoading }
        let map = RouteRecordingMap(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        map.setRegion(
            .init(
                center: .init(latitude: 44.04, longitude: -67.95),
                span: .init(latitudeDelta: 0.4, longitudeDelta: 0.4)), animated: false)
        let overlays = MapRouteOverlays()
        let selected = TripDayID(tripID: trip.id, dayID: "one")
        overlays.apply(service, selection: selected, to: map)
        XCTAssertEqual(overlays.overlays.count, 4)
        let ids = Set(overlays.overlays.map(ObjectIdentifier.init))
        let region = map.region
        map.clearCounts()
        for index in 0..<300 {
            overlays.apply(service, selection: index.isMultiple(of: 2) ? selected : nil, to: map)
        }
        XCTAssertEqual(Set(overlays.overlays.map(ObjectIdentifier.init)), ids)
        XCTAssertEqual(map.overlayMutations, 0)
        XCTAssertEqual(map.annotationMutations, 0)
        XCTAssertEqual(map.region.center.latitude, region.center.latitude, accuracy: 0.000001)
        XCTAssertEqual(map.region.span.latitudeDelta, region.span.latitudeDelta, accuracy: 0.000001)
        let mid = map.convert(CLLocationCoordinate2D(latitude: 44, longitude: -67.95), toPointTo: map)
        XCTAssertEqual(overlays.target(at: mid, in: map), selected)
        XCTAssertEqual(overlays.target(at: CGPoint(x: mid.x, y: mid.y + 10), in: map), selected)
        XCTAssertNil(overlays.target(at: CGPoint(x: mid.x, y: mid.y + 45), in: map))
        overlays.apply(service, selection: selected, to: map)
        let line = try XCTUnwrap(overlays.overlays.first { $0.owner == selected && !$0.isCasing })
        let other = try XCTUnwrap(overlays.overlays.first { $0.owner != selected && !$0.isCasing })
        XCTAssertEqual(overlays.renderer(for: line).lineWidth, 9)
        XCTAssertFalse(overlays.renderer(for: line).shouldRasterize)
        XCTAssertTrue(overlays.renderer(for: line) === overlays.renderer(for: line))
        XCTAssertEqual(overlays.renderer(for: other).lineWidth, 6)
        XCTAssertEqual(overlays.renderer(for: line).strokeColor, TripDayColor.palette[0].uiColor)
        XCTAssertEqual(
            try XCTUnwrap(overlays.renderer(for: other).strokeColor).cgColor.alpha, 0.55, accuracy: 0.01)
        XCTAssertEqual(other.routeColor, TripDayColor.palette[1].uiColor)
        let retained = overlays.renderer(for: line)
        let otherRetained = overlays.renderer(for: other)
        let nextDay = try XCTUnwrap(other.owner)
        let selectedCasing = try XCTUnwrap(overlays.overlays.first { $0.owner == selected && $0.isCasing })
        let otherCasing = try XCTUnwrap(overlays.overlays.first { $0.owner == nextDay && $0.isCasing })
        XCTAssertEqual(overlays.renderer(for: selectedCasing).strokeColor?.cgColor.alpha, 1)
        XCTAssertEqual(overlays.renderer(for: otherCasing).strokeColor?.cgColor.alpha, 0)
        XCTAssertNil(map.renderer(for: line))
        overlays.updateSelection(nextDay, on: map)
        XCTAssertEqual(overlays.renderer(for: selectedCasing).strokeColor?.cgColor.alpha, 0)
        XCTAssertEqual(overlays.renderer(for: otherCasing).strokeColor?.cgColor.alpha, 1)
        XCTAssertEqual(retained.lineWidth, 6)
        XCTAssertEqual(
            otherRetained.lineWidth, 9, "First selection updates even an unattached native renderer")
        XCTAssertEqual(otherRetained.strokeColor, other.routeColor)
        XCTAssertEqual((map.overlays.last as? DayRoutePolyline)?.owner, nextDay)
        overlays.updateSelection(selected, on: map)
        XCTAssertEqual(retained.lineWidth, 9)
        XCTAssertEqual((map.overlays.last as? DayRoutePolyline)?.owner, selected)
        overlays.updateSelection(nil, on: map)
        XCTAssertTrue(overlays.overlays.filter(\.isCasing).allSatisfy {
            overlays.renderer(for: $0).strokeColor?.cgColor.alpha == 0
        })
        overlays.updateSelection(selected, on: map)
        // Basemap/offline transitions reattach the same ordered overlays without losing emphasis.
        map.removeOverlays(overlays.overlays)
        map.addOverlays(overlays.overlays, level: .aboveLabels)
        XCTAssertEqual((map.overlays.last as? DayRoutePolyline)?.owner, selected)
        XCTAssertTrue(overlays.renderer(for: line) === retained)
        let before = requests
        trip.days[0].color = TripDayColor.palette[2].hex
        service.update(tripID: trip.id, plan: TripRoutePlan.build(trip), preferredDay: "one", permitted: true)
        map.clearCounts()
        overlays.apply(service, selection: selected, to: map)
        XCTAssertEqual(overlays.renderer(for: line).strokeColor, TripDayColor.palette[2].uiColor)
        XCTAssertEqual(Set(overlays.overlays.map(ObjectIdentifier.init)), ids)
        XCTAssertEqual(map.overlayMutations, 0)
        XCTAssertEqual(map.annotationMutations, 0)
        XCTAssertEqual(requests, before, "Changing colors must reuse the actual road routes")
        service.reset()
        overlays.apply(service, selection: nil, to: map)
        XCTAssertTrue(overlays.overlays.isEmpty)
    }

    @MainActor func testSelectedOnlyCasingOnLightAndDarkBackgrounds() throws {
        let points = [MKMapPoint(x: 100_000, y: 100_000), MKMapPoint(x: 100_160, y: 100_000)]
        let polyline = MKPolyline(points: points, count: points.count)
        let image = UIGraphicsImageRenderer(size: CGSize(width: 440, height: 480)).image { output in
            let context = output.cgContext
            for (backgroundIndex, background) in [
                UIColor(white: 0.92, alpha: 1), UIColor(white: 0.17, alpha: 1),
            ]
            .enumerated() {
                context.setFillColor(background.cgColor)
                context.fill(CGRect(x: 0, y: backgroundIndex * 240, width: 440, height: 240))
                for (index, color) in TripDayColor.palette.prefix(4).enumerated() {
                    let y = CGFloat(backgroundIndex * 240 + index * 55 + 32)
                    let textColor = backgroundIndex == 0 ? UIColor.black : .white
                    (color.name as NSString).draw(
                        at: CGPoint(x: 16, y: y - 8),
                        withAttributes: [
                            .font: UIFont.systemFont(ofSize: 13), .foregroundColor: textColor,
                        ])
                    for selected in [false, true] {
                        for casing in selected ? [true, false] : [false] {
                            let renderer = MKPolylineRenderer(polyline: polyline)
                            renderer.strokeColor = (casing ? UIColor.white : color.uiColor)
                                .withAlphaComponent(selected ? 1 : 0.55)
                            renderer.lineWidth = (selected ? 9 : 6) + (casing ? 3 : 0)
                            renderer.lineCap = .round
                            renderer.lineJoin = .round
                            let origin = renderer.point(for: points[0])
                            context.saveGState()
                            context.translateBy(x: 140 - origin.x, y: y + (selected ? 14 : -9) - origin.y)
                            renderer.draw(
                                polyline.boundingMapRect.insetBy(dx: -20, dy: -20), zoomScale: 1, in: context)
                            context.restoreGState()
                            XCTAssertFalse(renderer.shouldRasterize)
                        }
                    }
                }
            }
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = "Selected-only white route casing, light and dark"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

@MainActor private final class RouteRecordingMap: MKMapView {
    var overlayMutations = 0
    var annotationMutations = 0
    override func addOverlays(_ overlays: [any MKOverlay], level: MKOverlayLevel) {
        overlayMutations += 1
        super.addOverlays(overlays, level: level)
    }
    override func removeOverlays(_ overlays: [any MKOverlay]) {
        overlayMutations += 1
        super.removeOverlays(overlays)
    }
    override func addAnnotations(_ annotations: [any MKAnnotation]) {
        annotationMutations += 1
        super.addAnnotations(annotations)
    }
    override func removeAnnotations(_ annotations: [any MKAnnotation]) {
        annotationMutations += 1
        super.removeAnnotations(annotations)
    }
    func clearCounts() {
        overlayMutations = 0
        annotationMutations = 0
    }
}
