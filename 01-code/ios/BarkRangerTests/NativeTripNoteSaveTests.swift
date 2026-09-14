import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

extension NativeTripStoreTests {
    @Test func noteBatchSurvivesReopenFailedAcknowledgmentAndDependentFullSaveAndDelete() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fail = Mutex(false)
        let beforeSave: @Sendable () throws -> Void = {
            if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) }
        }
        var store = try await noteStore(directory, beforeSave: beforeSave)
        let trip = noteTrip()
        try await store.acceptTripSnapshot(nativeTripSnapshot(trip, revision: 1))
        let original = try await store.openNativeDraft(id: trip.id)
        var edited = original
        edited.trip.days[0].stops[0].notes = "Changed one"
        edited.trip.days[0].stops[1].notes = "Changed two"
        _ = try await store.checkpointNativeDraft(edited, replacing: original)
        #expect(try await store.tripQueueState(trip.id).count == 0)  // Typing/Cancel never submits.
        let id = try #require(try await store.stageTripSave(edited))
        #expect(try await store.stageTripSave(edited) == id)
        let sealed = try #require(try await store.nextTripSubmission(id: trip.id))
        #expect(try noteBody(sealed)["kind"] as? String == "saveTripNotes")
        await store.close()
        store = try await noteStore(directory, beforeSave: beforeSave)
        #expect(try await store.nextTripSubmission(id: trip.id) == sealed)
        // Queue another note edit and then an itinerary edit before the first reply.
        var later = edited
        later.trip.days[0].stops[0].notes = "Later typing"
        _ = try await store.checkpointNativeDraft(later, replacing: edited)
        _ = try await store.stageTripSave(later)
        var renamed = later
        renamed.trip.name = "Renamed afterwards"
        _ = try await store.checkpointNativeDraft(renamed, replacing: later)
        _ = try await store.stageTripSave(renamed)
        let firstIntent = NativeTripIntent.notes(edited)
        let first = try noteAcknowledgment(firstIntent, id: id, metadataRevision: 2)
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.acceptTripOutcome(first.0, snapshot: first.1)
        }
        #expect(try await store.nextTripSubmission(id: trip.id) == sealed)
        #expect(try await store.currentNativeDraft(id: trip.id) == renamed)
        fail.withLock { $0 = false }
        try await store.acceptTripOutcome(first.0, snapshot: first.1)
        let second = try #require(try await store.nextTripSubmission(id: trip.id))
        let secondBody = try noteBody(second)
        #expect(secondBody["kind"] as? String == "saveTripNotes")
        #expect(secondBody["expectedRevision"] as? Int == 1)
        let payload = try #require(secondBody["payload"] as? [String: Any])
        let edits = try #require(payload["notes"] as? [[String: Any]])
        #expect(edits.count == 1 && edits[0]["expectedRevision"] as? Int == 2)
        later.nativeBase = try firstIntent.projectedBase(for: later.trip)
        let secondIntent = NativeTripIntent.notes(later)
        let secondAck = try noteAcknowledgment(secondIntent, id: second.id, metadataRevision: 3)
        try await store.acceptTripOutcome(secondAck.0, snapshot: secondAck.1)
        let third = try #require(try await store.nextTripSubmission(id: trip.id))
        #expect(try noteBody(third)["kind"] as? String == "saveTrip")
        #expect(try noteBody(third)["expectedRevision"] as? Int == 1)
        renamed.nativeBase = try secondIntent.projectedBase(for: renamed.trip)
        let thirdAck = try noteAcknowledgment(.save(renamed), id: third.id, metadataRevision: 4)
        try await store.acceptTripOutcome(thirdAck.0, snapshot: thirdAck.1)
        let clean = try #require(try await store.currentNativeDraft(id: trip.id))
        #expect(clean.trip == renamed.trip && clean.nativeBase?.contentRevision == 2)
        #expect(try await store.stageTripSave(clean) == nil)
        var lastNote = clean
        lastNote.trip.days[0].stops[0].notes = "Last note"
        _ = try await store.checkpointNativeDraft(lastNote, replacing: clean)
        _ = try await store.stageTripSave(lastNote)
        try await store.deleteNativeTrip(matching: lastNote)
        let noteCommand = try #require(try await store.nextTripSubmission(id: trip.id))
        let lastAck = try noteAcknowledgment(.notes(lastNote), id: noteCommand.id, metadataRevision: 5)
        try await store.acceptTripOutcome(lastAck.0, snapshot: lastAck.1)
        let delete = try #require(try await store.nextTripSubmission(id: trip.id))
        #expect(try noteBody(delete)["kind"] as? String == "deleteTrip")
        #expect(try noteBody(delete)["expectedRevision"] as? Int == 2)
        #expect(try await store.nativeSelection().tripID == nil)
        await store.close()
    }

    @Test func unchangedItineraryAcknowledgmentStillAdoptsUntouchedRemoteNotes() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await noteStore(directory)
        let trip = noteTrip()
        try await store.acceptTripSnapshot(nativeTripSnapshot(trip, revision: 1))
        let original = try await store.openNativeDraft(id: trip.id)
        var edited = original
        edited.trip.days[0].stops[0].notes = "My edit"
        _ = try await store.checkpointNativeDraft(edited, replacing: original)
        let id = try #require(try await store.stageTripSave(edited))
        _ = try await store.nextTripSubmission(id: trip.id)
        let own = try noteAcknowledgment(.notes(edited), id: id, metadataRevision: 2)
        var remote = TripDraft(
            trip: edited.trip, nativeBase: try NativeTripIntent.notes(edited).projectedBase(for: edited.trip))
        remote.trip.days[0].stops[1].notes = "Untouched note changed remotely"
        let canonical = try noteAcknowledgment(.notes(remote), id: UUID(), metadataRevision: 3).1
        try await store.acceptTripOutcome(own.0, snapshot: canonical)
        let current = try #require(try await store.currentNativeDraft(id: trip.id))
        #expect(current.trip == remote.trip)
        #expect(current.nativeBase?.contentRevision == 1)
        #expect(current.nativeBase?.notes.values.allSatisfy { $0.revision == 2 } == true)
        #expect(try await store.stageTripSave(current) == nil)
        await store.close()
    }
}

private func noteStore(_ directory: URL, beforeSave: @escaping @Sendable () throws -> Void = {}) async throws
    -> NativeStore
{
    let store = try await NativeStore.open(
        directory: directory, project: "demo-bark-native", uid: "notes",
        beforeSave: beforeSave)
    if try await store.profileView().confirmed == nil {
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
    }
    return store
}

private func noteTrip() -> Trip {
    Trip(
        id: "notes",
        days: [
            .init(
                id: "day",
                stops: (0..<2).map { i in
                    Trip.Stop(
                        id: "stop-\(i)", placeIdentity: .custom("place-\(i)"), name: "Place \(i)",
                        coordinate: Coordinate(latitude: 41, longitude: -81), notes: "Original \(i)")
                })
        ])
}

private func noteBody(_ value: NativeStore.Submission) throws -> [String: Any] {
    try #require(JSONSerialization.jsonObject(with: value.bytes) as? [String: Any])
}

private func noteAcknowledgment(_ intent: NativeTripIntent, id: UUID, metadataRevision: Int64) throws
    -> (NativeTripOutcome, NativeTripSnapshot)
{
    let draft = try #require(intent.savedDraft)
    let base = try intent.projectedBase(for: draft.trip)
    let save = try NativeTripSave(trip: draft.trip, baseNotes: base.notes)
    let time = try NativeServerTime(seconds: 1_800_000_000 + metadataRevision, nanoseconds: 0)
    let notes = Dictionary(uniqueKeysWithValues: base.notes.map { ($0.key, $0.value.revision) })
    return (
        .init(
            operationID: id, status: .accepted,
            revisions: .init(trip: base.contentRevision, metadata: metadataRevision, notes: notes)),
        .init(
            tripID: draft.id,
            metadata: .init(
                id: draft.id, revision: metadataRevision,
                contentRevision: base.contentRevision, title: draft.trip.name, dayCount: 1,
                stopCount: draft.trip.totalStops, contentBytes: 2000,
                createdAt: try NativeServerTime(seconds: 1_700_000_000, nanoseconds: 0), updatedAt: time),
            content: .init(
                revision: base.contentRevision, tripID: draft.id, name: draft.trip.name,
                days: save.days, start: save.start, end: save.end), notes: Array(base.notes.values),
            readTime: time)
    )
}
