import Foundation

/// One typed editable itinerary. Transport fields and server history are not editable trip state.
public struct Trip: Codable, Equatable, Sendable, Identifiable {
    public enum Failure: Error { case malformed, dayLimit, notesLimit, invalidStop, sizeLimit }

    public struct Day: Codable, Equatable, Sendable, Identifiable {
        public let id: String
        public var stops: [Stop]
        public var notes: String
        public var color: String
        public var date: String?

        public init(
            id: String = UUID().uuidString.lowercased(), stops: [Stop] = [], notes: String = "",
            color: String = "#475569", date: String? = nil
        ) {
            self.id = id
            self.stops = stops
            self.notes = notes
            self.color = color
            self.date = date
        }
    }

    public let id: String
    public var name: String
    public var days: [Day]
    public var start: Stop?
    public var end: Stop?

    public init(
        id: String = UUID().uuidString.lowercased(), name: String = "New adventure",
        days: [Day] = [Day()], start: Stop? = nil, end: Stop? = nil
    ) {
        self.id = id
        self.name = name
        self.days = days
        self.start = start
        self.end = end
    }

    /// Place identity survives duplication; trip-specific planning content gets a new owner.
    /// J1: shared place journal notes must be referenced, never copied as editable planning notes.
    public func duplicate() -> Trip {
        var title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty { title = "Trip" }
        while title.utf16.count > 95 { title.removeLast() }
        return Trip(name: title + " copy", days: days, start: start, end: end)
    }

    public func dayIndex(containing park: Park) -> Int? {
        TripStopPolicy.dayIndices(for: park, in: self).min()
    }
    public var parkIDs: Set<ParkID> { Set(allStops.compactMap(\.parkID)) }
    public var totalStops: Int { days.reduce(0) { $0 + $1.stops.count } }
    public var allStops: [Stop] { days.flatMap(\.stops) + [start, end].compactMap { $0 } }

    public func validate(allowEmptyName: Bool = false) throws {
        guard (1...50).contains(days.count), Set(days.map(\.id)).count == days.count else {
            throw Failure.dayLimit
        }
        guard allowEmptyName || !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            name.utf16.count <= 100
        else { throw Failure.malformed }
        guard days.allSatisfy({ $0.notes.utf16.count <= 1_000 }),
            allStops.allSatisfy({ $0.notes.utf16.count <= 1_000 })
        else { throw Failure.notesLimit }
        let stops = days.flatMap(\.stops)
        guard Set(allStops.map(\.id)).count == allStops.count,
            allStops.allSatisfy({ $0.coordinate != nil && !$0.name.isEmpty && $0.placeIdentity.isValid })
        else { throw Failure.invalidStop }
        guard stops.count <= 500, try JSONEncoder().encode(self).count <= 350_000 else {
            throw Failure.sizeLimit
        }
    }
}

/// A local working copy, not another authoritative saved itinerary.
public struct TripDraft: Codable, Equatable, Sendable, Identifiable {
    public var trip: Trip
    public var nativeBase: NativeTripBase?
    public var activeDayID: String?
    public var id: String { trip.id }

    public init(trip: Trip, nativeBase: NativeTripBase? = .init()) {
        self.trip = trip
        self.nativeBase = nativeBase
        activeDayID = trip.days.first?.id
    }
}
