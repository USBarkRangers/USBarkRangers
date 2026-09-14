import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct RoutePersistenceTests {
    @Test func largeTripSurvivesSwitchingAndOfflineRelaunchWithoutDirectionsRequests() async throws {
        let directory = RouteCacheFixture.directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        var requests = 0
        let provider = RoutePreviewService(
            calculate: { segment in
                requests += 1
                return RouteCacheFixture.route(segment)
            },
            store: RouteGeometryStore(directory: directory), maximumMemoryBytes: 0)
        let roads = DayRouteService(service: provider, spacing: .zero)
        roads.reset(scope: "alice")
        let trip = try RouteCacheFixture.trip(stops: 393)
        let plan = TripRoutePlan.build(trip)
        roads.update(tripID: trip.id, plan: plan, preferredDay: "day", permitted: true)
        try await eventually(timeout: .seconds(30)) { !roads.isLoading }
        #expect(requests == 392 && roads.legs.count == 392)
        let alternate = TripRoutePlan.build(try RouteCacheFixture.trip(stops: 3, offset: 500))
        roads.update(tripID: "alternate", plan: alternate, preferredDay: nil, permitted: true)
        try await eventually { !roads.isLoading }
        #expect(requests == 394)
        roads.clearTrip()
        roads.update(tripID: trip.id, plan: plan, preferredDay: "day", permitted: true)
        try await eventually { !roads.isLoading }
        #expect(requests == 394 && roads.legs.count == 392)
        roads.reset()

        // Fresh provider/store objects model a terminated process; no memory route survives.
        let offline = DayRouteService(
            service: RoutePreviewService(
                calculate: { _ in
                    Issue.record("Offline cache restore requested Apple directions")
                    throw CancellationError()
                },
                store: RouteGeometryStore(directory: directory)), spacing: .zero)
        offline.reset(scope: "alice")
        let start = ContinuousClock.now
        offline.update(tripID: trip.id, plan: plan, preferredDay: "day", permitted: false)
        try await eventually { !offline.isLoading }
        print("393-stop disk restore: \(start.duration(to: .now))")
        #expect(offline.legs.count == 392 && offline.failures.isEmpty)
        #expect(
            offline.legs.values.allSatisfy {
                $0.polyline.pointCount == 2 && $0.seconds == 600 && $0.meters == 1609.344
            })
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        let overlays = MapRouteOverlays()
        overlays.apply(offline, selection: nil, to: map)
        #expect(overlays.overlays.filter { !$0.isCasing }.count == 392)
        let identities = Set(overlays.overlays.map(ObjectIdentifier.init))
        let version = offline.geometryVersion
        for _ in 0..<25 {
            offline.update(tripID: trip.id, plan: plan, preferredDay: "day", permitted: false)
            overlays.apply(offline, selection: .init(tripID: trip.id, dayID: "day"), to: map)
        }
        #expect(
            offline.geometryVersion == version
                && Set(overlays.overlays.map(ObjectIdentifier.init)) == identities)
        #expect(
            try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        offline.reset()
    }

    @Test func editedTripRestoresUnchangedLinesBeforeRequestingOnlyNewConnections() async throws {
        let directory = RouteCacheFixture.directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        var trip = try RouteCacheFixture.trip(stops: 5)
        let original = TripRoutePlan.build(trip)
        let initial = RoutePreviewService(
            calculate: RouteCacheFixture.route, store: RouteGeometryStore(directory: directory))
        initial.clear(scope: "alice")
        for segment in original.days[0].segments { _ = try await initial.route(segment) }
        initial.clear()
        let oldIDs = trip.days[0].stops.map(\.id)
        trip.days[0].stops.swapAt(1, 2)
        let revised = TripRoutePlan.build(trip)
        var requested: Set<String> = []
        var release: CheckedContinuation<Void, Never>?
        let roads = DayRouteService(
            service: RoutePreviewService(
                calculate: { segment in
                    requested.insert(segment.geometryKey)
                    if requested.count == 1 { await withCheckedContinuation { release = $0 } }
                    return RouteCacheFixture.route(segment)
                }, store: RouteGeometryStore(directory: directory)), spacing: .zero)
        roads.reset(scope: "alice")
        roads.update(tripID: trip.id, plan: revised, preferredDay: "day", permitted: true)
        try await eventually { release != nil }
        #expect(
            roads.legs.count == 1, "D→E must already be visible while the changed connections are pending")
        release?.resume()
        try await eventually { !roads.isLoading }
        let originalKeys = Set(original.days.flatMap(\.segments).map(\.geometryKey))
        let revisedKeys = Set(revised.days.flatMap(\.segments).map(\.geometryKey))
        #expect(requested == revisedKeys.subtracting(originalKeys))
        let count = requested.count
        let version = roads.geometryVersion
        trip.name = "Renamed"
        trip.days[0].notes = "New note"
        roads.suspend()
        roads.update(tripID: trip.id, plan: TripRoutePlan.build(trip), preferredDay: "day", permitted: true)
        #expect(requested.count == count && !roads.isLoading && roads.geometryVersion == version)
        #expect(trip.days[0].stops.map(\.id) != oldIDs)
        roads.reset()
    }

    @Test func accountChangeRejectsLateRequestsAndCannotReadAnotherAccountsFiles() async throws {
        let directory = RouteCacheFixture.directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let segment = try RouteCacheFixture.segment()
        let seed = RoutePreviewService(
            calculate: RouteCacheFixture.route, store: RouteGeometryStore(directory: directory))
        seed.clear(scope: "alice")
        _ = try await seed.route(segment)
        var release: CheckedContinuation<Void, Never>?
        let provider = RoutePreviewService(
            calculate: { segment in
                await withCheckedContinuation { release = $0 }
                return RouteCacheFixture.route(segment)
            },
            store: RouteGeometryStore(directory: directory))
        provider.clear(scope: "bob")
        #expect(await provider.restore([segment]).isEmpty)
        let request = Task { try await provider.route(segment) }
        try await eventually { release != nil }
        provider.clear(scope: "carol")
        release?.resume()
        await #expect(throws: CancellationError.self) { try await request.value }
        #expect(await provider.restore([segment]).isEmpty)
        provider.clear(scope: "alice")
        #expect(await provider.restore([segment]).count == 1)
    }
}
