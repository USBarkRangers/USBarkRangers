import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    struct TripMetadataUpdates: Sendable {
        var values: [NativeTripMetadata] = []
        var absentIDs: Set<String> = []
    }
    func tripMetadataUpdates(ids: Set<String>) throws -> TripMetadataUpdates {
        try requireOpen()
        #if DEBUG
            tripLibraryReadObserver?(ids)
        #endif
        var updates = TripMetadataUpdates()
        for id in ids {
            if let row = try metadataRow(id) {
                let value = try JSONDecoder().decode(NativeTripMetadata.self, from: row.payload)
                try value.validate()
                updates.values.append(value)
            } else if let record = try tripCacheStamp(id) {
                if let metadata = record.metadata {
                    updates.values.append(metadata)
                } else {
                    updates.absentIDs.insert(id)
                }
            }
            // Neither row means eviction, not deletion of a loaded library page.
        }
        return updates
    }
    struct LibraryCursor: Sendable, Equatable {
        let createdAt: NativeServerTime
        let id: String
    }

    func tripMetadataPage(before cursor: LibraryCursor? = nil, limit: Int = 10) throws -> [NativeTripMetadata]
    {
        try requireOpen()
        guard (1...10).contains(limit) else { throw Failure.corrupt }
        var query = FetchDescriptor<NativeLocalSchema.TripMetadata>(
            predicate: #Predicate { !$0.isTombstone },
            sortBy: [
                SortDescriptor(\.createdSeconds, order: .reverse),
                SortDescriptor(\.createdNanos, order: .reverse), SortDescriptor(\.id, order: .reverse),
            ])
        if let cursor {
            let seconds = cursor.createdAt.seconds
            let nanos = cursor.createdAt.nanoseconds
            let id = cursor.id
            query.predicate = #Predicate {
                !$0.isTombstone
                    && ($0.createdSeconds < seconds
                        || ($0.createdSeconds == seconds && $0.createdNanos < nanos)
                        || ($0.createdSeconds == seconds && $0.createdNanos == nanos && $0.id < id))
            }
        }
        query.fetchLimit = limit
        return try modelContext.fetch(query).map { row in
            let value = try JSONDecoder().decode(NativeTripMetadata.self, from: row.payload)
            try value.validate()
            guard value.id == row.id, value.revision == row.revision, !value.deleted, !row.isTombstone else {
                throw Failure.corrupt
            }
            return value
        }
    }

    func cachedTrip(id: String) throws -> TripDraft? {
        try requireOpen()
        guard try tripDetailIsCurrent(id), let row = try contentRow(id) else { return nil }
        let content = try JSONDecoder().decode(NativeTripContent.self, from: row.bytes)
        guard content.tripID == id, content.revision == row.revision else { throw Failure.corrupt }
        let notes = try tripNotes(id: id)
        let trip = try content.workingCopy(notes: notes)
        return TripDraft(
            trip: trip,
            nativeBase: .init(
                contentRevision: content.revision, notes: notes,
                contentFingerprint: try NativeTripBase.fingerprint(trip)))
    }

    func tripCacheStamp(_ id: String) throws -> NativeTripCacheStamp? {
        guard let row = try contentRow(id), let bytes = row.readStamp else { return nil }
        let record = try JSONDecoder().decode(NativeTripCacheStamp.self, from: bytes)
        if let metadata = record.metadata {
            try metadata.validate()
            guard metadata.id == id, metadata.contentRevision == row.revision,
                metadata.updatedAt <= record.readTime
            else { throw Failure.corrupt }
        } else if row.revision != 0 {
            throw Failure.corrupt
        }
        return record
    }

    private func tripDetailIsCurrent(_ id: String) throws -> Bool {
        guard let metadata = try tripCacheStamp(id)?.metadata, !metadata.deleted else { return false }
        if let latest = try metadataRow(id) {
            return !latest.isTombstone && latest.revision == metadata.revision
        }
        return true  // Eviction of the small library row does not invalidate a certified download.
    }

    /// A retained editor preimage is not proof of freshness. Dirty/uncertain work
    /// remains usable offline; clean stale or legacy detail must be refreshed on open.
    func restorableNativeDraft(id: String) throws -> TripDraft? {
        guard let row = try draftRow(id), let draft = try currentNativeDraft(id: id) else { return nil }
        if try row.dirty || !tripOperations(id).isEmpty { return draft }
        guard try tripDetailIsCurrent(id) else { return nil }
        return draft
    }

    func currentNativeDraft(id: String) throws -> TripDraft? {
        try requireOpen()
        guard let row = try draftRow(id), row.transferOwner == nil else { return nil }
        let draft = try JSONDecoder().decode(TripDraft.self, from: row.bytes)
        guard draft.id == id, let base = draft.nativeBase else {
            throw Failure.corrupt
        }
        try base.validate(tripID: draft.id)
        try draft.trip.validate(allowEmptyName: true)
        return draft
    }

    func tripNotes(id: String) throws -> [String: NativePlanningNote] {
        var query = FetchDescriptor<NativeLocalSchema.PlanningNote>(predicate: #Predicate { $0.tripID == id })
        // Cache retains current itinerary notes only. Detached history belongs to a future
        // explicit journal query; do not read that archive to open one trip.
        query.fetchLimit = 503
        let rows = try modelContext.fetch(query)
        guard rows.count <= 502 else { throw Failure.corrupt }
        var notes: [String: NativePlanningNote] = [:]
        for row in rows {
            let note = try JSONDecoder().decode(NativePlanningNote.self, from: row.bytes)
            try note.validate()
            guard note.id == row.id, note.revision == row.revision, note.tripID == id else {
                throw Failure.corrupt
            }
            notes[row.id] = note
        }
        return notes
    }

    func metadataRow(_ id: String) throws -> NativeLocalSchema.TripMetadata? {
        var query = FetchDescriptor<NativeLocalSchema.TripMetadata>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 2
        let values = try modelContext.fetch(query)
        guard values.count <= 1 else { throw Failure.corrupt }
        return values.first
    }
    func contentRow(_ id: String) throws -> NativeLocalSchema.TripContent? {
        var query = FetchDescriptor<NativeLocalSchema.TripContent>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 2
        query.propertiesToFetch = [\.id, \.revision, \.readStamp, \.byteCount, \.lastAccess]
        let values = try modelContext.fetch(query)
        guard values.count <= 1 else { throw Failure.corrupt }
        return values.first
    }
    func draftRow(_ id: String) throws -> NativeLocalSchema.Draft? {
        var query = FetchDescriptor<NativeLocalSchema.Draft>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 2
        let values = try modelContext.fetch(query)
        guard values.count <= 1 else { throw Failure.corrupt }
        return values.first
    }
}
