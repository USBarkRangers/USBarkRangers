import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func acceptTripSnapshot(_ snapshot: NativeTripSnapshot) throws {
        try requireOpen()
        try snapshot.validate()
        do {
            guard try stageTripSnapshot(snapshot) else { return }
            try stageCacheRetention()
            try commit()
            var changes: Set<Change> = [
                .library, .trip(snapshot.tripID), .draft(snapshot.tripID), .selection,
            ]
            if let value = snapshot.metadata, value.deleted {
                changes.insert(.tripDeleted(value.id, value.revision))
            }
            publish(changes)
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    /// Stages confirmed rows only; the caller commits these together with any acknowledgment.
    @discardableResult func stageTripSnapshot(_ snapshot: NativeTripSnapshot) throws -> Bool {
        let cached = try tripCacheStamp(snapshot.tripID)
        // A later verified absence is evidence too, not an empty cache that an old reply can refill.
        if let cachedTime = cached?.readTime, cached?.metadata == nil,
            snapshot.readTime < cachedTime
        {
            return false
        }
        if let cachedTime = cached?.readTime, cached?.metadata == nil,
            snapshot.metadata != nil, snapshot.readTime == cachedTime
        {
            return false
        }
        if let metadata = snapshot.metadata {
            let old = try metadataRow(metadata.id)
            if max(old?.revision ?? 0, cached?.metadata?.revision ?? 0) > metadata.revision { return false }
            if let content = snapshot.content, let row = try contentRow(metadata.id),
                cached?.metadata?.deleted == false, row.revision == content.revision
            {
                guard try JSONDecoder().decode(NativeTripContent.self, from: row.bytes) == content
                else { throw Failure.corrupt }
            }
            guard try upsertMetadata(metadata) else { return false }
        } else {
            let old = try metadataRow(snapshot.tripID)
            let metadata = try old.map { try JSONDecoder().decode(NativeTripMetadata.self, from: $0.payload) }
            if let metadata, metadata.updatedAt > snapshot.readTime { return false }
            if let time = cached?.readTime, time > snapshot.readTime { return false }
            // Verified point-read absence clears only reconstructible cache, never drafts/intents.
            if let old { modelContext.delete(old) }
        }
        let record = NativeTripCacheStamp(snapshot, previousReadTime: cached?.readTime)
        let stamp = try JSONEncoder().encode(record)
        let bytes = try snapshot.content.map { try JSONEncoder().encode($0) } ?? Data()
        let footprint =
            try stamp.count + bytes.count
            + snapshot.notes.reduce(0) { try $0 + JSONEncoder().encode($1).count }
        let revision = snapshot.metadata?.contentRevision ?? 0
        if let row = try contentRow(snapshot.tripID) {
            row.revision = revision
            row.bytes = bytes
            row.readStamp = stamp
            row.byteCount = footprint
            row.lastAccess = Date()
        } else {
            let row = NativeLocalSchema.TripContent(id: snapshot.tripID, revision: revision, bytes: bytes)
            row.readStamp = stamp
            row.byteCount = footprint
            modelContext.insert(row)
        }
        try replaceCurrentNoteCache(tripID: snapshot.tripID, with: snapshot.notes)
        try stageCleanDraftRefresh(id: snapshot.tripID)
        return true
    }

    @discardableResult func upsertMetadata(_ value: NativeTripMetadata) throws -> Bool {
        try value.validate()
        let cached = try tripCacheStamp(value.id)
        if let time = cached?.readTime, cached?.metadata == nil, value.updatedAt <= time { return false }
        if cached?.metadata?.revision ?? 0 > value.revision { return false }
        let bytes = try JSONEncoder().encode(value)
        if let row = try metadataRow(value.id) {
            if row.revision > value.revision { return false }
            let prior = try JSONDecoder().decode(NativeTripMetadata.self, from: row.payload)
            guard prior.createdAt == value.createdAt else { throw Failure.corrupt }
            if row.revision == value.revision {
                guard prior == value else { throw Failure.corrupt }
                return true
            }
            row.revision = value.revision
            row.contentRevision = value.contentRevision
            row.createdAt = value.createdAt.date
            row.updatedAt = value.updatedAt.date
            row.createdSeconds = value.createdAt.seconds
            row.createdNanos = value.createdAt.nanoseconds
            row.isTombstone = value.deleted
            row.payload = bytes
        } else {
            modelContext.insert(
                NativeLocalSchema.TripMetadata(
                    id: value.id, revision: value.revision, contentRevision: value.contentRevision,
                    createdSeconds: value.createdAt.seconds, createdNanos: value.createdAt.nanoseconds,
                    createdAt: value.createdAt.date, updatedAt: value.updatedAt.date,
                    isTombstone: value.deleted,
                    payload: bytes))
        }
        return true
    }

    /// Metadata is not a full detail download. Invalidate old confirmed detail without
    /// borrowing its new revision for the editor's exact preimage. Only deletion clears selection.
    @discardableResult func stageTripMetadataChange(_ value: NativeTripMetadata) throws -> Bool {
        if value.deleted {
            // A tombstone certifies absence without downloading any itinerary. Retain
            // that evidence even if its old library metadata falls outside the page cache.
            return try stageTripSnapshot(
                .init(
                    tripID: value.id, metadata: value, content: nil, notes: [], readTime: value.updatedAt))
        }
        guard try upsertMetadata(value) else { return false }
        let cached = try tripCacheStamp(value.id)
        if cached?.metadata?.revision != value.revision {
            try removeCleanTripContent(value.id)
        }
        return true
    }

    func replaceCurrentNoteCache(tripID: String, with notes: [NativePlanningNote]) throws {
        var query = FetchDescriptor<NativeLocalSchema.PlanningNote>(
            predicate: #Predicate { $0.tripID == tripID })
        query.fetchLimit = 503
        query.propertiesToFetch = [\.id, \.tripID, \.revision]
        let rows = try modelContext.fetch(query)
        guard rows.count <= 502 else { throw Failure.corrupt }
        let existing = Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        guard existing.count == rows.count else { throw Failure.corrupt }
        let received = Set(notes.map(\.id))
        for row in rows where !received.contains(row.id) { modelContext.delete(row) }
        for note in notes {
            try note.validate()
            let bytes = try JSONEncoder().encode(note)
            if let row = existing[note.id] {
                if row.revision > note.revision { continue }
                if row.revision == note.revision {
                    guard try JSONDecoder().decode(NativePlanningNote.self, from: row.bytes) == note else {
                        throw Failure.corrupt
                    }
                } else {
                    row.revision = note.revision
                    row.bytes = bytes
                }
            } else {
                modelContext.insert(
                    NativeLocalSchema.PlanningNote(
                        id: note.id, tripID: tripID, revision: note.revision, bytes: bytes))
            }
        }
    }

    func removeCleanTripContent(_ id: String) throws {
        if let row = try contentRow(id) { modelContext.delete(row) }
        // Drafts retain their exact note preimage. No irreplaceable text is removed here.
        try replaceCurrentNoteCache(tripID: id, with: [])
    }
}
