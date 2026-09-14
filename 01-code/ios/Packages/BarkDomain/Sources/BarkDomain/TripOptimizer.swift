import Foundation

/// Local distance estimates produce an explicit proposal; notes and all stop identities survive.
public enum TripOptimizer {
    public static func orderDay(_ stops: [Trip.Stop], from start: Trip.Stop?) -> [Trip.Stop] {
        var remaining = stops
        var result: [Trip.Stop] = []
        var current = start?.coordinate
        while !remaining.isEmpty {
            let next: Int
            if let current {
                next =
                    remaining.indices.min {
                        (remaining[$0].coordinate.map { current.distance(to: $0) } ?? .infinity)
                            < (remaining[$1].coordinate.map { current.distance(to: $0) } ?? .infinity)
                    } ?? 0
            } else {
                next = 0
            }
            let stop = remaining.remove(at: next)
            result.append(stop)
            current = stop.coordinate
        }
        return result
    }
    public static func optimize(_ trip: Trip, dayID: String? = nil) -> Trip {
        var candidate = trip
        var previous = trip.start
        for index in candidate.days.indices {
            if dayID == nil || candidate.days[index].id == dayID {
                candidate.days[index].stops = orderDay(candidate.days[index].stops, from: previous)
            }
            previous = candidate.days[index].stops.last ?? previous
        }
        return candidate
    }
    /// Allocate an estimated driving budget; existing notes stay on their day and no stop is truncated.
    public static func partition(_ trip: Trip, hoursPerDay: Double, visitMinutes: Double) throws -> Trip {
        guard hoursPerDay.isFinite, (1...16).contains(hoursPerDay), visitMinutes.isFinite,
            (0...480).contains(visitMinutes)
        else { throw Trip.Failure.malformed }
        try trip.validate()
        var result = trip
        let ordered = orderDay(trip.days.flatMap(\.stops), from: trip.start)
        result.days = trip.days.map {
            var day = $0
            day.stops = []
            return day
        }
        var index = 0
        var minutes = 0.0
        var previous = trip.start?.coordinate
        for stop in ordered {
            let travel =
                previous.flatMap { start in stop.coordinate.map { start.distance(to: $0) / 1_000 } } ?? 0
            let estimate = travel / 70 * 60 + visitMinutes
            if !result.days[index].stops.isEmpty, minutes + estimate > hoursPerDay * 60 {
                index += 1
                minutes = 0
                if index == result.days.count { result.days.append(Trip.Day()) }
                guard result.days.count <= 50 else { throw Trip.Failure.dayLimit }
            }
            result.days[index].stops.append(stop)
            minutes += estimate
            previous = stop.coordinate
        }
        return result
    }
}
