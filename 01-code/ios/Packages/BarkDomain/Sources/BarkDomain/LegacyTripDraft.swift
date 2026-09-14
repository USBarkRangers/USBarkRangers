import Foundation

/// Decode/recover pre-native device files and historical backend fixtures only.
/// Never used by the native editor, entity store, outbox or callable transport.
public struct LegacyTripDraft: Codable, Equatable, Sendable, Identifiable {
    public var trip: Trip
    public var expected: UserValue
    public var activeDayID: String?
    public var id: String { trip.id }
    public init(trip: Trip, expected: UserValue = .null) {
        self.trip = trip
        self.expected = expected
        activeDayID = trip.days.first?.id
    }
    public var deviceWorkingCopy: TripDraft {
        var draft = TripDraft(trip: trip)
        draft.activeDayID = activeDayID
        return draft
    }
}

extension TripDayEdit {
    public func applying(to draft: LegacyTripDraft, target: TripDayID) throws -> LegacyTripDraft {
        let changed = try applying(to: draft.deviceWorkingCopy, target: target)
        var result = draft
        result.trip = changed.trip
        result.activeDayID = changed.activeDayID
        return result
    }
}
