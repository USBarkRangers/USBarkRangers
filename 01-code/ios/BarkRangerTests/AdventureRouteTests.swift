import BarkDomain
import Foundation
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct AdventureRouteTests {
    private func trip(count: Int) throws -> Trip {
        let stops = try (0..<count).map { index in
            Trip.Stop(
                name: "Stop & \(index)",
                coordinate: try #require(Coordinate(latitude: 44 + Double(index) / 100, longitude: -68)))
        }
        return Trip(days: [Trip.Day(stops: stops)])
    }
    @Test func appleAndGoogleContinuationPartsRetainEveryStopAndSafeOrder() throws {
        let trip = try trip(count: 40)
        let day = try #require(TripRoutePlan.build(trip).days.first)
        for google in [false, true] {
            let parts = MapsHandoff.routeParts(day, google: google)
            #expect(parts.count == (google ? 10 : 3))
            var all: [String] = []
            for part in parts {
                let query = try #require(
                    URLComponents(url: part.url, resolvingAgainstBaseURL: false)?.queryItems)
                let start = try #require(query.first { $0.name == (google ? "origin" : "source") }?.value)
                let end = try #require(query.first { $0.name == "destination" }?.value)
                let middle =
                    google
                    ? (query.first { $0.name == "waypoints" }?.value ?? "").split(separator: "|").map(
                        String.init)
                    : query.filter { $0.name == "waypoint" }.compactMap(\.value)
                let points = [start] + middle + [end]
                if all.isEmpty {
                    all = points
                } else {
                    #expect(all.last == start)
                    all += points.dropFirst()
                }
                #expect(part.url.absoluteString.count <= 2048)
            }
            #expect(all == day.points.compactMap(\.coordinate).map { "\($0.latitude),\($0.longitude)" })
        }
    }
    @Test func cancelledAndThrottledRoutesCannotPublishObsoleteLegs() async throws {
        let day = try #require(TripRoutePlan.build(trip(count: 4)).days.first)
        var requests = 0
        let model = DayRouteService { _ in
            requests += 1
            throw NSError(domain: MKError.errorDomain, code: Int(MKError.loadingThrottled.rawValue))
        }
        model.update(
            tripID: "trip", plan: TripRoutePlan.build(try trip(count: day.points.count)),
            preferredDay: day.id, permitted: true)
        try await eventually { !model.isLoading }
        #expect(requests == 1 && model.failures.count == day.segments.count)
        #expect(model.legs.isEmpty)
        model.reset()
        #expect(model.legs.isEmpty && model.failures.isEmpty)
        let delayed = DayRouteService { _ in
            try await Task.sleep(for: .seconds(30))
            return .init(polyline: MKPolyline(), meters: 100, seconds: 10)
        }
        delayed.update(
            tripID: "trip", plan: TripRoutePlan.build(try trip(count: 4)), preferredDay: day.id,
            permitted: true)
        delayed.reset()
        await Task.yield()
        #expect(!delayed.isLoading && delayed.legs.isEmpty)
    }
    @Test func unchangedGeometryUsesOneRequestAndScopeResetClearsCache() async throws {
        let day = try #require(TripRoutePlan.build(trip(count: 2)).days.first)
        let segment = try #require(day.segments.first)
        var requests = 0
        let service = RoutePreviewService { segment in
            requests += 1
            return RouteCacheFixture.route(segment)
        }
        _ = try await service.route(segment)
        _ = try await service.route(segment)
        #expect(requests == 1)
        service.clear()
        _ = try await service.route(segment)
        #expect(requests == 2)
    }
    @Test func routeFailureKeepsSuccessfulLegAndTotalsHonest() async throws {
        let day = try #require(TripRoutePlan.build(trip(count: 3)).days.first)
        var requests = 0
        let model = DayRouteService { _ in
            requests += 1
            if requests == 2 { throw URLError(.notConnectedToInternet) }
            return .init(polyline: MKPolyline(), meters: 100, seconds: 10)
        }
        model.update(
            tripID: "trip", plan: TripRoutePlan.build(try trip(count: day.points.count)),
            preferredDay: day.id, permitted: true)
        try await eventually { !model.isLoading }
        #expect(requests == 2 && model.legs.count == 1 && model.failures.count == 1)
        #expect(model.legs.values.reduce(0) { $0 + $1.meters } == 100)
    }
}
