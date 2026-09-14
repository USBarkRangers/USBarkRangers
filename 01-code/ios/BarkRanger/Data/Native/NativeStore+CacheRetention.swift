import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    // Initial measured-workload candidates, not a limit on the user's remote archive.
    // Selected content is pinned; independent dirty drafts and pending intents are never evicted.
    static let tripCacheItems = 24
    static let tripCacheBytes = 12 * 1_024 * 1_024
    static let tripMetadataItems = 250

    func stageCacheRetention() throws {
        let selected = try selectionRow()?.tripID ?? ""
        var contents = FetchDescriptor<NativeLocalSchema.TripContent>(sortBy: [SortDescriptor(\.lastAccess)])
        // One changes page may certify up to 100 deletions in this same transaction.
        contents.fetchLimit = Self.tripCacheItems + 101
        contents.propertiesToFetch = [\.id, \.byteCount, \.lastAccess]
        let rows = try modelContext.fetch(contents)
        guard rows.count <= Self.tripCacheItems + 100 else { throw Failure.corrupt }
        var count = rows.count
        var bytes = rows.reduce(0) { $0 + $1.byteCount }
        for row in rows where row.id != selected {
            guard count > Self.tripCacheItems || bytes > Self.tripCacheBytes else { break }
            count -= 1
            bytes -= row.byteCount
            try removeCleanTripContent(row.id)
        }
        guard count <= Self.tripCacheItems, bytes <= Self.tripCacheBytes else { throw Failure.corrupt }

        var metadata = FetchDescriptor<NativeLocalSchema.TripMetadata>(
            predicate: #Predicate { $0.id != selected },
            sortBy: [
                SortDescriptor(\.createdSeconds, order: .reverse),
                SortDescriptor(\.createdNanos, order: .reverse),
                SortDescriptor(\.id, order: .reverse),
            ])
        // SwiftData includes unsaved rows in this transaction. Do not use a fetch offset
        // to trim them: pending inserts can bypass that offset and evict the new row itself.
        metadata.fetchLimit = 2 * Self.tripMetadataItems + 2
        let candidates = try modelContext.fetch(metadata)
        // A rebuild promotion can overlay 250 retained rows with 250 newer point reads.
        guard candidates.count <= 2 * Self.tripMetadataItems + 1 else { throw Failure.corrupt }
        for row in candidates.dropFirst(Self.tripMetadataItems) { modelContext.delete(row) }
        try stageCleanDraftRetention(selected: selected)
    }

    func stageCleanDraftRetention(selected: String) throws {
        var query = FetchDescriptor<NativeLocalSchema.Draft>(
            predicate: #Predicate { !$0.dirty && $0.id != selected },
            sortBy: [SortDescriptor(\.updatedAt, order: .reverse), SortDescriptor(\.id)])
        query.fetchLimit = Self.tripCacheItems + 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= Self.tripCacheItems + 1 else { throw Failure.corrupt }
        for row in rows.dropFirst(Self.tripCacheItems) { modelContext.delete(row) }
    }
}
