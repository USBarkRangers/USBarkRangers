import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

struct NativeTripReconciliationTests {
    private func item(_ i: Int) throws -> NativeTripMetadata {
        let time = try NativeServerTime(seconds: 1_800_000_000, nanoseconds: Int32(i))
        return NativeTripMetadata(
            id: "trip-\(i)", revision: 1, contentRevision: 1, title: "Trip \(i)",
            dayCount: 1, stopCount: 0, contentBytes: 100, createdAt: time, updatedAt: time)
    }

    @Test func rebuildIsUnpublishedUntilCompleteResumesDurablyAndRetainsDirtyDraftsWithinCacheBudget()
        async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fail = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "scan", guest: true,
            beforeSave: { if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        let upper = try NativeServerTime(seconds: 1_800_000_001, nanoseconds: 0)
        let old = try item(0)
        try await store.acceptTripLibraryPage(.init(items: [old], readTime: upper))
        let draft = TripDraft(trip: Trip(id: "unsaved", name: "Keep me"), nativeBase: .init())
        _ = try await store.checkpointNativeDraft(draft, replacing: nil)
        let query = try await store.tripChangesQuery()
        let firstItems = try (1...100).map(item)
        let first = NativeTripChanges(
            items: firstItems, upper: upper,
            next: .init(updatedAt: try item(100).updatedAt, id: "trip-100"))
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) { try await store.acceptTripChanges(first, requested: query) }
        #expect(try await store.tripChangesQuery() == query)
        #expect(try await store.tripMetadataPage().map(\.id) == [old.id])
        fail.withLock { $0 = false }
        #expect(try await store.acceptTripChanges(first, requested: query) == false)
        #expect(try await store.tripMetadataPage().map(\.id) == [old.id])
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "scan", guest: true)
        let resume = try await reopened.tripChangesQuery()
        #expect(resume.upper == upper && resume.after == first.next)
        let second = NativeTripChanges(
            items: try (101...200).map(item), upper: upper,
            next: .init(updatedAt: try item(200).updatedAt, id: "trip-200"))
        #expect(try await reopened.acceptTripChanges(second, requested: resume) == false)
        let last = NativeTripChanges(items: try (201...300).map(item), upper: upper)
        #expect(try await reopened.acceptTripChanges(last, requested: reopened.tripChangesQuery()) == true)
        let completed = try await reopened.tripChangesQuery()
        #expect(completed.since == upper && completed.after == nil && completed.upper == nil)
        #expect(try await reopened.tripMetadataPage().first?.id == "trip-300")
        var cursor: NativeStore.LibraryCursor?
        var ids: [String] = []
        while true {
            let page = try await reopened.tripMetadataPage(before: cursor)
            guard let last = page.last else { break }
            ids += page.map(\.id)
            cursor = .init(createdAt: last.createdAt, id: last.id)
        }
        #expect(ids.count == 250 && Set(ids).count == 250)
        #expect(!ids.contains(old.id))
        #expect(try await reopened.currentNativeDraft(id: draft.id) == draft)
        await #expect(throws: (any Error).self) {
            try await reopened.acceptTripChanges(first, requested: query)
        }
        await reopened.close()
    }
}
