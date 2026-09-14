import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct PlannerTargetingTests {
    @Test func dayNavigationHasNoRetryDuringSavingAndFailuresCanBeRetried() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = PlannerGate()
        var fail = false
        let model = fixture.model(checkpoint: { repository, draft, expected in
            await gate.hold()
            if fail { throw URLError(.cannotWriteToFile) }
            return try await repository.checkpoint(draft, replacing: expected)
        })
        model.open(fixture.a)
        model.addDay()
        try await eventually { gate.waiting }
        #expect(model.checkpointPending && !model.checkpointNeedsRetry)
        gate.release()
        #expect(await model.awaitCheckpoint())
        model.stepDay(-1)
        try await eventually { gate.waiting }
        #expect(model.dayIndex == 0 && !model.checkpointNeedsRetry)
        fail = true
        gate.release()
        try await eventually { model.checkpointNeedsRetry }
        #expect(model.checkpointPending && !model.checkpointConflict)
        fail = false
        model.requestCheckpoint()
        try await eventually { gate.waiting }
        #expect(!model.checkpointNeedsRetry)
        gate.release()
        #expect(await model.awaitCheckpoint())
        #expect(!model.checkpointNeedsRetry)
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test(arguments: [false, true])
    func delayedSaveOrFailureForACannotChangeB(fails: Bool) async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = PlannerGate()
        let model = fixture.model(save: { repository, id, expected in
            let saved = fails ? expected : try await repository.save(id: id, matching: expected)
            await gate.hold()
            if fails { throw URLError(.cannotWriteToFile) }
            return saved
        })
        model.open(fixture.a)
        model.save()
        try await eventually { gate.waiting }
        model.open(fixture.b)
        model.rename("B edited while A finishes")
        try await eventually { !model.checkpointPending }
        let buffer = model.draft
        gate.release()
        try await eventually { gate.finished }
        try await Task.sleep(for: .milliseconds(30))
        #expect(model.draft == buffer && model.draft?.nativeBase?.contentRevision == 0)
        #expect(model.notice == nil && !model.saving)
        #expect(
            try await fixture.repository.store.tripQueueState(fixture.a.id).count == (fails ? 0 : 1))
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test func accountSwitchRejectsAnOldCompletionEvenBeforeTheRootResetRuns() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = PlannerGate()
        let model = fixture.model(save: { _, _, expected in
            await gate.hold()
            return expected
        })
        model.open(fixture.a)
        model.save()
        try await eventually { gate.waiting }
        fixture.auth.select("user-b")
        try await eventually {
            fixture.session.nativeProfile?.uid == "user-b" && fixture.session.nativeTrips != nil
        }
        gate.release()
        try await eventually { !model.saving }
        #expect(model.notice == nil && model.draft == nil)
        model.resetScope()
        #expect(model.draft == nil && !model.checkpointPending)
        await fixture.session.stopAndWait()
    }
    @Test(arguments: [false, true])
    func mapEditDuringSaveNeverBecomesTheExpectedVersionOfAnOlderBuffer(afterWrite: Bool) async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = PlannerGate()
        let model = fixture.model(save: { repository, id, expected in
            if afterWrite {
                let saved = try await repository.save(id: id, matching: expected)
                await gate.hold()
                return saved
            }
            await gate.hold()
            return try await repository.save(id: id, matching: expected)
        })
        model.open(fixture.a)
        model.save()
        try await eventually { gate.waiting }
        let day = fixture.a.trip.days[0]
        try await fixture.repository.editDay(
            .init(tripID: fixture.a.id, dayID: day.id),
            edit: .notes(expected: day.notes, value: "New map edit"))
        try await eventually {
            (try? await fixture.repository.currentDraft(id: fixture.a.id)?.trip.days[0].notes)
                == "New map edit"
        }
        gate.release()
        try await eventually { !model.saving }
        #expect(model.checkpointConflict && model.draft == fixture.a)
        #expect(model.notice?.contains("changed on the map") == true)
        model.reloadCheckpoint()
        try await eventually { model.draft?.trip.days[0].notes == "New map edit" }
        #expect(!model.checkpointConflict)
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test func rejectedOpenDoesNotScheduleAnotherCheckpointForTheCurrentTrip() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = PlannerGate()
        var writes = 0
        let model = fixture.model(checkpoint: { repository, draft, expected in
            writes += 1
            await gate.hold()
            return try await repository.checkpoint(draft, replacing: expected)
        })
        model.open(fixture.a)
        model.rename("A pending")
        try await eventually { gate.waiting }
        #expect(!model.open(fixture.b))
        model.newTrip()
        model.selectTrip(fixture.b.id)
        #expect(model.draft?.id == fixture.a.id)
        gate.release()
        try await eventually { !model.checkpointPending }
        #expect(writes == 1)
        #expect(try await fixture.repository.store.tripLocalLists().drafts.count == 2)
        #expect(try await fixture.repository.currentDraft(id: fixture.b.id) == fixture.b)
        model.resetScope()
        await fixture.session.stopAndWait()
    }
}

@MainActor private final class PlannerGate {
    private var continuation: CheckedContinuation<Void, Never>?
    var waiting: Bool { continuation != nil }
    private(set) var finished = false
    func hold() async {
        await withCheckedContinuation { continuation = $0 }
        finished = true
    }
    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor struct PlannerFixture {
    let context: DiscoveryTestContext
    let auth: SyntheticAuth
    let session: AccountSession
    let repository: NativeTripRepository
    let a: TripDraft
    let b: TripDraft
    static func make() async throws -> PlannerFixture {
        let context = try DiscoveryTestContext()
        try await context.start()
        let auth = SyntheticAuth()
        let (app, _, _) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let configuration = NativeProfileConfiguration(
            project: "demo-bark-native",
            connect: {
                try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: $0)
            })
        let session = AccountSession(
            auth: auth,
            directory: .temporaryDirectory.appendingPathComponent(UUID().uuidString),
            capabilities: .editableTest, nativeProfileConfiguration: configuration)
        session.start()
        auth.select("user-a")
        try await eventually { session.nativeTrips != nil }
        let repository = try #require(session.nativeTrips?.repository)
        try await repository.store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await repository.store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        let a = TripDraft(trip: Trip(id: "A", name: "Trip A"))
        let b = TripDraft(trip: Trip(id: "B", name: "Trip B"))
        try await repository.saveDraft(a)
        try await repository.saveDraft(b)
        try await eventually {
            session.entitlement.access?.premium == true && session.nativeTrips?.library.drafts.count == 2
        }
        return PlannerFixture(
            context: context, auth: auth, session: session, repository: repository, a: a, b: b)
    }
    func model(
        checkpoint: @escaping TripDraftSession.Checkpoint = { try await $0.checkpoint($1, replacing: $2) },
        save: @escaping ActiveTripSession.Save = { try await $0.save(id: $1, matching: $2) },
        activeTrip: ActiveTripSession? = nil
    ) -> TripEditorModel {
        let shared =
            activeTrip
            ?? ActiveTripSession(
                account: session,
                routes: DayRouteService { _ in throw URLError(.notConnectedToInternet) },
                saveAccountTrip: save, checkpointDraft: checkpoint)
        return TripEditorModel(
            activeTrip: shared, catalog: context.catalog,
            maps: MapsHandoff(open: { _ in true }))
    }
}
