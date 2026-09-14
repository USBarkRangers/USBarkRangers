import Foundation

/// Shared park membership and new-stop rules. Coordinates are geometry, never park identity.
/// Existing repeated stops may be moved/reordered unchanged; this policy governs additions only.
public enum TripStopPolicy {
    public enum Destination: Equatable, Sendable {
        case day(String)
        case start
        case end
    }

    public struct Membership: Sendable {
        public let dayIndex: Int
        public let stopID: String
        public let destination: Destination
    }
    public static func membership(
        of stop: Trip.Stop, aliases: Set<ParkID> = [],
        in trip: Trip, preferredDayID: String? = nil
    ) -> Membership? {
        let parkIDs = aliases.union(stop.parkID.map { [$0] } ?? [])
        func matches(_ other: Trip.Stop) -> Bool {
            if other.id == stop.id { return true }
            if let id = other.parkID { return parkIDs.contains(id) }
            return other.placeIdentity == stop.placeIdentity
        }
        let indices = trip.days.indices.sorted {
            let a = trip.days[$0].id == preferredDayID
            let b = trip.days[$1].id == preferredDayID
            return a != b ? a : $0 < $1
        }
        for index in indices {
            if let found = trip.days[index].stops.first(where: matches) {
                return Membership(dayIndex: index, stopID: found.id, destination: .day(trip.days[index].id))
            }
        }
        let bookends = TripRoutePlan.bookendDays(in: trip)
        if let start = trip.start, matches(start), let index = bookends.start {
            return Membership(dayIndex: index, stopID: start.id, destination: .start)
        }
        if let end = trip.end, matches(end), let index = bookends.finish {
            return Membership(dayIndex: index, stopID: end.id, destination: .end)
        }
        return nil
    }

    public static func dayIndices(for park: Park, in trip: Trip) -> Set<Int> {
        let identities = Set([park.id] + park.aliases)
        func matches(_ stop: Trip.Stop?) -> Bool { stop?.parkID.map(identities.contains) == true }
        var result = Set(trip.days.indices.filter { trip.days[$0].stops.contains { matches($0) } })
        // Keep historical membership presentation: actual day stops take precedence; standalone
        // start/finish parks use the first/last populated day, matching existing marker assignments.
        if !result.isEmpty { return result }
        let bookends = TripRoutePlan.bookendDays(in: trip)
        if matches(trip.start), let index = bookends.start { result.insert(index) }
        if matches(trip.end), let index = bookends.finish { result.insert(index) }
        return result
    }

    public static func adding(
        _ stop: Trip.Stop, aliases: Set<ParkID> = [], to trip: Trip,
        destination: Destination, after: String? = nil
    ) throws -> Trip {
        var next = trip
        let identities = aliases.union(stop.parkID.map { [$0] } ?? [])
        let dayStops = trip.days.flatMap(\.stops)
        let bookends = [destination == .start ? nil : trip.start, destination == .end ? nil : trip.end]
            .compactMap { $0 }
        guard !(dayStops + bookends).contains(where: { $0.id == stop.id }) else {
            throw TripDayEdit.Failure.duplicateStop
        }
        // Planner may use the same park as both start and finish for a round trip. The slot being
        // replaced and opposite bookend are excluded from park-membership checks, not stop-ID checks.
        let membershipStops: [Trip.Stop]
        switch destination {
        case .day: membershipStops = dayStops + bookends
        case .start, .end: membershipStops = dayStops
        }
        guard !membershipStops.contains(where: { $0.parkID.map(identities.contains) == true }) else {
            throw TripDayEdit.Failure.duplicateStop
        }
        switch destination {
        case .start: next.start = stop
        case .end: next.end = stop
        case .day(let id):
            guard let day = next.days.firstIndex(where: { $0.id == id }) else {
                throw TripDayEdit.Failure.missingDay
            }
            if let after {
                guard let anchor = next.days[day].stops.firstIndex(where: { $0.id == after }) else {
                    throw TripDayEdit.Failure.changedDay
                }
                next.days[day].stops.insert(stop, at: anchor + 1)
            } else {
                next.days[day].stops.append(stop)
            }
        }
        try next.validate(allowEmptyName: true)
        return next
    }
}
