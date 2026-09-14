import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

struct NativeTripStoreTests {
    private func open(
        _ directory: URL, guest: Bool = false,
        beforeSave: (@Sendable () throws -> Void)? = nil
    ) async throws -> NativeStore {
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "trip-writer",
            guest: guest, beforeSave: beforeSave)
        if !guest, try await store.profileView().confirmed == nil {
            try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
            try await store.acceptEntitlement(
                .init(
                    revision: 1, premium: true, source: .production,
                    validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        }
        return store
    }
    private func trip() -> Trip {
        Trip(
            id: "trip-a", name: "Trip A",
            days: [
                .init(
                    id: "day-a",
                    stops: [
                        .init(
                            id: "stop-a", placeIdentity: .custom("place-a"), name: "Place",
                            coordinate: Coordinate(latitude: 40, longitude: -80), notes: "Original")
                    ])
            ])
    }
    private func snapshot(_ trip: Trip, revision: Int64, noteRevision: Int64? = nil, nanos: Int32 = 0) throws
        -> NativeTripSnapshot
    {
        let input = try NativeTripSave(trip: trip, baseNotes: [:])
        let notes = trip.allStops.filter { !$0.notes.isEmpty }.map { stop in
            NativePlanningNote(
                revision: noteRevision ?? revision, tripID: trip.id, stopID: stop.id,
                placeID: stop.placeIdentity.storageID, text: stop.notes)
        }
        let content = NativeTripContent(
            revision: revision, tripID: trip.id, name: trip.name,
            days: input.days, start: input.start, end: input.end)
        let time = try NativeServerTime(seconds: 1_800_000_000, nanoseconds: nanos)
        return NativeTripSnapshot(
            tripID: trip.id,
            metadata: .init(
                id: trip.id, revision: revision, contentRevision: revision, title: trip.name,
                dayCount: trip.days.count, stopCount: trip.allStops.count, contentBytes: 1000,
                createdAt: time, updatedAt: time),
            content: content, notes: notes, readTime: time)
    }
    private func body(_ value: NativeStore.Submission) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: value.bytes) as? [String: Any])
    }

    @Test func failedCheckpointAndFailedAcknowledgmentRetainExactPriorStateAndSealedBytes() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fail = Mutex(false)
        let store = try await open(
            directory, beforeSave: { if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        let draft = TripDraft(trip: trip(), nativeBase: .init())
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.checkpointNativeDraft(draft, replacing: nil)
        }
        #expect(try await store.currentNativeDraft(id: draft.id) == nil)
        fail.withLock { $0 = false }
        _ = try await store.checkpointNativeDraft(draft, replacing: nil)
        let id = try #require(try await store.stageTripSave(draft))
        #expect(try await store.stageTripSave(draft) == id)
        #expect(try await store.tripQueueState(draft.id).count == 1)
        let sealed = try #require(try await store.nextTripSubmission(id: draft.id))
        let confirmed = try snapshot(draft.trip, revision: 1)
        let outcome = NativeTripOutcome(
            operationID: id, status: .accepted,
            revisions: .init(
                trip: 1, metadata: 1,
                notes: Dictionary(uniqueKeysWithValues: confirmed.notes.map { ($0.id, $0.revision) })))
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.acceptTripOutcome(outcome, snapshot: confirmed)
        }
        #expect(try await store.cachedTrip(id: draft.id) == nil)
        #expect(try await store.currentNativeDraft(id: draft.id) == draft)
        #expect(try await store.nextTripSubmission(id: draft.id) == sealed)
        fail.withLock { $0 = false }
        await store.close()
        let reopened = try await open(directory)
        #expect(try await reopened.nextTripSubmission(id: draft.id) == sealed)
        try await reopened.acceptTripOutcome(outcome, snapshot: confirmed)
        #expect(try await reopened.nextTripSubmission(id: draft.id) == nil)
        #expect(try await reopened.currentNativeDraft(id: draft.id)?.nativeBase?.contentRevision == 1)
        let clean = try #require(try await reopened.currentNativeDraft(id: draft.id))
        #expect(try await reopened.stageTripSave(clean) == nil)
        await reopened.close()
    }

    @Test func queuedSuccessorDoesNotBorrowNewerRemoteNoteOrContentRevision() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await open(directory)
        let original = trip()
        try await store.acceptTripSnapshot(snapshot(original, revision: 1))
        let initial = try #require(try await store.cachedTrip(id: original.id))
        _ = try await store.checkpointNativeDraft(initial, replacing: nil)
        var a = initial
        a.trip.name = "My title"
        _ = try await store.checkpointNativeDraft(a, replacing: initial)
        let aID = try #require(try await store.stageTripSave(a))
        var b = a
        b.trip.days[0].stops[0].notes = "My later note"
        _ = try await store.checkpointNativeDraft(b, replacing: a)
        let bID = try #require(try await store.stageTripSave(b))
        _ = try await store.nextTripSubmission(id: original.id)
        var remote = a.trip
        remote.name = "Another device"
        remote.days[0].stops[0].notes = "Their newer note"
        let noteID = NativePlanningNote.id(tripID: original.id, stopID: "stop-a")
        try await store.acceptTripOutcome(
            .init(
                operationID: aID, status: .accepted,
                revisions: .init(trip: 2, metadata: 2, notes: [noteID: 1])),
            snapshot: snapshot(remote, revision: 7, noteRevision: 3))
        let next = try #require(try await store.nextTripSubmission(id: original.id))
        #expect(next.id == bID)
        let json = try body(next)
        let payload = try #require(json["payload"] as? [String: Any])
        let edits = try #require(payload["notes"] as? [[String: Any]])
        #expect(json["expectedRevision"] as? Int == 2)
        #expect(edits.first?["expectedRevision"] as? Int == 1)  // Not the unrelated remote revision 3.
        #expect(try await store.currentNativeDraft(id: original.id)?.trip == b.trip)
        try await store.acceptTripOutcome(
            .init(operationID: bID, status: .conflict, revisions: .init(trip: 7)),
            snapshot: snapshot(remote, revision: 7, noteRevision: 3))
        #expect(try await store.nextTripSubmission(id: original.id) == nil)
        #expect(
            try await store.currentNativeDraft(id: original.id)?.trip.days[0].stops[0].notes
                == "My later note")
        await store.close()
    }

    @Test func localPageCursorRetainsNanosecondsAndOlderSnapshotCannotReplaceNewerCache() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await open(directory)
        let a = Trip(id: "a", name: "A")
        let b = Trip(id: "b", name: "B")
        try await store.acceptTripSnapshot(snapshot(a, revision: 1, nanos: 2))
        try await store.acceptTripSnapshot(snapshot(b, revision: 1, nanos: 1))
        let page = try await store.tripMetadataPage(limit: 1)
        let first = try #require(page.first)
        #expect(first.id == "a")  // Date loses these two nanoseconds; the stored exact cursor must not.
        let next = try await store.tripMetadataPage(
            before: .init(createdAt: first.createdAt, id: first.id), limit: 1)
        #expect(next.first?.id == "b")
        var newer = a
        newer.name = "Newer"
        try await store.acceptTripSnapshot(snapshot(newer, revision: 2, nanos: 2))
        try await store.acceptTripSnapshot(snapshot(a, revision: 1, nanos: 2))
        #expect(try await store.cachedTrip(id: a.id)?.trip.name == "Newer")
        await store.close()
    }

    @Test func guestDraftIsDurableButCannotQueueCloudWorkOrBorrowAccountScope() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let guest = try await open(directory, guest: true)
        let draft = TripDraft(trip: trip(), nativeBase: .init())
        _ = try await guest.checkpointNativeDraft(draft, replacing: nil)
        await #expect(throws: (any Error).self) { try await guest.stageTripSave(draft) }
        await #expect(throws: (any Error).self) { try await guest.stageProfileEdit(.bootstrap) }
        let account = try await open(directory)
        #expect(try await account.currentNativeDraft(id: draft.id) == nil)
        #expect(try await guest.currentNativeDraft(id: draft.id) == draft)
        await guest.close()
        await account.close()
    }

    @Test func conflictRecoveryRejectsStaleChoiceAndCommitsNewIdentityWithoutLosingLocalTextOnFailure()
        async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fail = Mutex(false)
        let store = try await open(
            directory, beforeSave: { if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        let original = trip()
        try await store.acceptTripSnapshot(snapshot(original, revision: 1))
        let initial = try #require(try await store.cachedTrip(id: original.id))
        _ = try await store.checkpointNativeDraft(initial, replacing: nil)
        var local = initial
        local.trip.days[0].stops[0].notes = "Keep my note"
        _ = try await store.checkpointNativeDraft(local, replacing: initial)
        let oldID = try #require(try await store.stageTripSave(local))
        _ = try await store.nextTripSubmission(id: original.id)
        var remote = original
        remote.days[0].stops[0].notes = "Remote note"
        let confirmed = try snapshot(remote, revision: 3)
        try await store.acceptTripOutcome(
            .init(operationID: oldID, status: .conflict, revisions: .init(trip: 3)), snapshot: confirmed)
        let recovery = NativeTripRecovery(
            tripID: original.id, metadata: confirmed.metadata, notes: confirmed.notes,
            readTime: confirmed.readTime)
        await #expect(throws: (any Error).self) {
            try await store.resolveTripConflict(
                id: original.id, keepLocal: true, expectedDraft: local,
                metadataRevision: 2, snapshot: confirmed, recovery: recovery, expectedOperationIDs: [oldID])
        }
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.resolveTripConflict(
                id: original.id, keepLocal: true, expectedDraft: local,
                metadataRevision: 3, snapshot: confirmed, recovery: recovery, expectedOperationIDs: [oldID])
        }
        #expect(try await store.tripQueueState(original.id).needsDecision)
        #expect(try await store.currentNativeDraft(id: original.id) == local)
        fail.withLock { $0 = false }
        let resolution = try await store.resolveTripConflict(
            id: original.id, keepLocal: true, expectedDraft: local,
            metadataRevision: 3, snapshot: confirmed, recovery: recovery, expectedOperationIDs: [oldID])
        #expect(resolution.operationID != oldID && !resolution.recoveredAsNewTrip)
        let command = try #require(try await store.nextTripSubmission(id: original.id))
        let json = try body(command)
        let payload = try #require(json["payload"] as? [String: Any])
        let edits = try #require(payload["notes"] as? [[String: Any]])
        #expect(json["expectedRevision"] as? Int == 3)
        #expect(edits.first?["expectedRevision"] as? Int == 3)
        #expect(edits.first?["text"] as? String == "Keep my note")
        #expect(try await store.currentNativeDraft(id: original.id)?.trip == local.trip)
        await store.close()
    }

    @Test func selectedTripDeletionCapturesTheDisplayedBaseAndRollsBackSelectionWithTheIntent() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fail = Mutex(false)
        let store = try await open(
            directory, beforeSave: { if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        let original = trip()
        try await store.acceptTripSnapshot(snapshot(original, revision: 1))
        let opened = try await store.openNativeDraft(id: original.id)
        var remote = original
        remote.name = "Unseen remote change"
        let changed = try snapshot(remote, revision: 2)
        try await store.acceptTripLibraryPage(
            .init(items: [try #require(changed.metadata)], readTime: changed.readTime))
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) { try await store.deleteNativeTrip(matching: opened) }
        #expect(try await store.currentNativeDraft(id: opened.id) == opened)
        #expect(try await store.nativeSelection().tripID == opened.id)
        #expect(try await store.tripQueueState(opened.id).count == 0)
        fail.withLock { $0 = false }
        try await store.deleteNativeTrip(matching: opened)
        #expect(try await store.currentNativeDraft(id: opened.id) == nil)
        #expect(try await store.nativeSelection().tripID == nil)
        let command = try #require(try await store.nextTripSubmission(id: opened.id))
        let json = try body(command)
        #expect(json["kind"] as? String == "deleteTrip")
        #expect(json["expectedRevision"] as? Int == 1)  // Never delete revision 2 that this editor did not review.
        let list = try await store.tripLocalLists()
        #expect(list.drafts.isEmpty && list.pending.first?.deleted == true)
        await store.close()
    }

    @Test func undoOfAQueuedSaveStaysDirtyAndAcknowledgedBaseCanAdvanceWhileTyping() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await open(directory)
        let original = trip()
        try await store.acceptTripSnapshot(snapshot(original, revision: 1))
        let initial = try await store.openNativeDraft(id: original.id)
        var edited = initial
        edited.trip.name = "Queued title"
        _ = try await store.checkpointNativeDraft(edited, replacing: initial)
        let id = try #require(try await store.stageTripSave(edited))
        var undone = edited
        undone.trip = original
        _ = try await store.checkpointNativeDraft(undone, replacing: edited)
        #expect(try await store.nativeDraftIsDirty(undone))
        // Force clean-cache pressure after switching away. This undo is not clean cache.
        for i in 0..<26 {
            let other = Trip(id: "clean-\(i)", name: "Clean \(i)")
            try await store.acceptTripSnapshot(snapshot(other, revision: 1))
            _ = try await store.openNativeDraft(id: other.id)
        }
        #expect(try await store.currentNativeDraft(id: original.id)?.trip == original)
        _ = try await store.nextTripSubmission(id: original.id)
        let noteID = NativePlanningNote.id(tripID: original.id, stopID: "stop-a")
        try await store.acceptTripOutcome(
            .init(
                operationID: id, status: .accepted,
                revisions: .init(trip: 2, metadata: 2, notes: [noteID: 1])),
            snapshot: snapshot(edited.trip, revision: 2, noteRevision: 1))
        let accepted = try #require(try await store.currentNativeDraft(id: original.id))
        #expect(accepted.trip == original && accepted.nativeBase?.contentRevision == 2)
        #expect(try await store.nativeDraftIsDirty(accepted))
        // The UI captured its expected value before this acknowledgment, but the editable
        // trip/day still match. Preserve its keystroke with the newly acknowledged base.
        var typing = undone
        typing.trip.days[0].notes = "Typed while confirmation arrived"
        let checkpointed = try await store.checkpointNativeDraft(typing, replacing: undone)
        #expect(checkpointed.nativeBase?.contentRevision == 2)
        #expect(checkpointed.trip.days[0].notes == "Typed while confirmation arrived")
        await store.close()
    }

    @Test func aSaveDeletedRemotelyBeforeItsReplyDoesNotLeaveACleanGhost() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await open(directory)
        let draft = TripDraft(trip: trip(), nativeBase: .init())
        _ = try await store.checkpointNativeDraft(draft, replacing: nil)
        let operationID = try #require(try await store.stageTripSave(draft))
        _ = try await store.nextTripSubmission(id: draft.id)
        let time = try NativeServerTime(seconds: 1_800_000_000, nanoseconds: 0)
        let removed = NativeTripSnapshot(
            tripID: draft.id,
            metadata: .init(
                id: draft.id, revision: 2,
                contentRevision: 2, title: nil, dayCount: nil, stopCount: nil, contentBytes: nil,
                deleted: true, createdAt: time, updatedAt: time), content: nil, notes: [], readTime: time)
        let noteID = NativePlanningNote.id(tripID: draft.id, stopID: "stop-a")
        try await store.acceptTripOutcome(
            .init(
                operationID: operationID, status: .accepted,
                revisions: .init(trip: 1, metadata: 1, notes: [noteID: 1])), snapshot: removed)
        #expect(try await store.currentNativeDraft(id: draft.id) == nil)
        #expect(try await store.nativeSelection().tripID == nil)
        #expect(try await store.tripQueueState(draft.id).count == 0)
        #expect(try await store.tripMetadataPage().isEmpty)
        await store.close()
        let reopened = try await open(directory)
        #expect(try await reopened.tripMetadataPage().isEmpty)
        await reopened.close()
    }

    @Test func aRemoteRefreshUpdatesCleanDraftsButRetainsDirtyDraftsAfterRemoteDeletion() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await open(directory)
        let original = trip()
        try await store.acceptTripSnapshot(snapshot(original, revision: 1))
        let opened = try await store.openNativeDraft(id: original.id)
        var remote = original
        remote.name = "Remote title"
        try await store.acceptTripSnapshot(snapshot(remote, revision: 2))
        let refreshed = try #require(try await store.currentNativeDraft(id: original.id))
        #expect(refreshed.trip == remote)
        await #expect(throws: (any Error).self) { try await store.deleteNativeTrip(matching: opened) }
        var dirty = refreshed
        dirty.trip.days[0].notes = "Unsaved local text"
        _ = try await store.checkpointNativeDraft(dirty, replacing: refreshed)
        let time = try NativeServerTime(seconds: 1_800_000_000, nanoseconds: 0)
        let tombstone = NativeTripSnapshot(
            tripID: original.id,
            metadata: .init(
                id: original.id, revision: 3, contentRevision: 3, title: nil, dayCount: nil,
                stopCount: nil, contentBytes: nil, deleted: true, createdAt: time, updatedAt: time),
            content: nil, notes: [], readTime: time)
        try await store.acceptTripSnapshot(tombstone)
        #expect(try await store.currentNativeDraft(id: original.id) == dirty)
        #expect(try await store.nativeSelection().tripID == original.id)
        #expect(try await store.cachedTrip(id: original.id) == nil)
        await store.close()
    }
}
