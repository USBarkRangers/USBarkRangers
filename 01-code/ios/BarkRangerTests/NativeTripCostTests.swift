import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

struct NativeTripCostTests {
    @Test func oneNoteInAFiveHundredStopTripTouchesOneDraftAndSavesOnlyTheChangedNoteBody() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "cost")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        let stops = (0..<500).map {
            Trip.Stop(
                id: "s\($0)", placeIdentity: .custom("p\($0)"), name: "Place \($0)",
                coordinate: Coordinate(latitude: 41, longitude: -81), notes: "Original note")
        }
        let trip = Trip(id: "large-trip", name: "Five hundred stops", days: [.init(id: "day", stops: stops)])
        try await store.acceptTripSnapshot(nativeTripSnapshot(trip, revision: 1))
        let original = try #require(try await store.cachedTrip(id: trip.id))
        _ = try await store.checkpointNativeDraft(original, replacing: nil)
        let measurements = Mutex<[[String: Int]]>([])
        await store.measureCommits { row in measurements.withLock { $0.append(row) } }
        let profileEvents = Mutex(0)
        let observation = Task {
            for await _ in try await store.profileUpdates() {
                profileEvents.withLock { $0 += 1 }
            }
        }
        try await eventually { profileEvents.withLock { $0 } == 1 }
        var edit = original
        edit.trip.days[0].stops[250].notes = "Changed exactly one note"
        _ = try await store.checkpointNativeDraft(edit, replacing: original)
        let checkpoint = measurements.withLock { $0 }
        #expect(checkpoint == [["Draft": 1]])
        let id = try #require(try await store.stageTripSave(edit))
        let command = try #require(try await store.nextTripSubmission(id: edit.id))
        #expect(command.id == id)
        let object = try #require(JSONSerialization.jsonObject(with: command.bytes) as? [String: Any])
        let payload = try #require(object["payload"] as? [String: Any])
        #expect(object["kind"] as? String == "saveTripNotes")
        #expect(payload["days"] == nil && payload["start"] == nil && payload["end"] == nil)
        #expect((payload["notes"] as? [Any])?.count == 1)
        // One atomic note command contains neither itinerary nor untouched notes.
        // Compact canonical acknowledgment is verified separately from this local edit.
        #expect(command.bytes.count < 1000)
        // Account presentation now includes the all-feature pending count.
        // The editor checkpoint itself still causes no profile notification.
        try await eventually { profileEvents.withLock { $0 } == 2 }
        #expect(try await store.profileView().totalPendingCount == 1)
        print(
            "NATIVE_TRIP_COST stops=500 checkpoint_rows=\(checkpoint) draft_bytes=\(try JSONEncoder().encode(edit).count) command_bytes=\(command.bytes.count) pending_count_notifications=1 all_commits=\(measurements.withLock { $0 })"
        )
        observation.cancel()
        try await observation.value
        await store.close()
    }

    @Test func reviewedSavedDeletionKeepsItsPreimageAfterCacheEvictionAndRejectsAnUnreviewedDraft()
        async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "delete")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        // The caller still has the reviewed metadata, while this reconstructible
        // cache no longer does. Admission must not substitute a fresh server version.
        _ = try await store.stageTripDeletion(id: "evicted-trip", expectedRevision: 7)
        let command = try #require(try await store.nextTripSubmission(id: "evicted-trip"))
        let body = try #require(JSONSerialization.jsonObject(with: command.bytes) as? [String: Any])
        #expect(body["expectedRevision"] as? Int == 7)
        let draft = TripDraft(trip: Trip(id: "now-edited", name: "Unreviewed draft"))
        _ = try await store.checkpointNativeDraft(draft, replacing: nil)
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.stageTripDeletion(id: draft.id, expectedRevision: 1)
        }
        #expect(try await store.currentNativeDraft(id: draft.id) == draft)
        await store.close()
    }
}

extension NativeStore {
    fileprivate func measureCommits(_ observer: @escaping @Sendable ([String: Int]) -> Void) {
        commitObserver = observer
    }
}
