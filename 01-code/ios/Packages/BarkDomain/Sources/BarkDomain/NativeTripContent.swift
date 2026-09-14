import CryptoKit
import Foundation

/// Canonical transport/storage itinerary: note bodies live only in independent note records.
/// Trip remains the one editable working copy assembled for a selected trip, not a library item.
public struct NativeTripContent: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let revision: Int64
    public let tripID: String
    public let name: String
    public let days: [Day]
    public let start: Stop?
    public let end: Stop?

    public struct Day: Codable, Equatable, Sendable {
        public let id: String
        public let stops: [Stop]
        public let notes: String
        public let color: String
        public let date: String?
        public init(id: String, stops: [Stop], notes: String, color: String, date: String?) {
            self.id = id
            self.stops = stops
            self.notes = notes
            self.color = color
            self.date = date
        }
    }

    public struct Stop: Codable, Equatable, Sendable {
        public let id: String
        public let placeIdentity: PlaceIdentity
        public let placeID: String
        public let name: String
        public let coordinate: Coordinate
        public let state: String
        public let city: String?
        public let category: ParkCategory?
        public let arrivalTime: String?
        public let visitMinutes: Double?
        public let noteID: String?

        public init(_ stop: Trip.Stop, noteID: String?) throws {
            guard let coordinate = stop.coordinate else { throw Trip.Failure.invalidStop }
            id = stop.id
            placeIdentity = stop.placeIdentity
            placeID = stop.placeIdentity.storageID
            name = stop.name
            self.coordinate = coordinate
            state = stop.state
            city = stop.city
            category = stop.category
            arrivalTime = stop.arrivalTime
            visitMinutes = stop.visitMinutes
            self.noteID = noteID
        }

        public func workingCopy(tripID: String, notes: [String: NativePlanningNote]) throws -> Trip.Stop {
            guard placeIdentity.isValid, placeID == placeIdentity.storageID else {
                throw Trip.Failure.invalidStop
            }
            var text = ""
            if let noteID {
                guard noteID == NativePlanningNote.id(tripID: tripID, stopID: id),
                    let note = notes[noteID], !note.deleted, note.linkedToTrip,
                    note.tripID == tripID, note.stopID == id, note.placeID == placeID
                else {
                    throw NativePlanningNote.Failure.incomplete
                }
                try note.validate()
                text = note.text
            }
            return Trip.Stop(
                id: id, placeIdentity: placeIdentity, name: name, coordinate: coordinate,
                state: state, city: city, category: category, arrivalTime: arrivalTime,
                visitMinutes: visitMinutes, notes: text)
        }
    }

    public init(
        revision: Int64, tripID: String, name: String, days: [Day], start: Stop?, end: Stop?,
        schemaVersion: Int = 1
    ) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.tripID = tripID
        self.name = name
        self.days = days
        self.start = start
        self.end = end
    }

    public var noteIDs: [String] {
        (days.flatMap(\.stops) + [start, end].compactMap { $0 }).compactMap(\.noteID)
    }
    public func workingCopy(notes: [String: NativePlanningNote]) throws -> Trip {
        guard schemaVersion == 1, (1...9_007_199_254_740_991).contains(revision),
            Set(noteIDs).count == noteIDs.count
        else { throw Trip.Failure.malformed }
        let trip = try Trip(
            id: tripID, name: name,
            days: days.map { day in
                try Trip.Day(
                    id: day.id, stops: day.stops.map { try $0.workingCopy(tripID: tripID, notes: notes) },
                    notes: day.notes, color: day.color, date: day.date)
            }, start: start?.workingCopy(tripID: tripID, notes: notes),
            end: end?.workingCopy(tripID: tripID, notes: notes))
        try trip.validate()
        return trip
    }
}
