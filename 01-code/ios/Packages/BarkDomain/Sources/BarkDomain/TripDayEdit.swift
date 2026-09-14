import Foundation

/// Stable map selection and repository target. Day numbers are display positions, never identities.
public struct TripDayID: Hashable, Sendable {
    public let tripID: String
    public let dayID: String
    public init(tripID: String, dayID: String) {
        self.tripID = tripID
        self.dayID = dayID
    }
}

/// Narrow day intents apply to the latest draft; they never replace unrelated days or server fields.
public enum TripDayEdit: Sendable {
    case select
    case appendDay(Trip.Day)
    case removeDay
    case color(String)
    case add(Trip.Stop, after: String? = nil, aliases: Set<ParkID> = [])
    case clearBookend(start: Bool)
    case remove(String)
    case removePark(Set<ParkID>)
    case order([String], expected: [String]? = nil)
    case move(stop: String, from: String, before: String?, sourceOrder: [String], destinationOrder: [String])
    case moveToNewDay(stop: String, day: Trip.Day, expectedOrder: [String])
    case notes(expected: String, value: String)
    case stopNotes(id: String, expected: String, value: String)

    public enum Failure: Error { case missingDay, duplicateStop, changedDay }

    public func applying(to trip: Trip, dayID: String) throws -> Trip {
        var next = trip
        guard let index = next.days.firstIndex(where: { $0.id == dayID }) else { throw Failure.missingDay }
        switch self {
        case .select: break
        case .appendDay(let day):
            guard index == next.days.count - 1, !next.days.contains(where: { $0.id == day.id }) else {
                throw Failure.changedDay
            }
            next.days.append(day)
        case .removeDay:
            guard next.days.count > 1 else { throw Failure.changedDay }
            next.days.remove(at: index)
        case .color(let value): next.days[index].color = value
        case .add(let stop, let after, let aliases):
            return try TripStopPolicy.adding(
                stop, aliases: aliases, to: trip,
                destination: .day(dayID), after: after)
        case .clearBookend(let start):
            if start { next.start = nil } else { next.end = nil }
        case .remove(let id): next.days[index].stops.removeAll { $0.id == id }
        case .removePark(let ids):
            let bookends = TripRoutePlan.bookendDays(in: next)
            func matches(_ stop: Trip.Stop?) -> Bool { stop?.parkID.map(ids.contains) == true }
            if index == bookends.start, matches(next.start) { next.start = nil }
            if index == bookends.finish, matches(next.end) { next.end = nil }
            next.days[index].stops.removeAll { matches($0) }
        case .move(let id, let sourceID, let before, let sourceOrder, let destinationOrder):
            guard let source = next.days.firstIndex(where: { $0.id == sourceID }),
                next.days[source].stops.map(\.id) == sourceOrder,
                next.days[index].stops.map(\.id) == destinationOrder,
                let offset = next.days[source].stops.firstIndex(where: { $0.id == id })
            else { throw Failure.changedDay }
            if before == id, source == index { return next }
            let stop = next.days[source].stops.remove(at: offset)
            if let before {
                guard let insertion = next.days[index].stops.firstIndex(where: { $0.id == before }) else {
                    throw Failure.changedDay
                }
                next.days[index].stops.insert(stop, at: insertion)
            } else {
                next.days[index].stops.append(stop)
            }
        case .moveToNewDay(let id, let day, let expectedOrder):
            guard index == next.days.count - 1, next.days[index].stops.map(\.id) == expectedOrder,
                !next.days.contains(where: { $0.id == day.id }), day.stops.isEmpty,
                let offset = next.days[index].stops.firstIndex(where: { $0.id == id })
            else { throw Failure.changedDay }
            var destination = day
            destination.stops = [next.days[index].stops.remove(at: offset)]
            next.days.append(destination)
        case .order(let ids, let expected):
            let stops = next.days[index].stops
            guard expected == nil || expected == stops.map(\.id),
                Set(stops.map(\.id)).count == stops.count, ids.count == stops.count,
                Set(ids) == Set(stops.map(\.id))
            else { throw Failure.changedDay }
            let byID = Dictionary(uniqueKeysWithValues: stops.map { ($0.id, $0) })
            next.days[index].stops = ids.compactMap { byID[$0] }
        case .notes(let expected, let value):
            guard next.days[index].notes == expected else { throw Failure.changedDay }
            next.days[index].notes = value
        case .stopNotes(let id, let expected, let value):
            guard let stop = next.days[index].stops.firstIndex(where: { $0.id == id }),
                next.days[index].stops[stop].notes == expected
            else { throw Failure.changedDay }
            guard value.utf16.count <= 1_000 else { throw Trip.Failure.notesLimit }
            next.days[index].stops[stop].notes = value
        }
        try next.validate(allowEmptyName: true)
        return next
    }
}

// Both presentation hosts use this policy, including which day remains selected after structural edits.
extension TripDayEdit {
    public func applying(to draft: TripDraft, target: TripDayID) throws -> TripDraft {
        guard draft.id == target.tripID else { throw Failure.missingDay }
        var next = draft
        let index = draft.trip.days.firstIndex { $0.id == target.dayID } ?? 0
        next.trip = try applying(to: draft.trip, dayID: target.dayID)
        if case .appendDay(let day) = self {
            next.activeDayID = day.id
        } else if case .select = self {
            next.activeDayID = target.dayID
        } else if case .removeDay = self {
            if draft.activeDayID == target.dayID {
                next.activeDayID = next.trip.days[max(0, index - 1)].id
            }
        }
        // Content edits may finish after navigation. They must not select their old target again.
        return next
    }
}
