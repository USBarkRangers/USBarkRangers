import BarkDomain
import Foundation
import Observation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor struct TripDraftSessionTests {
    @Test func plannerReadsOneBufferThroughPendingEditsAndAnObservedSaveCompletion() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = DraftWriteGate()
        var writes = 0
        let model = fixture.model(checkpoint: { repository, draft, base in
            writes += 1
            if writes == 1 { await gate.hold() }
            return try await repository.checkpoint(draft, replacing: base)
        })
        model.open(fixture.a)
        model.rename("First pending title")
        try await eventually { gate.waiting }
        model.addDay()
        model.rename("Latest Planner title")
        let latest = try #require(model.draft)
        await model.resumeActive()
        #expect(model.draft == latest && model.activeDay?.id == latest.trip.days[1].id)
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id) == fixture.a)
        gate.release()
        #expect(await model.awaitCheckpoint())
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id) == latest)

        // Track only the public draft read, as Planner/Overview do. An asynchronous receipt update
        // in the private session must invalidate that read without another editing intent.
        let draftChanged = Mutex(false)
        withObservationTracking {
            _ = model.draft
        } onChange: {
            draftChanged.withLock { $0 = true }
        }
        #expect(model.draft?.nativeBase?.contentRevision == 0)
        model.save()
        try await eventually { !model.saving }
        #expect(!draftChanged.withLock { $0 }, "Queuing an unchanged draft must not invalidate editable content")
        let submission = try #require(try await fixture.repository.store.nextTripSubmission(id: latest.id))
        let canonical = try nativeTripSnapshot(latest.trip, revision: 1)
        try await fixture.repository.store.acceptTripOutcome(
            .init(operationID: submission.id, status: .accepted, revisions: .init(trip: 1, metadata: 1, notes: [:])),
            snapshot: canonical)
        await model.resumeActive()
        #expect(draftChanged.withLock { $0 }, "The accepted preimage must be observable without a new edit")
        #expect(model.draft?.trip == latest.trip && model.draft?.activeDayID == latest.activeDayID)
        #expect(try await fixture.repository.store.tripQueueState(latest.id).count == 0)
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id) == model.draft)
        #expect(try await fixture.repository.store.tripLocalLists().drafts.filter { $0.id == fixture.a.id }.count == 1)
        model.resetScope()
        // A screen reset cannot destroy the app's shared editor.
        #expect(model.draft?.trip == latest.trip)
        await fixture.session.stopAndWait()
        #expect(model.draft == nil && model.activeDay == nil)
    }

    @Test func editsDuringAWriteCoalesceWithoutLosingTheSavedComparisonBase() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = DraftWriteGate()
        var writes: [(draft: TripDraft, base: TripDraft?)] = []
        let session = TripDraftSession(account: fixture.session) { repository, draft, base in
            writes.append((draft, base))
            let saved = try await repository.checkpoint(draft, replacing: base)
            await gate.hold()
            return saved
        }
        session.open(fixture.a, replacing: fixture.a)
        var first = fixture.a
        first.trip.name = "First edit"
        session.replace(first, success: "First saved")
        try await eventually { gate.waiting }
        var latest = first
        latest.trip.name = "Second edit"
        session.replace(latest, success: nil)
        latest.trip.days[0].notes = "Keep the newest note"
        session.replace(latest, success: "Day updated")
        #expect(writes.count == 1 && session.pending && !session.needsRetry)
        gate.release()
        try await eventually { writes.count == 2 && gate.waiting }
        #expect(session.draft == latest && session.pending)
        #expect(writes[0].base == fixture.a)
        #expect(writes[1].base == first && writes[1].draft == latest)
        gate.release()
        await session.waitForCheckpoint()
        #expect(!session.pending && !session.isWriting && session.notice == "Day updated")
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id) == latest)
        session.reset()
        await fixture.session.stopAndWait()
    }

    @Test func failedDiskWriteRetainsEditsAndRetriesAgainstTheSameBase() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        var fail = true
        var bases: [TripDraft?] = []
        let session = TripDraftSession(account: fixture.session) { repository, draft, base in
            bases.append(base)
            if fail { throw URLError(.cannotWriteToFile) }
            return try await repository.checkpoint(draft, replacing: base)
        }
        session.open(fixture.a, replacing: fixture.a)
        var edited = fixture.a
        edited.trip.name = "Retained after failure"
        session.replace(edited, success: "Day updated")
        await session.waitForCheckpoint()
        #expect(session.draft == edited && session.needsRetry && !session.conflict)
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id) == fixture.a)
        fail = false
        session.requestCheckpoint()
        await session.waitForCheckpoint()
        #expect(bases == [fixture.a, fixture.a])
        #expect(!session.pending && !session.needsRetry && session.notice == "Day updated")
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id) == edited)
        session.reset()
        await fixture.session.stopAndWait()
    }

    @Test func concurrentMapEditIsNotOverwrittenByAnOlderPlannerBase() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = DraftWriteGate()
        let session = TripDraftSession(account: fixture.session) { repository, draft, base in
            await gate.hold()
            return try await repository.checkpoint(draft, replacing: base)
        }
        session.open(fixture.a, replacing: fixture.a)
        var edited = fixture.a
        edited.trip.name = "Unsaved Planner title"
        session.replace(edited, success: nil)
        try await eventually { gate.waiting }
        let day = fixture.a.trip.days[0]
        try await fixture.repository.editDay(
            .init(tripID: fixture.a.id, dayID: day.id),
            edit: .notes(expected: day.notes, value: "New Map note"))
        gate.release()
        await session.waitForCheckpoint()
        #expect(session.pending && session.conflict && !session.needsRetry)
        #expect(session.draft == edited && session.notice?.contains("changed on the map") == true)
        let stored = try #require(try await fixture.repository.currentDraft(id: fixture.a.id))
        #expect(stored.trip.name == fixture.a.trip.name && stored.trip.days[0].notes == "New Map note")
        session.open(stored, replacing: stored)
        #expect(session.draft == stored && !session.pending && !session.conflict && session.notice == nil)
        session.reset()
        await fixture.session.stopAndWait()
    }

    @Test func lateCancelledWriteCannotChangeOrClearANewSessionsWrite() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let oldGate = DraftWriteGate()
        let newGate = DraftWriteGate()
        let session = TripDraftSession(account: fixture.session) { _, draft, _ in
            // Deliberately ignores cancellation to exercise the session's completion guard.
            if draft.id == fixture.a.id { await oldGate.hold() } else { await newGate.hold() }
            return draft
        }
        session.open(fixture.a, replacing: fixture.a)
        session.replace(fixture.a, success: "Old success")
        try await eventually { oldGate.waiting }
        var waitingForOldWrite = false
        let oldCompletion = Task {
            waitingForOldWrite = true
            await session.waitForCheckpoint()
        }
        try await eventually { waitingForOldWrite }
        session.reset()
        session.open(fixture.b, replacing: fixture.b)
        session.replace(fixture.b, success: "New success")
        try await eventually { newGate.waiting }
        oldGate.release()
        await oldCompletion.value
        #expect(session.draft == fixture.b && session.pending && session.isWriting)
        #expect(!session.conflict && session.notice == nil)
        newGate.release()
        await session.waitForCheckpoint()
        #expect(session.draft == fixture.b && !session.pending && !session.isWriting)
        #expect(session.notice == "New success")
        session.reset()
        await fixture.session.stopAndWait()
    }

    @Test func accountChangeRejectsWriteFeedbackBeforeTheEditorResets() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let gate = DraftWriteGate()
        let session = TripDraftSession(account: fixture.session) { _, draft, _ in
            await gate.hold()
            return draft
        }
        session.open(fixture.a, replacing: fixture.a)
        session.replace(fixture.a, success: "Wrong account success")
        try await eventually { gate.waiting }
        fixture.auth.select("user-b")
        try await eventually {
            fixture.session.identity?.uid == "user-b"
                && fixture.session.nativeTrips?.scope.hasSuffix(":user-b") == true
        }
        #expect(fixture.session.state == nil)
        gate.release()
        await session.waitForCheckpoint()
        #expect(!session.pending && session.notice == nil && !session.isWriting)
        session.reset()
        #expect(session.draft == nil && !session.pending && !session.conflict)
        await fixture.session.stopAndWait()
    }
}

@MainActor private final class DraftWriteGate {
    private var continuation: CheckedContinuation<Void, Never>?
    var waiting: Bool { continuation != nil }
    func hold() async { await withCheckedContinuation { continuation = $0 } }
    func release() {
        continuation?.resume()
        continuation = nil
    }
}
