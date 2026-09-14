import Foundation

/// One pure route-order authority for previews and external handoff. Empty days retain their identity.
public struct TripRoutePlan: Equatable, Sendable {
    public struct Segment: Equatable, Sendable, Identifiable {
        public let id: String
        public let from: Trip.Stop
        public let to: Trip.Stop
        public var geometryKey: String {
            "\(from.coordinate?.latitude ?? 0),\(from.coordinate?.longitude ?? 0)>\(to.coordinate?.latitude ?? 0),\(to.coordinate?.longitude ?? 0)"
        }
    }
    public struct Day: Equatable, Sendable, Identifiable {
        public let id: String
        public let index: Int
        public let color: String
        public let points: [Trip.Stop]
        public let segments: [Segment]
    }
    public let days: [Day]

    /// Bookends follow populated days; an entirely empty itinerary uses its first day.
    /// Presentation and marker membership use this same rule without calculating road routes.
    public static func bookendDays(in trip: Trip) -> (start: Int?, finish: Int?) {
        (
            trip.days.firstIndex { !$0.stops.isEmpty } ?? trip.days.indices.first,
            trip.days.lastIndex { !$0.stops.isEmpty } ?? trip.days.indices.first
        )
    }

    public static func build(_ trip: Trip) -> Self {
        build(TripRouteInput(trip))
    }

    public static func build(_ trip: TripRouteInput) -> Self {
        let colors = TripDayColor.assignments(for: trip.days.map { .init(id: $0.id, color: $0.color) })
        let bookends = trip.bookendDays
        var previous: Trip.Stop?
        let days = trip.days.enumerated().map { index, day in
            var points: [Trip.Stop] = []
            if !day.stops.isEmpty {
                if index == bookends.start, let start = trip.start {
                    points.append(start)
                } else if let previous {
                    points.append(previous)
                }
                points += day.stops
                previous = day.stops.last
                if index == bookends.finish, let end = trip.end { points.append(end) }
            } else if index == bookends.start, index == bookends.finish,
                let start = trip.start, let end = trip.end
            {
                points = [start, end]
            }
            points = points.reduce(into: []) { result, stop in
                if result.last?.coordinate != stop.coordinate || result.isEmpty { result.append(stop) }
            }
            let segments = zip(points, points.dropFirst()).enumerated().map { offset, pair in
                Segment(id: "\(day.id):\(offset):\(pair.0.id)>\(pair.1.id)", from: pair.0, to: pair.1)
            }
            return Day(
                id: day.id, index: index, color: colors[index].color.hex, points: points, segments: segments)
        }
        return Self(days: days)
    }
}
