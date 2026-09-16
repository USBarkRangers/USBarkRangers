import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct RouteCacheLifecycleTests {
    @Test func sharedPlannerMapSessionRestoresTheSameRoadsAfterAnAccountScopedRestart() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let directory = fixture.session.directory.appendingPathComponent("RouteCache")
        var requests = 0
        let provider = RoutePreviewService(
            calculate: { segment in
                requests += 1
                return RouteCacheFixture.route(segment)
            }, store: RouteGeometryStore(directory: directory))
        let roads = DayRouteService(service: provider, spacing: .zero)
        let shared = ActiveTripSession(account: fixture.session, routes: roads)
        let planner = fixture.model(activeTrip: shared)
        let map = RouteDaySheetViewModel.testModel(account: fixture.session, routes: roads, activeTrip: shared)
        shared.start()
        await planner.resumeActive()
        for stop in try RouteCacheFixture.trip(stops: 4).days[0].stops { #expect(planner.addStop(stop)) }
        #expect(await planner.awaitCheckpoint())
        try await eventually { !roads.isLoading && roads.legs.count == 3 }
        #expect(requests == 3)
        let retainedLines = roads.legs.mapValues { ObjectIdentifier($0.polyline) }
        let retainedVersion = roads.geometryVersion
        let tripID = planner.draft?.id
        map.stop()
        shared.stop()
        shared.start()
        await planner.resumeActive()
        map.start()
        try await eventually { !roads.isLoading }
        #expect(requests == 3 && map.draft?.id == tripID)
        #expect(roads.legs.mapValues { ObjectIdentifier($0.polyline) } == retainedLines)
        #expect(roads.geometryVersion == retainedVersion)
        planner.resetScope()
        shared.start()
        await planner.resumeActive()
        try await eventually { roads.legs.count == 3 && !roads.isLoading }
        #expect(requests == 3 && map.draft?.id == tripID && planner.draft?.id == tripID)
        planner.resetScope()
        map.stop()
        await fixture.session.stopAndWait()
    }

    @Test func fiveThousandSegmentRestoreYieldsToMainActorAndMakesNoNetworkRequests() async throws {
        let directory = RouteCacheFixture.directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let segments = TripRoutePlan.build(try RouteCacheFixture.trip(stops: 5_001)).days[0].segments
        let store = RouteGeometryStore(directory: directory)
        let date = Date()
        let base = try RouteCacheFixture.snapshot(at: date)
        let geometry = RoadRoute.Snapshot(
            points: (0..<200).map {
                .init(x: base.points[0].x + Double($0), y: base.points[0].y)
            }, meters: base.meters, seconds: base.seconds, fetchedAt: date)
        // Full file set with 1,000,000 points; no MKDirections/network or production account involved.
        for segment in segments {
            await store.save(
                geometry, key: "driving-v1|\(segment.geometryKey)", scope: "load-test", now: date)
        }
        let provider = RoutePreviewService(
            calculate: { _ in
                Issue.record("Warm geometry must not request directions")
                throw CancellationError()
            }, store: RouteGeometryStore(directory: directory))
        provider.clear(scope: "load-test")
        var beats = 0
        var longest = Duration.zero
        let heartbeat = Task { @MainActor in
            var last = ContinuousClock.now
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(2)) } catch { return }
                let now = ContinuousClock.now
                longest = max(longest, last.duration(to: now))
                last = now
                beats += 1
            }
        }
        defer { heartbeat.cancel() }
        let start = ContinuousClock.now
        let restored = await provider.restore(segments)
        print(
            "5,000-segment / 1M-point disk restore: \(start.duration(to: .now)); main heartbeat: \(beats), longest gap: \(longest)"
        )
        #expect(restored.count == 5_000 && beats > 5)
        #expect(
            longest < .milliseconds(250), "Disk decode/polyline restoration must not monopolize MainActor")
    }
}
