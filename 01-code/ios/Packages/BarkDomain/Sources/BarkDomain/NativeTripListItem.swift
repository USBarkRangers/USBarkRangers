import Foundation

/// Small list projections. A trip switcher never needs the itinerary, a draft preimage or note text.
public struct NativeTripListItem: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let dayCount: Int
    public let stopCount: Int
    public let deleted: Bool
    public init(id: String, title: String, dayCount: Int, stopCount: Int, deleted: Bool = false) {
        self.id = id
        self.title = title
        self.dayCount = dayCount
        self.stopCount = stopCount
        self.deleted = deleted
    }
    public init(trip: Trip) {
        id = trip.id
        title = trip.name
        dayCount = trip.days.count
        stopCount = trip.totalStops
        deleted = false
    }
    public func validate() throws {
        guard !id.isEmpty, id.utf8.count <= 128, title.utf16.count <= 100,
            (0...50).contains(dayCount), (0...500).contains(stopCount), deleted || dayCount > 0
        else { throw Trip.Failure.malformed }
    }
}
