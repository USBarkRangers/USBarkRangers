import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func tripChangesQuery() throws -> NativeTripChanges.Query {
        try requireOpen()
        let value =
            try tripCursorRow().map {
                try JSONDecoder().decode(NativeTripChanges.Query.self, from: $0.request)
            } ?? .init()
        try value.validate()
        return value
    }

    /// Returns true only when this scan completed. Page writes and the durable next request
    /// commit together; a failed/cancelled network response can never advance this cursor.
    func acceptTripChanges(_ page: NativeTripChanges, requested query: NativeTripChanges.Query) throws -> Bool
    {
        try requireOpen()
        try page.validate(for: query)
        guard try tripChangesQuery() == query else { throw Failure.invalidAcknowledgment }
        do {
            let existing = try tripCursorRow()
            let row =
                try existing
                ?? NativeLocalSchema.TripCursor(
                    request: JSONEncoder().encode(query), rebuilding: query.since == nil)
            if existing == nil { modelContext.insert(row) }
            if page.needsBootstrap {
                try clearTripRebuild()
                row.rebuilding = true
                row.request = try JSONEncoder().encode(NativeTripChanges.Query())
                try commit()
                return false
            }
            var invalidations = Set<Change>()
            if row.rebuilding {
                try stageTripRebuild(page.items)
                // A tombstone is explicit evidence, even before the replacement scan
                // finishes. Absence from a bounded page is never deletion evidence.
                for value in page.items where value.deleted {
                    if try stageTripMetadataChange(value) {
                        invalidations.formUnion([
                            .library, .trip(value.id), .tripDeleted(value.id, value.revision), .selection,
                        ])
                    }
                }
                if page.next == nil {
                    invalidations.formUnion(try promoteTripRebuild(through: page.upper))
                    invalidations.formUnion([.library, .selection])
                    row.rebuilding = false
                }
            } else {
                for value in page.items {
                    if try stageTripMetadataChange(value), value.deleted {
                        invalidations.insert(.tripDeleted(value.id, value.revision))
                    }
                }
                invalidations.formUnion([.library, .selection])
                invalidations.formUnion(page.items.map { .trip($0.id) })
            }
            let next =
                page.next.map { NativeTripChanges.Query(since: query.since, upper: page.upper, after: $0) }
                ?? NativeTripChanges.Query(since: page.upper)
            row.request = try JSONEncoder().encode(next)
            try stageCacheRetention()
            try commit()
            if !invalidations.isEmpty { publish(invalidations) }
            return page.next == nil
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    @discardableResult func acceptTripLibraryPage(_ page: NativeTripPage) throws -> [NativeTripMetadata] {
        try requireOpen()
        try page.validate()
        do {
            var accepted: [NativeTripMetadata] = []
            for value in page.items {
                if try stageTripMetadataChange(value) { accepted.append(value) }
            }
            try stageCacheRetention()
            try commit()
            publish(
                Set(page.items.map { Change.trip($0.id) }).union([.library, .tripLibraryPage, .selection]))
            // Absence from this window is never a deletion and never advances the archive cursor.
            return accepted
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    private func tripCursorRow() throws -> NativeLocalSchema.TripCursor? {
        var query = FetchDescriptor<NativeLocalSchema.TripCursor>()
        query.fetchLimit = 2
        let values = try modelContext.fetch(query)
        guard values.count <= 1, values.first == nil || values.first?.key == "trips" else {
            throw Failure.corrupt
        }
        return values.first
    }

    private func stageTripRebuild(_ items: [NativeTripMetadata]) throws {
        for item in items {
            let id = item.id
            var query = FetchDescriptor<NativeLocalSchema.TripRebuild>(predicate: #Predicate { $0.id == id })
            query.fetchLimit = 2
            let rows = try modelContext.fetch(query)
            guard rows.count <= 1 else { throw Failure.corrupt }
            if let old = rows.first { modelContext.delete(old) }
            if !item.deleted {
                modelContext.insert(
                    NativeLocalSchema.TripRebuild(
                        id: id, createdSeconds: item.createdAt.seconds,
                        createdNanos: item.createdAt.nanoseconds, payload: try JSONEncoder().encode(item)))
            }
        }
        var surplus = FetchDescriptor<NativeLocalSchema.TripRebuild>(sortBy: [
            SortDescriptor(\.createdSeconds, order: .reverse),
            SortDescriptor(\.createdNanos, order: .reverse), SortDescriptor(\.id, order: .reverse),
        ])
        surplus.fetchLimit = Self.tripMetadataItems + 101
        let rows = try modelContext.fetch(surplus)
        guard rows.count <= Self.tripMetadataItems + 100 else { throw Failure.corrupt }
        for row in rows.dropFirst(Self.tripMetadataItems) { modelContext.delete(row) }
    }

    private func promoteTripRebuild(through upper: NativeServerTime) throws -> Set<Change> {
        var invalidations = Set<Change>()
        var prior = FetchDescriptor<NativeLocalSchema.TripMetadata>()
        prior.fetchLimit = Self.tripMetadataItems + 2
        let rows = try modelContext.fetch(prior)
        guard rows.count <= Self.tripMetadataItems + 1 else { throw Failure.corrupt }
        // Keep newer point reads/acknowledgments; the bounded historical scan cannot replace them.
        for row in rows {
            let value = try JSONDecoder().decode(NativeTripMetadata.self, from: row.payload)
            let readTime = try tripCacheStamp(row.id)?.readTime
            if value.updatedAt <= upper, readTime.map({ $0 < upper }) ?? true { modelContext.delete(row) }
        }
        var staged = FetchDescriptor<NativeLocalSchema.TripRebuild>()
        staged.fetchLimit = Self.tripMetadataItems + 1
        let incoming = try modelContext.fetch(staged)
        guard incoming.count <= Self.tripMetadataItems else { throw Failure.corrupt }
        for row in incoming {
            try upsertMetadata(JSONDecoder().decode(NativeTripMetadata.self, from: row.payload))
            modelContext.delete(row)
        }
        // Expired cursors cannot vouch for old clean detail. Drop reconstructible detail,
        // retaining every dirty draft/preimage and queued intent. Selected detail is re-read on demand.
        var content = FetchDescriptor<NativeLocalSchema.TripContent>()
        content.propertiesToFetch = [\.id, \.readStamp, \.revision]
        let cached = try modelContext.fetch(content)
        for row in cached {
            let record = try tripCacheStamp(row.id)
            if record?.metadata?.deleted == true { continue }
            if let time = record?.readTime, time >= upper { continue }
            if let metadata = record?.metadata, !metadata.deleted,
                try metadataRow(row.id)?.revision == metadata.revision
            {
                continue
            }
            invalidations.insert(.trip(row.id))
            try removeCleanTripContent(row.id)
        }
        var drafts = FetchDescriptor<NativeLocalSchema.Draft>(predicate: #Predicate { !$0.dirty })
        drafts.propertiesToFetch = [\.id]
        let clean = try modelContext.fetch(drafts)
        for row in clean {
            if try cachedTrip(id: row.id) != nil || !(try tripOperations(row.id)).isEmpty { continue }
            invalidations.insert(.draft(row.id))
            modelContext.delete(row)
        }
        return invalidations
    }

    private func clearTripRebuild() throws {
        var query = FetchDescriptor<NativeLocalSchema.TripRebuild>()
        query.fetchLimit = Self.tripMetadataItems + 1
        let rows = try modelContext.fetch(query)
        guard rows.count <= Self.tripMetadataItems else { throw Failure.corrupt }
        for row in rows { modelContext.delete(row) }
    }
}
