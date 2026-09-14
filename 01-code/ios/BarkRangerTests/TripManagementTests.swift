import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor struct TripManagementTests {
    @Test func switchWithoutEditingPersistsAndNewTripCannotBeRepeatedWhilePending() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        await model.resumeActive()
        #expect(model.draft?.id == fixture.b.id)
        #expect(model.selectDraft(fixture.a))
        #expect(await model.awaitCheckpoint())
        try await eventually { fixture.session.nativeTrips?.selectedID == fixture.a.id }
        model.resetScope()
        await model.resumeActive()
        #expect(model.draft?.id == fixture.a.id)
        // Both tabs now use the shared active trip, including an accepted selection from Map.
        try await fixture.repository.saveDraft(fixture.b)
        try await eventually { fixture.session.nativeTrips?.selectedID == fixture.b.id }
        await model.resumeActive()
        #expect(model.draft?.id == fixture.b.id)
        #expect(model.newTrip())
        let newID = try #require(model.draft?.id)
        #expect(!model.newTrip() && !model.selectDraft(fixture.a))
        #expect(await model.awaitCheckpoint())
        #expect(try await fixture.repository.store.tripLocalLists().drafts.count == 3)
        #expect(try await fixture.repository.store.pendingTripIDs().isEmpty)
        model.resetScope()
        await model.resumeActive()
        #expect(model.draft?.id == newID)
        model.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func savedAccountTripIsOpenedWhenNoLocalDraftExists() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        try await fixture.repository.store.acceptTripSnapshot(nativeTripSnapshot(fixture.a.trip, revision: 1))
        try await fixture.repository.discardDraft(id: fixture.a.id)
        try await fixture.repository.discardDraft(id: fixture.b.id)
        #expect(try await fixture.repository.store.tripLocalLists().drafts.isEmpty)
        let model = fixture.model()
        model.selectTrip(fixture.a.id)
        try await eventually { !model.saving && model.draft?.id == fixture.a.id }
        #expect(model.draft?.id == fixture.a.id)
        #expect(await model.awaitCheckpoint())
        #expect(model.draft?.nativeBase?.contentRevision == 1)
        try await eventually { fixture.session.nativeTrips?.selectedID == fixture.a.id }
        model.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func duplicateGetsAnIndependentDraftAndCloudSaveIdentity() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.open(fixture.a)
        model.addDay()
        #expect(await model.awaitCheckpoint())
        let original = try #require(model.draft)
        model.duplicateTrip()
        let copy = try #require(model.draft)
        #expect(copy.id != original.id && copy.trip.name == original.trip.name + " copy")
        #expect(copy.trip.days == original.trip.days && copy.activeDayID == original.activeDayID)
        #expect(copy.nativeBase?.contentRevision == 0)
        model.duplicateTrip()
        #expect(model.draft?.id == copy.id, "One pending copy cannot create another copy")
        #expect(await model.awaitCheckpoint())
        model.rename("Independent copy")
        #expect(await model.awaitCheckpoint())
        model.save()
        try await eventually { !model.saving }
        #expect(try await fixture.repository.store.tripQueueState(copy.id).count == 1)
        #expect(try await fixture.repository.currentDraft(id: original.id) == original)
        #expect(try await fixture.repository.store.tripLocalLists().drafts.count == 3)
        #expect(try await fixture.repository.store.pendingTripIDs() == [copy.id])
        model.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func confirmedDeleteUsesTheCurrentTripAndLeavesAnotherTripAvailable() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.selectDraft(fixture.a)
        #expect(await model.awaitCheckpoint())
        model.save()
        try await eventually { !model.saving }
        let deletion = try #require(await model.reviewDeletion(fixture.a.id))
        model.discardTrip(deletion)
        try await eventually { !model.saving && model.draft == nil }
        #expect(try await fixture.repository.store.tripLocalLists().drafts.map(\.id) == [fixture.b.id])
        #expect(try await fixture.repository.store.nativeSelection().tripID == nil)
        #expect(try await fixture.repository.store.tripQueueState(fixture.a.id).count == 2)
        #expect(try await fixture.repository.store.tripLocalLists().pending.first?.deleted == true)
        await model.resumeActive()
        #expect(model.draft == nil)
        #expect(model.selectDraft(fixture.b))
        #expect(await model.awaitCheckpoint())
        #expect(model.draft?.id == fixture.b.id)
        model.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func deletionIsAtomicOnDiskFailureAndRejectsAConcurrentDayEdit() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fail = Mutex(false)
        let store = try await LocalStore.open(
            directory: directory, uid: "delete-test",
            beforeSave: {
                if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) }
            })
        let repository = TripRepository(store: store)
        let a = LegacyTripDraft(trip: Trip(id: "a"))
        let b = LegacyTripDraft(trip: Trip(id: "b"))
        try await store.applyServerSnapshot(
            .init(uid: "delete-test", trips: [a.trip.record]), sequence: store.beginRead())
        try await store.seedPremium()
        try await repository.saveDraft(b)
        try await repository.saveDraft(a)
        let before = try await store.readSnapshot()
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) { try await repository.delete(matching: a) }
        #expect(try await store.readSnapshot() == before)
        fail.withLock { $0 = false }
        try await repository.editDay(
            .init(tripID: a.id, dayID: a.trip.days[0].id),
            edit: .notes(expected: "", value: "New Map edit"))
        await #expect(throws: TripDayEdit.Failure.changedDay) { try await repository.delete(matching: a) }
        let current = try #require(try await repository.currentDraft(id: a.id))
        #expect(current.trip.days[0].notes == "New Map edit")
        try await repository.delete(matching: current)
        #expect(try await store.readSnapshot().drafts == [b])
        #expect(try await store.readSnapshot().visible.trips.isEmpty)
        await store.close()
        try FileManager.default.removeItem(at: directory)
    }
}
