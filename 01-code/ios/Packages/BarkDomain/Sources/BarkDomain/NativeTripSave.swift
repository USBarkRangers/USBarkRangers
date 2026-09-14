import Foundation

/// A bounded save intent. Only dirty note bodies are transmitted; unchanged notes remain references.
public struct NativeTripSave: Codable, Equatable, Sendable {
    public struct NoteEdit: Codable, Equatable, Sendable {
        public let id: String
        public let expectedRevision: Int64
        public let text: String
        public init(id: String, expectedRevision: Int64, text: String) {
            self.id = id
            self.expectedRevision = expectedRevision
            self.text = text
        }
    }
    public let tripID: String
    public let name: String
    public let days: [NativeTripContent.Day]
    public let start: NativeTripContent.Stop?
    public let end: NativeTripContent.Stop?
    public let notes: [NoteEdit]

    public init(trip: Trip, baseNotes: [String: NativePlanningNote]) throws {
        try trip.validate()
        var edits: [NoteEdit] = []
        func stop(_ value: Trip.Stop) throws -> NativeTripContent.Stop {
            let id = NativePlanningNote.id(tripID: trip.id, stopID: value.id)
            let base = baseNotes[id]
            if let base {
                try base.validate()
                guard base.tripID == trip.id, base.stopID == value.id,
                    base.placeID == value.placeIdentity.storageID, !base.deleted
                else { throw NativePlanningNote.Failure.invalid }
            }
            let noteID = (base != nil || !value.notes.isEmpty) ? id : nil
            if let noteID, base?.text != value.notes {
                edits.append(NoteEdit(id: noteID, expectedRevision: base?.revision ?? 0, text: value.notes))
            }
            return try NativeTripContent.Stop(value, noteID: noteID)
        }
        tripID = trip.id
        name = trip.name
        days = try trip.days.map { day in
            try NativeTripContent.Day(
                id: day.id, stops: day.stops.map(stop), notes: day.notes, color: day.color, date: day.date)
        }
        start = try trip.start.map(stop)
        end = try trip.end.map(stop)
        notes = edits
    }

}
