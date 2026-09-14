import BarkDomain
import Foundation
import Observation
import Synchronization
import Testing

@testable import BarkRanger

extension NativeTripCostTests {
    @MainActor @Test func editsInAFiveHundredRowLibraryReadNoUnrelatedMetadata() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "library", guest: true)
        let feature = NativeTripFeature(scope: "library", store: store, cloud: nil)
        try await feature.start()
        for page in 0..<50 {
            let items = try (page * 10..<page * 10 + 10).reversed().map { index in
                try #require(
                    nativeTripSnapshot(
                        Trip(id: String(format: "trip-%04d", index), name: "Trip \(index)"), revision: 1
                    ).metadata)
            }
            try await store.acceptTripLibraryPage(.init(items: items, readTime: items[0].updatedAt))
            try await eventually { feature.library.rows.count == (page + 1) * 10 }
        }
        let original = try nativeTripSnapshot(Trip(id: "selected", name: "Selected"), revision: 1)
        try await store.acceptTripSnapshot(original)
        let draft = try await store.openNativeDraft(id: original.tripID)
        try await eventually {
            feature.selectedID == draft.id && feature.library.drafts.first?.id == draft.id
        }
        let reads = Mutex<[Set<String>]>([])
        await store.measureTripLibraryReads { ids in reads.withLock { $0.append(ids) } }
        let displayed = feature.library
        let publication = Mutex(false)
        withObservationTracking {
            _ = feature.library
        } onChange: {
            publication.withLock { $0 = true }
        }
        let beforeNote = feature.revision
        var note = draft
        note.trip.days[0].notes = "Only the local day note changed"
        note = try await store.checkpointNativeDraft(note, replacing: draft)
        try await eventually { feature.revision > beforeNote }
        #expect(feature.library == displayed)
        #expect(!publication.withLock { $0 })
        #expect(reads.withLock { $0 }.isEmpty)

        let beforeTitle = feature.revision
        var renamed = note
        renamed.trip.name = "New selected title"
        _ = try await store.checkpointNativeDraft(renamed, replacing: note)
        try await eventually { feature.revision > beforeTitle }
        #expect(feature.library.drafts.first?.name == "New selected title")
        #expect(reads.withLock { $0 }.isEmpty)

        let selectedRevision = feature.revision
        let unrelated = try nativeTripSnapshot(Trip(id: "trip-0499", name: "Remote rename"), revision: 2)
        try await store.acceptTripLibraryPage(
            .init(items: [try #require(unrelated.metadata)], readTime: unrelated.readTime))
        try await eventually {
            feature.library.saved.first(where: { $0.id == unrelated.tripID })?.name == "Remote rename"
        }
        #expect(reads.withLock { $0 } == [[unrelated.tripID]])
        #expect(feature.revision == selectedRevision)
        #expect(feature.library.rows.count == 501)
        print(
            "NATIVE_TRIP_LIBRARY rows=501 note_metadata_reads=0 title_metadata_reads=0 unrelated_update_metadata_ids=1 unrelated_editor_invalidations=0"
        )
        let lower = try NativeServerTime(seconds: 1_600_000_000, nanoseconds: 0)
        _ = try await store.acceptTripChanges(.init(items: [], upper: lower), requested: .init())
        let time = try NativeServerTime(seconds: 1_700_000_002, nanoseconds: 0)
        let tombstones = try (0..<100).map { index in
            NativeTripMetadata(
                id: String(format: "trip-%04d", index), revision: 2,
                contentRevision: 2, title: nil, dayCount: nil, stopCount: nil, contentBytes: nil,
                deleted: true, createdAt: try NativeServerTime(seconds: 1_700_000_000, nanoseconds: 0),
                updatedAt: time)
        }
        _ = try await store.acceptTripChanges(
            .init(items: tombstones, upper: time), requested: store.tripChangesQuery())
        try await eventually { feature.library.rows.count == 401 }
        #expect(!feature.library.rows.contains { $0.id == "trip-0000" })
        let late = try nativeTripSnapshot(Trip(id: "trip-0000", name: "Trip 0"), revision: 1)
        try await store.acceptTripLibraryPage(
            .init(items: [try #require(late.metadata)], readTime: late.readTime))
        // Wait for a subsequent visible update, proving the coalesced old-page event
        // was consumed without resurrecting the deleted row.
        var afterDeletion = renamed
        afterDeletion.trip.name = "After deletion batch"
        _ = try await store.checkpointNativeDraft(afterDeletion, replacing: renamed)
        try await eventually { feature.library.drafts.first?.name == "After deletion batch" }
        #expect(feature.library.rows.count == 401)
        #expect(!feature.library.rows.contains { $0.id == "trip-0000" })
        await feature.close()
        await store.close()
    }

    @Test func coalescedTripInvalidationsAreBoundedAndKeepSelectionAndPendingSignals() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "events", guest: true)
        let stream = try await store.changes(matching: [.library, .selection, .pending])
        for i in 0..<600 { await store.publish([.library, .trip("trip-\(i)")]) }
        await store.publish([.selection, .pending])
        var iterator = stream.makeAsyncIterator()
        let event = try #require(await iterator.next())
        #expect(event.count <= 512)
        #expect(event.contains(.tripLibraryReset))
        #expect(event.contains(.selection) && event.contains(.pending))
        await store.close()
    }
}

extension NativeTripStoreTests {
    @Test(arguments: [false, true])
    func newerReadOvertakingSaveAcknowledgmentDistinguishesDeletionFromStaleDetail(removed: Bool) async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "ack")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        let original = try nativeTripSnapshot(Trip(id: "ack", name: "Original"), revision: 1)
        try await store.acceptTripSnapshot(original)
        let draft = try await store.openNativeDraft(id: original.tripID)
        var edited = draft
        edited.trip.name = "My saved title"
        edited = try await store.checkpointNativeDraft(edited, replacing: draft)
        let operation = try #require(try await store.stageTripSave(edited))
        _ = try await store.nextTripSubmission(id: edited.id)
        let acknowledged = try nativeTripSnapshot(edited.trip, revision: 2)
        let newer = try nativeTripSnapshot(Trip(id: edited.id, name: "Later remote title"), revision: 3)
        try await store.acceptTripLibraryPage(
            .init(items: [try #require(newer.metadata)], readTime: newer.readTime))
        if removed {
            try await store.acceptTripSnapshot(
                .init(
                    tripID: edited.id, metadata: nil,
                    content: nil, notes: [], readTime: newer.readTime))
        }
        try await store.acceptTripOutcome(
            .init(
                operationID: operation, status: .accepted, revisions: .init(trip: 2, metadata: 2, notes: [:])),
            snapshot: acknowledged)
        if removed {
            #expect(try await store.currentNativeDraft(id: edited.id) == nil)
            #expect(try await store.nativeSelection().tripID == nil)
            #expect(try await store.tripQueueState(edited.id).count == 0)
            await store.close()
            return
        }
        let retained = try #require(try await store.currentNativeDraft(id: edited.id))
        #expect(retained.trip == edited.trip && retained.nativeBase?.contentRevision == 2)
        #expect(try await store.tripQueueState(edited.id).count == 0)
        #expect(try await store.nativeSelection().tripID == edited.id)
        #expect(try await store.restoreCachedNativeSelection(expectedID: edited.id) == nil)
        try await store.acceptTripSnapshot(newer)
        #expect(
            try await store.restoreCachedNativeSelection(expectedID: edited.id)?.trip.name
                == "Later remote title")
        await store.close()
    }
}

extension NativeStore {
    fileprivate func measureTripLibraryReads(_ observer: @escaping @Sendable (Set<String>) -> Void) {
        tripLibraryReadObserver = observer
    }
}
