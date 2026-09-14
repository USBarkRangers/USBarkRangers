import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct RouteCacheTests {
    private func plan(_ index: Int) throws -> TripRoutePlan {
        let from = try #require(Coordinate(latitude: 44, longitude: -68 + Double(index) / 1000))
        let to = try #require(Coordinate(latitude: 45, longitude: -67))
        return TripRoutePlan.build(
            Trip(days: [
                .init(
                    id: "day",
                    stops: [
                        .init(name: "A", coordinate: from), .init(name: "B", coordinate: to),
                    ])
            ]))
    }

    @Test func switchingAndClearingTripsRestoresCachedLegsImmediatelyButAccountResetDoesNot() async throws {
        var requests = 0
        let cache = RoutePreviewService { segment in
            requests += 1
            return RouteCacheFixture.route(segment)
        }
        let roads = DayRouteService(service: cache)
        defer { roads.reset() }
        let first = try plan(0)
        let second = try plan(1)
        roads.update(tripID: "a", plan: first, preferredDay: "day", permitted: true)
        try await eventually { !roads.isLoading }
        let retained = try #require(roads.legs.values.first)
        roads.update(tripID: "b", plan: second, preferredDay: "day", permitted: true)
        try await eventually { !roads.isLoading }
        roads.clearTrip()
        #expect(roads.legs.isEmpty && roads.tripID == nil)
        roads.update(tripID: "a", plan: first, preferredDay: "day", permitted: true)
        #expect(requests == 2 && !roads.isLoading && roads.legs.count == 1)
        #expect(roads.legs.values.first?.polyline === retained.polyline)
        roads.suspend()
        roads.update(tripID: "a", plan: first, preferredDay: "day", permitted: true)
        #expect(requests == 2 && !roads.isLoading)
        roads.reset()
        roads.update(tripID: "a", plan: first, preferredDay: "day", permitted: true)
        try await eventually { !roads.isLoading }
        #expect(requests == 3)
    }

    @Test func cacheExpiresAndEvictsLeastRecentlyUsedLegs() async throws {
        var instant = Date(timeIntervalSince1970: 1000)
        var requests = 0
        let cache = RoutePreviewService(
            calculate: { segment in
                requests += 1
                return RouteCacheFixture.route(segment)
            }, now: { instant }, lifetime: 60, maximumMemoryBytes: 100 * 288)
        let segments = try (0...100).map { try #require(plan($0).days.first?.segments.first) }
        for segment in segments.prefix(100) { _ = try await cache.route(segment) }
        #expect(cache.cachedRoute(segments[0]) != nil)
        _ = try await cache.route(segments[100])
        #expect(cache.cachedRoute(segments[1]) == nil)
        #expect(cache.cachedRoute(segments[0]) != nil && requests == 101)
        instant += 61
        #expect(cache.cachedRoute(segments[0]) == nil)
        _ = try await cache.route(segments[0])
        #expect(requests == 102)
    }

    @Test func accountResetCannotBeUndoneByALateDirectionsResponse() async throws {
        var release: CheckedContinuation<Void, Never>?
        let cache = RoutePreviewService { segment in
            await withCheckedContinuation { release = $0 }
            return RouteCacheFixture.route(segment)
        }
        let segment = try #require(plan(0).days.first?.segments.first)
        let request = Task { _ = try await cache.route(segment) }
        try await eventually { release != nil }
        cache.clear()
        release?.resume()
        await #expect(throws: CancellationError.self) { try await request.value }
        #expect(cache.cachedRoute(segment) == nil)
    }
}
