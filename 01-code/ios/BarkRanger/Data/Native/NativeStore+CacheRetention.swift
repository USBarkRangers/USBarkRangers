import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    static let tripCacheItems = NativeSyncPolicy.cleanTripItems
    static let tripCacheBytes = NativeSyncPolicy.cleanTripBytes
    static let tripMetadataItems = 250

    func stageCacheRetention() throws {
        let selected = try selectionRow()?.tripID ?? ""
        try stageCleanDraftRetention(selected: selected)
        var metadata = FetchDescriptor<NativeLocalSchema.TripMetadata>(
            predicate: #Predicate { $0.id != selected },
            sortBy: [
                SortDescriptor(\.createdSeconds, order: .reverse),
                SortDescriptor(\.createdNanos, order: .reverse),
                SortDescriptor(\.id, order: .reverse),
            ])
        // Include pending inserts before trimming; fetch offsets can skip these incorrectly.
        metadata.fetchLimit = 2 * Self.tripMetadataItems + 2
        let candidates = try modelContext.fetch(metadata)
        guard candidates.count <= 2 * Self.tripMetadataItems + 1 else { throw Failure.corrupt }
        for row in candidates.dropFirst(Self.tripMetadataItems) { modelContext.delete(row) }
    }

    /// One budget for reconstructible detail, notes and clean editor copies together.
    /// Active trips, dirty drafts and outbox dependencies are outside this budget: a
    /// cache limit must never destroy writing or turn a large valid offline queue into corruption.
    /// This examines local rows only and never fetches additional cloud trips.
    func stageCleanDraftRetention(selected: String) throws {
        var dirtyQuery = FetchDescriptor<NativeLocalSchema.Draft>(predicate: #Predicate { $0.dirty })
        dirtyQuery.propertiesToFetch = [\.id]
        var protected = Set(try modelContext.fetch(dirtyQuery).map(\.id))
        protected.formUnion(try pendingTripIDs())
        protected.insert(selected)

        var query = FetchDescriptor<NativeLocalSchema.TripContent>()
        query.propertiesToFetch = [\.id, \.byteCount, \.lastAccess]
        let contents = try modelContext.fetch(query).filter { !protected.contains($0.id) }
        var cleanQuery = FetchDescriptor<NativeLocalSchema.Draft>(predicate: #Predicate { !$0.dirty })
        cleanQuery.propertiesToFetch = [\.id, \.updatedAt, \.bytes]
        let drafts = try modelContext.fetch(cleanQuery).filter { !protected.contains($0.id) }
        var sizes: [String: Int] = [:]
        var access: [String: Date] = [:]
        for row in contents {
            guard row.byteCount >= 0 else { throw Failure.corrupt }
            sizes[row.id] = row.byteCount  // Includes the separately stored note cache.
            access[row.id] = row.lastAccess
        }
        for row in drafts {
            sizes[row.id, default: 0] += row.bytes.count
            access[row.id] = max(access[row.id] ?? .distantPast, row.updatedAt)
        }
        var count = sizes.count
        var bytes = sizes.values.reduce(0, +)
        let oldest = sizes.keys.sorted {
            let a = access[$0] ?? .distantPast
            let b = access[$1] ?? .distantPast
            return a == b ? $0 < $1 : a < b
        }
        let draftByID = Dictionary(uniqueKeysWithValues: drafts.map { ($0.id, $0) })
        for id in oldest {
            guard count > Self.tripCacheItems || bytes > Self.tripCacheBytes else { break }
            count -= 1
            bytes -= sizes[id] ?? 0
            try removeCleanTripContent(id)
            if let row = draftByID[id] { modelContext.delete(row) }
        }
    }
}
