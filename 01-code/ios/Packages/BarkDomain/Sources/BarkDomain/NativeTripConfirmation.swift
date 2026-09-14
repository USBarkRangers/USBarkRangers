import Foundation

extension NativeTripIntent {
    /// Reconstruct only content whose versions are proven by this commit. Metadata
    /// uses the receipt's resolved server timestamp, never the device clock. Missing
    /// receipts or concurrent edits fall back to the coherent selected-trip reader.
    public func confirmedSnapshot(
        _ outcome: NativeTripOutcome, cached: TripDraft?,
        cachedMetadata: NativeTripMetadata?
    ) throws -> NativeTripSnapshot? {
        try validate()
        try outcome.validate()
        guard outcome.status == .accepted, let metadata = outcome.confirmation,
            metadata.id == tripID, metadata.contentRevision == resultContentRevision
        else { return nil }
        let content: NativeTripContent?
        let notes: [String: NativePlanningNote]
        switch self {
        case .delete:
            guard metadata.deleted else { throw Trip.Failure.malformed }
            content = nil
            notes = [:]
        case .save(let draft):
            let projected = try projectedBase(for: draft.trip)
            guard projected.notes.mapValues(\.revision) == outcome.revisions.notes else { return nil }
            let save = try NativeTripSave(trip: draft.trip, baseNotes: draft.nativeBase?.notes ?? [:])
            content = NativeTripContent(
                revision: resultContentRevision, tripID: tripID, name: save.name,
                days: save.days, start: save.start, end: save.end)
            notes = projected.notes
        case .notes(let draft):
            // A metadata gap means someone changed an untouched note or itinerary.
            // Never attach old text to a newer server metadata version.
            guard let cached, cached.id == tripID, cached.nativeBase?.contentRevision == baseRevision,
                cachedMetadata?.id == tripID, cachedMetadata?.contentRevision == baseRevision,
                cachedMetadata?.revision == metadata.revision - 1,
                let edits = try NativeTripNotes(draft: draft)
            else { return nil }
            var merged = cached.nativeBase?.notes ?? [:]
            for edit in edits.notes {
                guard let old = merged[edit.id], old.revision == edit.expectedRevision,
                    outcome.revisions.notes?[edit.id] == edit.expectedRevision + 1
                else { return nil }
                merged[edit.id] = NativePlanningNote(
                    revision: edit.expectedRevision + 1,
                    tripID: tripID, stopID: old.stopID, placeID: old.placeID, text: edit.text)
            }
            let save = try NativeTripSave(trip: cached.trip, baseNotes: cached.nativeBase?.notes ?? [:])
            content = NativeTripContent(
                revision: resultContentRevision, tripID: tripID, name: save.name,
                days: save.days, start: save.start, end: save.end)
            notes = merged
        }
        let snapshot = NativeTripSnapshot(
            tripID: tripID, metadata: metadata, content: content,
            notes: notes.values.sorted { $0.id < $1.id }, readTime: metadata.updatedAt)
        try snapshot.validate()
        return snapshot
    }
}
