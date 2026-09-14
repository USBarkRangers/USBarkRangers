import Foundation

/// Exactly the content used by route presentation. Trip title, day notes/date and save state are absent.
/// Stop labels/notes stay here because the timeline presents them even when geometry is unchanged.
public struct TripRouteInput: Equatable, Sendable {
    public struct Day: Equatable, Sendable {
        public let id: String
        public let stops: [Trip.Stop]
        public let color: String
    }
    public let tripID: String
    public let days: [Day]
    public let start: Trip.Stop?
    public let end: Trip.Stop?

    public init(_ trip: Trip) {
        tripID = trip.id
        days = trip.days.map { Day(id: $0.id, stops: $0.stops, color: $0.color) }
        start = trip.start
        end = trip.end
    }

    var bookendDays: (start: Int?, finish: Int?) {
        (days.firstIndex { !$0.stops.isEmpty } ?? days.indices.first,
         days.lastIndex { !$0.stops.isEmpty } ?? days.indices.first)
    }
}
