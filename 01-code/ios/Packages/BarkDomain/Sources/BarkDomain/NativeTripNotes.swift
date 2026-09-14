import Foundation

/// A single atomic Save of existing stop notes. New note links, day notes and
/// itinerary edits stay on the full-save path; no second draft/base schema is needed.
public struct NativeTripNotes: Codable, Equatable, Sendable {
    public struct Edit: Codable, Equatable, Sendable {
        public let id: String
        public let stopID: String
        public let expectedRevision: Int64
        public let text: String
    }
    public let tripID: String
    public let notes: [Edit]

    public init?(draft: TripDraft) throws {
        guard let base = draft.nativeBase, base.contentRevision > 0,
            let fingerprint = base.contentFingerprint
        else { return nil }
        try base.validate(tripID: draft.id)
        let save = try NativeTripSave(trip: draft.trip, baseNotes: base.notes)
        guard !save.notes.isEmpty else { return nil }
        var original = draft.trip
        func originalNote(_ stop: Trip.Stop) -> String {
            base.notes[NativePlanningNote.id(tripID: draft.id, stopID: stop.id)]?.text ?? ""
        }
        for day in original.days.indices {
            for stop in original.days[day].stops.indices {
                original.days[day].stops[stop].notes = originalNote(original.days[day].stops[stop])
            }
        }
        if let start = original.start { original.start?.notes = originalNote(start) }
        if let end = original.end { original.end?.notes = originalNote(end) }
        guard try NativeTripBase.fingerprint(original) == fingerprint,
            save.notes.allSatisfy({ base.notes[$0.id]?.linkedToTrip == true && $0.expectedRevision > 0 })
        else { return nil }
        tripID = draft.id
        notes = try save.notes.map { edit in
            guard let note = base.notes[edit.id] else { throw Trip.Failure.malformed }
            return Edit(
                id: edit.id, stopID: note.stopID, expectedRevision: edit.expectedRevision, text: edit.text)
        }
    }
}
