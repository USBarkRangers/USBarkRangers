import BarkDomain
import Foundation
import SwiftData
import Synchronization
import Testing

@testable import BarkRanger

extension NativeTripReconciliationTests {
    @Test(arguments: [false, true])
    func metadataOnlyDeletionClearsCleanSelectionButNeverDirtyWork(dirty: Bool) async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fail = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "deletion", guest: true,
            beforeSave: { if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        let start = try NativeServerTime(seconds: 1_700_000_000, nanoseconds: 0)
        _ = try await store.acceptTripChanges(.init(items: [], upper: start), requested: .init())
        let original = try nativeTripSnapshot(Trip(id: "remote-delete", name: "Trip"), revision: 1)
        try await store.acceptTripSnapshot(original)
        var draft = try await store.openNativeDraft(id: original.tripID)
        if dirty {
            let base = draft
            draft.trip.days[0].notes = "Keep this unsaved text"
            draft = try await store.checkpointNativeDraft(draft, replacing: base)
        }
        let tombstone = try removedTrip(original)
        let page = NativeTripChanges(items: [try #require(tombstone.metadata)], upper: tombstone.readTime)
        let request = try await store.tripChangesQuery()
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.acceptTripChanges(page, requested: request)
        }
        #expect(try await store.tripChangesQuery() == request)
        #expect(try await store.currentNativeDraft(id: draft.id) == draft)
        #expect(try await store.cachedTrip(id: draft.id) != nil)
        fail.withLock { $0 = false }
        _ = try await store.acceptTripChanges(page, requested: request)
        #expect(try await store.cachedTrip(id: draft.id) == nil)
        #expect(try await store.currentNativeDraft(id: draft.id) == (dirty ? draft : nil))
        #expect(try await store.nativeSelection().tripID == (dirty ? draft.id : nil))
        #expect(
            try await NativeTripRepository(store: store, cloud: nil).restoreActiveDraft()
                == (dirty ? draft : nil))
        try await store.acceptTripSnapshot(original)
        #expect(try await store.cachedTrip(id: draft.id) == nil)
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "deletion", guest: true)
        #expect(try await reopened.currentNativeDraft(id: draft.id) == (dirty ? draft : nil))
        #expect(try await reopened.nativeSelection().tripID == (dirty ? draft.id : nil))
        await reopened.close()
    }

    @Test func noteVersionInvalidatesCleanDetailWithoutBorrowingANewDraftBase() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "notes", guest: true)
        let trip = Trip(
            id: "notes", name: "Notes",
            days: [
                .init(
                    id: "day",
                    stops: [
                        .init(
                            id: "stop", placeIdentity: .custom("place"), name: "Place",
                            coordinate: .init(latitude: 40, longitude: -80), notes: "Old note")
                    ])
            ])
        let original = try nativeTripSnapshot(trip, revision: 1)
        try await store.acceptTripSnapshot(original)
        let opened = try await store.openNativeDraft(id: trip.id)
        let oldMetadata = try #require(original.metadata)
        let time = try NativeServerTime(seconds: 1_700_000_002, nanoseconds: 0)
        let updated = NativeTripSnapshot(
            tripID: trip.id,
            metadata: .init(
                id: trip.id, revision: 2, contentRevision: 1, title: trip.name,
                dayCount: 1, stopCount: 1, contentBytes: oldMetadata.contentBytes,
                createdAt: oldMetadata.createdAt, updatedAt: time),
            content: original.content,
            notes: [
                .init(
                    revision: 2, tripID: trip.id, stopID: "stop",
                    placeID: trip.days[0].stops[0].placeIdentity.storageID, text: "New note")
            ],
            readTime: time)
        try await store.acceptTripLibraryPage(.init(items: [try #require(updated.metadata)], readTime: time))
        #expect(try await store.cachedTrip(id: trip.id) == nil)
        #expect(try await store.restoreCachedNativeSelection(expectedID: trip.id) == nil)
        #expect(try await store.nativeSelection().tripID == trip.id)
        #expect(try await store.currentNativeDraft(id: trip.id) == opened)
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.openNativeDraft(id: trip.id)
        }
        try await store.acceptTripSnapshot(original)  // Late detail must not certify metadata revision 2.
        #expect(try await store.cachedTrip(id: trip.id) == nil)
        try await store.acceptTripSnapshot(updated)
        let refreshed = try #require(try await store.restoreCachedNativeSelection(expectedID: trip.id))
        #expect(refreshed.trip.days[0].stops[0].notes == "New note")
        #expect(refreshed.nativeBase?.contentRevision == 1)
        #expect(try await store.tripCacheStamp(trip.id)?.metadata?.revision == 2)
        await store.close()
    }

    @Test func verifiedAbsenceCannotBeReplacedByAnOlderDetailOrLibraryReply() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "absence", guest: true)
        let snapshot = try nativeTripSnapshot(Trip(id: "gone", name: "Gone"), revision: 1)
        try await store.acceptTripSnapshot(snapshot)
        _ = try await store.openNativeDraft(id: snapshot.tripID)
        let later = try NativeServerTime(seconds: 1_700_000_005, nanoseconds: 0)
        let absent = NativeTripSnapshot(
            tripID: snapshot.tripID, metadata: nil, content: nil, notes: [], readTime: later)
        try await store.acceptTripSnapshot(absent)
        try await store.acceptTripSnapshot(snapshot)
        let accepted = try await store.acceptTripLibraryPage(
            .init(items: [try #require(snapshot.metadata)], readTime: snapshot.readTime))
        #expect(accepted.isEmpty)
        #expect(try await store.tripMetadataPage().isEmpty)
        #expect(try await store.currentNativeDraft(id: snapshot.tripID) == nil)
        #expect(try await store.nativeSelection().tripID == nil)
        #expect(try await store.tripCacheStamp(snapshot.tripID)?.readTime == later)
        await store.close()
    }

    @Test func oldBootstrapPreservesNewerPointReadAndItsCleanSelectedDraft() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "bootstrap", guest: true)
        let original = try nativeTripSnapshot(Trip(id: "trip", name: "Old"), revision: 1)
        let newer = try nativeTripSnapshot(Trip(id: "trip", name: "New"), revision: 3)
        let upper = try NativeServerTime(seconds: 1_700_000_002, nanoseconds: 0)
        try await store.acceptTripSnapshot(newer)
        let draft = try await store.openNativeDraft(id: newer.tripID)
        _ = try await store.acceptTripChanges(
            .init(items: [try #require(original.metadata)], upper: upper), requested: .init())
        #expect(try await store.cachedTrip(id: draft.id)?.trip == newer.content?.workingCopy(notes: [:]))
        #expect(try await store.restoreCachedNativeSelection(expectedID: draft.id) == draft)
        #expect(try await store.tripMetadataPage().first?.revision == 3)
        await store.close()
    }

    @Test func legacyCacheIsNotCertifiedAsFreshAndUpgradePreservesDraftAndSealedIntent() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "legacy")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        let snapshot = try nativeTripSnapshot(Trip(id: "legacy", name: "Original"), revision: 1)
        try await store.acceptTripSnapshot(snapshot)
        let clean = try await store.openNativeDraft(id: snapshot.tripID)
        try await store.writeLegacyTripCache(try #require(snapshot.content))
        #expect(try await store.restoreCachedNativeSelection(expectedID: clean.id) == nil)
        #expect(try await store.currentNativeDraft(id: clean.id) == clean)
        var dirty = clean
        dirty.trip.days[0].notes = "Irreplaceable local text"
        dirty = try await store.checkpointNativeDraft(dirty, replacing: clean)
        _ = try await store.stageTripSave(dirty)
        let sealed = try #require(try await store.nextTripSubmission(id: dirty.id))
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "legacy")
        #expect(try await reopened.restoreCachedNativeSelection(expectedID: dirty.id) == dirty)
        #expect(try await reopened.nextTripSubmission(id: dirty.id) == sealed)
        try await reopened.acceptTripSnapshot(snapshot)
        #expect(try await reopened.tripCacheStamp(dirty.id)?.metadata?.revision == 1)
        #expect(try await reopened.currentNativeDraft(id: dirty.id) == dirty)
        #expect(try await reopened.nextTripSubmission(id: dirty.id) == sealed)
        await reopened.close()
    }
}

private func removedTrip(_ snapshot: NativeTripSnapshot) throws -> NativeTripSnapshot {
    let original = try #require(snapshot.metadata)
    let time = try NativeServerTime(seconds: snapshot.readTime.seconds + 1, nanoseconds: 0)
    return .init(
        tripID: snapshot.tripID,
        metadata: .init(
            id: snapshot.tripID, revision: original.revision + 1,
            contentRevision: original.contentRevision + 1, title: nil, dayCount: nil,
            stopCount: nil, contentBytes: nil, deleted: true, createdAt: original.createdAt, updatedAt: time),
        content: nil, notes: [], readTime: time)
}

extension NativeStore {
    fileprivate func writeLegacyTripCache(_ content: NativeTripContent) throws {
        let row = try #require(try contentRow(content.tripID))
        row.bytes = try JSONEncoder().encode(content)
        row.readStamp = nil
        try commit()
    }
}
