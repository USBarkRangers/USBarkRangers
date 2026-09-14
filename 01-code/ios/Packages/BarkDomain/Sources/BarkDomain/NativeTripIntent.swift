import Foundation

/// Durable user intent, separate from its immutable wire envelope and confirmed trip cache.
public enum NativeTripIntent: Codable, Equatable, Sendable {
    case save(TripDraft)
    // A distinct durable kind: never reinterpret older queued/sealed full saves.
    case notes(TripDraft)
    case delete(tripID: String, contentRevision: Int64)

    public var savedDraft: TripDraft? {
        switch self {
        case .save(let draft), .notes(let draft): draft
        case .delete: nil
        }
    }
    public var resultContentRevision: Int64 {
        if case .notes = self { return baseRevision }
        return baseRevision + 1
    }

    public var tripID: String {
        switch self {
        case .save(let draft), .notes(let draft): draft.id
        case .delete(let id, _): id
        }
    }
    public var baseRevision: Int64 {
        switch self {
        case .save(let draft), .notes(let draft): draft.nativeBase?.contentRevision ?? -1
        case .delete(_, let revision): revision
        }
    }
    public func validate() throws {
        guard !tripID.isEmpty, (0..<9_007_199_254_740_991).contains(baseRevision) else {
            throw Trip.Failure.malformed
        }
        if let draft = savedDraft {
            guard let base = draft.nativeBase else { throw Trip.Failure.malformed }
            try base.validate(tripID: draft.id)
            _ = try NativeTripSave(trip: draft.trip, baseNotes: base.notes)
            if case .notes = self, try NativeTripNotes(draft: draft) == nil {
                throw Trip.Failure.malformed
            }
        }
    }

    /// Predict only this command's own writes for an offline dependent save. Do not adopt
    /// an unrelated server revision: a concurrent edit to an untouched note must conflict.
    public func projectedBase(for following: Trip) throws -> NativeTripBase {
        try validate()
        guard let draft = savedDraft, let base = draft.nativeBase, following.id == draft.id else {
            throw Trip.Failure.malformed
        }
        let save = try NativeTripSave(trip: draft.trip, baseNotes: base.notes)
        var notes = base.notes
        let currentIDs = Set(
            draft.trip.allStops.map { NativePlanningNote.id(tripID: draft.id, stopID: $0.id) })
        let edits = Dictionary(uniqueKeysWithValues: save.notes.map { ($0.id, $0) })
        for stop in draft.trip.allStops {
            let id = NativePlanningNote.id(tripID: draft.id, stopID: stop.id)
            if let edit = edits[id] {
                notes[id] = NativePlanningNote(
                    revision: edit.expectedRevision + 1, tripID: draft.id,
                    stopID: stop.id, placeID: stop.placeIdentity.storageID, text: edit.text)
            } else if let old = notes[id], !old.linkedToTrip {
                notes[id] = NativePlanningNote(
                    revision: old.revision + 1, tripID: old.tripID,
                    stopID: old.stopID, placeID: old.placeID, text: old.text)
            }
        }
        // Retain the full accepted itinerary's preimage even if the unsaved draft removed
        // a stop. Undoing that local removal must not lose the saved note's revision.
        // Detached history outside this itinerary is recovered explicitly if relinked later.
        return NativeTripBase(
            contentRevision: resultContentRevision,
            notes: notes.filter { currentIDs.contains($0.key) },
            contentFingerprint: try NativeTripBase.fingerprint(draft.trip))
    }
}
