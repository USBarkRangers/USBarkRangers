import BarkDomain
import MapKit
import Synchronization
import Testing

@testable import BarkRanger

/// Exercises both real presentation models with the same production-owned draft and road worker.
@MainActor struct ActiveTripSessionTests {
    @Test func compositionAndBothTabsUseOneEditableSession() async throws {
        let app = AppSandbox().makeComposition()
        #expect(app.trips.activeTrip === app.discovery.routeDay?.activeTrip)
        #expect(app.trips.routes === app.discovery.routeDay?.routes)
        await app.lifecycle.stopAndWait()

        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let map = RouteDaySheetViewModel.testModel(
            account: fixture.session, routes: DayRouteService { _ in throw CancellationError() })
        let planner = fixture.model(activeTrip: map.activeTrip)
        map.start()
        map.open(tripID: fixture.a.id)
        try await eventually { !map.isWorking && planner.draft?.id == fixture.a.id }
        #expect(planner.draft == map.draft)
        planner.addDay()
        #expect(map.target == planner.target && map.draft?.trip.days.count == 2)
        #expect(await planner.awaitCheckpoint())
        map.close()
        #expect(map.target == nil && planner.activeDay != nil)
        planner.stepDay(-1)
        #expect(map.target == planner.target && map.dayIndex == 0)
        #expect(await planner.awaitCheckpoint())
        #expect(planner.selectDraft(fixture.b))
        #expect(map.draft?.id == fixture.b.id)
        #expect(await planner.awaitCheckpoint())
        map.open(tripID: fixture.a.id)
        try await eventually { !map.isWorking && planner.draft?.id == fixture.a.id }
        #expect(map.target == planner.target)
        map.clearMap()
        try await eventually { !map.isWorking && planner.draft == nil && map.context == nil }
        #expect(try await fixture.repository.store.tripLocalLists().drafts.count == 2)
        await planner.resumeActive()
        #expect(planner.draft == nil)
        planner.selectTrip(fixture.a.id)
        try await eventually { !planner.saving && planner.draft?.id == fixture.a.id }
        #expect(map.draft?.id == planner.draft?.id)
        planner.resetScope()
        map.stop()
        await fixture.session.stopAndWait()
    }

    @Test func plannerEditsCalculateRoadsWhileMapIsClosedAndNavigationReusesThem() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        var requests: [String] = []
        let routes = DayRouteService { segment in
            requests.append(segment.geometryKey)
            return Self.leg(segment)
        }
        let shared = ActiveTripSession(account: fixture.session, routes: routes)
        let planner = fixture.model(activeTrip: shared)
        let map = RouteDaySheetViewModel.testModel(
            account: fixture.session, routes: routes, activeTrip: shared)
        shared.start()
        await planner.resumeActive()
        map.stop()  // Leaving Map must not stop an app-owned road worker.
        let a = try Self.stop("A", -80)
        let b = try Self.stop("B", -79)
        let c = try Self.stop("C", -78)
        #expect(planner.addStop(a))
        #expect(planner.addStop(b))
        #expect(await planner.awaitCheckpoint())
        try await eventually { routes.legs.count == 1 && !routes.isLoading }
        #expect(requests.count == 1)
        #expect(planner.plan?.days == routes.days)
        let firstDay = try #require(planner.target)
        let firstLeg = try #require(routes.days.first?.segments.first)
        #expect(routes.leg(firstLeg)?.seconds == 100 && routes.leg(firstLeg)?.meters == 1000)
        planner.addDay()
        #expect(planner.addStop(c))
        #expect(await planner.awaitCheckpoint())
        try await eventually { routes.days.count == 2 && routes.legs.count == 2 && !routes.isLoading }
        let count = requests.count
        let version = routes.geometryVersion
        map.close()
        planner.stepDay(-1)
        #expect(map.target == firstDay)
        #expect(await planner.awaitCheckpoint())
        try await Task.sleep(for: .milliseconds(30))
        #expect(requests.count == count && routes.geometryVersion == version)
        let target = try #require(planner.target)
        #expect(planner.editDay(.order([b.id, a.id], expected: [a.id, b.id]), target: target))
        #expect(await planner.awaitCheckpoint())
        try await eventually { !routes.isLoading && routes.days.first?.points.map(\.id) == [b.id, a.id] }
        #expect(map.day?.stops.map(\.id) == [b.id, a.id])
        #expect(planner.plan?.days == routes.days)
        planner.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func clearWaitsForPendingCheckpointAndCannotReviveAfterReload() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        var release: CheckedContinuation<Void, Never>?
        let routes = DayRouteService { _ in throw CancellationError() }
        let shared = ActiveTripSession(
            account: fixture.session, routes: routes,
            checkpointDraft: { repo, draft, expected in
                await withCheckedContinuation { release = $0 }
                return try await repo.checkpoint(draft, replacing: expected)
            })
        let planner = fixture.model(activeTrip: shared)
        shared.start()
        await planner.resumeActive()
        planner.rename("Keep this edit")
        try await eventually { release != nil }
        planner.clearTrip()
        try await eventually { shared.isWorking }
        #expect(planner.draft != nil && shared.checkpointPending)
        #expect(!planner.addStop(try Self.stop("Blocked during clear", -81)))
        release?.resume()
        try await eventually { !planner.saving && !shared.isWorking && planner.draft == nil }
        #expect(try await fixture.repository.store.tripLocalLists().drafts.count == 2)
        #expect(try await fixture.repository.currentDraft(id: fixture.b.id)?.trip.name == "Keep this edit")
        #expect(try await fixture.repository.store.pendingTripIDs().isEmpty)
        #expect(try await fixture.repository.store.nativeSelection().tripID == nil)
        #expect(try await fixture.repository.restoreActiveDraft() == nil)
        await planner.resumeActive()
        #expect(planner.draft == nil && routes.tripID == nil)
        planner.resetScope()
        await planner.resumeActive()
        #expect(planner.draft == nil)
        await fixture.session.stopAndWait()
    }

    @Test func backgroundAndAccountChangeRejectLateSharedOperations() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        var release: CheckedContinuation<Void, Never>?
        let shared = ActiveTripSession(
            account: fixture.session, routes: DayRouteService { _ in throw CancellationError() },
            saveAccountTrip: { repository, id, expected in
                let saved = try await repository.save(id: id, matching: expected)
                await withCheckedContinuation { release = $0 }
                return saved
            })
        shared.start()
        await shared.resume()
        let work = Task { try await shared.saveDraftToAccount() }
        try await eventually { release != nil }
        shared.stop()
        release?.resume()
        try await work.value
        #expect(!shared.isWorking, "Backgrounding cannot strand the shared mutation gate")
        shared.start()
        release = nil
        let late = Task { try await shared.saveDraftToAccount() }
        try await eventually { release != nil }
        fixture.auth.select("user-b")
        try await eventually {
            fixture.session.identity?.uid == "user-b"
                && fixture.session.nativeTrips?.scope.hasSuffix(":user-b") == true
        }
        release?.resume()
        await #expect(throws: AccountFailure.accountChanged) { try await late.value }
        #expect(shared.draft == nil && !shared.isWorking)
        shared.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func clearIsReadOnlySelectionAtomicAndPersisted() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let failing = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "clear-test",
            beforeSave: {
                if failing.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) }
            })
        let a = TripDraft(trip: Trip(id: "a"))
        try await store.seedPremium()
        _ = try await store.checkpointNativeDraft(a, replacing: nil)
        let before = try await store.tripLocalLists()
        failing.withLock { $0 = true }
        await #expect(throws: (any Error).self) { try await store.clearNativeTrip(expectedID: a.id) }
        #expect(try await store.tripLocalLists() == before)
        failing.withLock { $0 = false }
        try await store.acceptEntitlement(
            .init(revision: 2, premium: false, source: .production, validUntilMs: nil))
        try await store.clearNativeTrip(expectedID: a.id)
        #expect(try await store.currentNativeDraft(id: a.id) == a)
        #expect(try await store.pendingTripIDs().isEmpty)
        await store.close()
        let reloaded = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "clear-test")
        #expect(try await NativeTripRepository(store: reloaded, cloud: nil).restoreActiveDraft() == nil)
        #expect(try await reloaded.currentNativeDraft(id: a.id) == a)
        _ = try await reloaded.openNativeDraft(id: a.id)
        #expect(try await NativeTripRepository(store: reloaded, cloud: nil).restoreActiveDraft()?.id == a.id)
        await reloaded.close()
        try FileManager.default.removeItem(at: directory)
    }

    @Test func staleOptimizationCannotReplaceEditsFromTheOtherSurface() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let map = RouteDaySheetViewModel.testModel(
            account: fixture.session, routes: DayRouteService { _ in throw CancellationError() })
        let planner = fixture.model(activeTrip: map.activeTrip)
        map.start()
        await planner.resumeActive()
        #expect(planner.addStop(try Self.stop("A", -80)))
        #expect(planner.addStop(try Self.stop("B", -79)))
        #expect(await planner.awaitCheckpoint())
        map.activeTrip.highlightDay()
        planner.proposeOptimization(partition: false)
        try await eventually { planner.proposal != nil && !planner.saving }
        map.edit(.notes(expected: "", value: "New Map note"))
        try await eventually { !map.isWorking && planner.activeDay?.notes == "New Map note" }
        #expect(planner.proposal == nil)
        planner.acceptOptimization()
        #expect(planner.activeDay?.notes == "New Map note")
        map.proposeOptimization()
        try await eventually { map.editor.optimization != nil && !map.isWorking }
        let target = try #require(planner.target)
        planner.editDay(.notes(expected: "New Map note", value: "New Planner note"), target: target)
        #expect(map.editor.optimization == nil)
        map.applyOptimization()
        #expect(await planner.awaitCheckpoint())
        #expect(map.day?.notes == "New Planner note")
        planner.resetScope()
        map.stop()
        await fixture.session.stopAndWait()
    }

    @Test func staleMapActionsCannotReactivateAClearedOrSwitchedTrip() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let map = RouteDaySheetViewModel.testModel(
            account: fixture.session, routes: DayRouteService { _ in throw CancellationError() })
        let planner = fixture.model(activeTrip: map.activeTrip)
        map.start()
        map.open(tripID: fixture.a.id)
        try await eventually { !map.isWorking && map.target != nil }
        let oldTarget = try #require(map.target)
        let stop = try Self.stop("Stale add", -81)
        #expect(planner.selectDraft(fixture.b))
        #expect(await planner.awaitCheckpoint())
        map.editor.apply(.notes(expected: "", value: "Old popup"), to: oldTarget)
        try await eventually { !map.isWorking }
        #expect(planner.draft?.id == fixture.b.id)
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id)?.trip.days[0].notes == "")
        planner.clearTrip()
        try await eventually { !planner.saving && planner.draft == nil }
        map.editor.add(
            stop, aliases: [], tripID: oldTarget.tripID,
            destination: .day(oldTarget.dayID)
        ) { _ in
            Issue.record("An old popup must not reactivate the trip after Clear")
        }
        try await eventually { !map.isWorking }
        #expect(planner.draft == nil && map.context == nil)
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id)?.trip.totalStops == 0)
        planner.resetScope()
        map.stop()
        await fixture.session.stopAndWait()
    }

    private static func stop(_ name: String, _ longitude: Double) throws -> Trip.Stop {
        Trip.Stop(name: name, coordinate: try #require(Coordinate(latitude: 40, longitude: longitude)))
    }
    private static func leg(_ segment: TripRoutePlan.Segment) -> DayRouteService.Leg {
        let coordinates = [segment.from, segment.to].compactMap(\.coordinate).map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }
        return .init(
            polyline: MKPolyline(coordinates: coordinates, count: coordinates.count), meters: 1000,
            seconds: 100)
    }
}
