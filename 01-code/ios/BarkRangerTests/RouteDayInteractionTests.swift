import BarkDomain
import MapKit
import XCTest

@testable import BarkRanger

nonisolated final class RouteDayInteractionTests: XCTestCase {
    @MainActor func testFirstRouteTapWinsWithoutWaitingForDoubleTapOrAnotherRenderPass() async throws {
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try await context.start()
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let account = AccountSession(auth: nil, directory: directory)
        account.start()
        try await eventually { account.nativeTrips?.repository != nil }
        let a = try XCTUnwrap(Coordinate(latitude: 44, longitude: -68))
        let b = try XCTUnwrap(Coordinate(latitude: 44, longitude: -67.9))
        let c = try XCTUnwrap(Coordinate(latitude: 44.1, longitude: -67.9))
        let trip = Trip(
            id: "tap-trip",
            days: [
                .init(id: "one", stops: [.init(name: "A", coordinate: a), .init(name: "B", coordinate: b)]),
                .init(id: "two", stops: [.init(name: "C", coordinate: c)]),
            ])
        try await account.nativeTrips?.repository.saveDraft(TripDraft(trip: trip))
        var roadRequests = 0
        let service = DayRouteService { segment in
            roadRequests += 1
            let points = try [segment.from, segment.to].map { stop in
                let point = try XCTUnwrap(stop.coordinate)
                return CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
            }
            return .init(
                polyline: MKPolyline(coordinates: points, count: points.count), meters: 1000, seconds: 100)
        }
        let day = RouteDaySheetViewModel.testModel(account: account, routes: service)
        day.start()
        day.open(tripID: trip.id)
        try await eventually { service.days.count == 2 && !day.isWorking }
        XCTAssertEqual(day.position, .low, "The first trip opening still starts compact")
        service.update(tripID: trip.id, plan: TripRoutePlan.build(trip), preferredDay: nil, permitted: true)
        try await eventually { !service.isLoading }
        day.close()
        let model = MapFeatureModel(
            catalog: context.catalog, settings: context.settings,
            location: LocationClient(manager: nil), maps: MapsHandoff(open: { _ in true }),
            account: account, routeDay: day)
        model.start()
        defer { model.stop() }
        try await eventually { model.projection != nil }
        let coordinator = MapCoordinator(model: model)
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 402, height: 874))
        map.setRegion(
            .init(
                center: .init(latitude: 44.04, longitude: -67.95),
                span: .init(latitudeDelta: 0.4, longitudeDelta: 0.4)), animated: false)
        coordinator.apply(to: map)
        let identities = Set(coordinator.routeOverlays.overlays.map(ObjectIdentifier.init))
        let camera = map.region
        let tap = CompletedRouteTap()
        let doubleTap = UITapGestureRecognizer()
        doubleTap.numberOfTapsRequired = 2
        let pan = UIPanGestureRecognizer()
        map.addGestureRecognizer(tap)
        map.addGestureRecognizer(doubleTap)
        map.addGestureRecognizer(pan)
        for (position, dayID, coordinate) in [
            (MapSheetPosition.low, "two", CLLocationCoordinate2D(latitude: 44.05, longitude: -67.9)),
            (.low, "one", CLLocationCoordinate2D(latitude: 44, longitude: -67.95)),
            (.medium, "two", CLLocationCoordinate2D(latitude: 44.05, longitude: -67.9)),
            (.medium, "one", CLLocationCoordinate2D(latitude: 44, longitude: -67.95)),
            (.high, "two", CLLocationCoordinate2D(latitude: 44.05, longitude: -67.9)),
        ] {
            day.position = position
            let touch = RouteTouch(map: map, point: map.convert(coordinate, toPointTo: map))
            XCTAssertTrue(coordinator.gestureRecognizer(tap, shouldReceive: touch))
            XCTAssertTrue(coordinator.gestureRecognizer(tap, shouldBeRequiredToFailBy: doubleTap))
            XCTAssertFalse(coordinator.gestureRecognizer(tap, shouldRecognizeSimultaneouslyWith: doubleTap))
            XCTAssertFalse(coordinator.gestureRecognizer(tap, shouldBeRequiredToFailBy: pan))
            coordinator.mapTapped(tap)
            let target = TripDayID(tripID: trip.id, dayID: dayID)
            XCTAssertEqual(day.target, target)
            XCTAssertEqual(day.position, position, "A route tap must preserve the current sheet height")
            XCTAssertEqual((map.overlays.last as? DayRoutePolyline)?.owner, target)
            for line in coordinator.routeOverlays.overlays where !line.isCasing {
                let renderer = coordinator.routeOverlays.renderer(for: line)
                XCTAssertEqual(renderer.lineWidth, line.owner == target ? 9 : 6)
                XCTAssertFalse(renderer.shouldRasterize)
            }
        }
        day.position = .medium
        day.close()
        model.selectRouteDay(.init(tripID: trip.id, dayID: "one"))
        XCTAssertEqual(day.position, .medium, "Dismiss/reselect retains the user's detent too")
        XCTAssertEqual(day.target?.dayID, "one")
        await day.activeTrip.waitForCheckpoint()
        let saved = try await account.nativeTrips?.repository.currentDraft(id: trip.id)
        XCTAssertEqual(saved?.activeDayID, "one")
        XCTAssertEqual(saved?.trip, trip, "Choosing a route must not change its stops or notes")
        XCTAssertEqual(roadRequests, 2)
        XCTAssertEqual(Set(coordinator.routeOverlays.overlays.map(ObjectIdentifier.init)), identities)
        XCTAssertEqual(map.region.center.latitude, camera.center.latitude)
        XCTAssertEqual(map.region.span.latitudeDelta, camera.span.latitudeDelta)
        model.stop()
        await account.stopAndWait()
    }
}

@MainActor private final class CompletedRouteTap: UITapGestureRecognizer {
    override var state: UIGestureRecognizer.State {
        get { .ended }
        set {}
    }
}

@MainActor private final class RouteTouch: UITouch {
    private let map: MKMapView
    private let point: CGPoint
    init(map: MKMapView, point: CGPoint) {
        self.map = map
        self.point = point
        super.init()
    }
    override var view: UIView? { map }
    override func location(in view: UIView?) -> CGPoint { point }
}
