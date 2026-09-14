import BarkDomain
import Foundation
import Observation

/// Read-only map projection of visits and the active draft. Never writes personal data or owns search.
@MainActor @Observable final class PersonalParkProjection {
    nonisolated struct Value: Equatable, Sendable {
        struct Place: Equatable, Sendable {
            let stop: Trip.Stop
            let day: TripDayColor.Assignment
            let number: Int?
        }
        var places: [String: Place] = [:]
        var visited: Set<ParkID> = []
        var unconfirmedVisits: Set<ParkID> = []
        var trip: Set<ParkID> = []
        var days: [ParkID: TripDayColor.Assignment] = [:]
        var stopNumbers: [String: [ParkID: [Int]]] = [:]

        func day(for park: Park) -> TripDayColor.Assignment? {
            ([park.id] + park.aliases).compactMap { days[$0] }.min { $0.index < $1.index }
        }
        func visitIsUnconfirmed(for park: Park) -> Bool {
            unconfirmedVisits.contains(park.id) || park.aliases.contains(where: unconfirmedVisits.contains)
        }
        func changedMarkers(from old: Self) -> Set<ParkID> {
            let colors = Set(days.keys).union(old.days.keys).filter { days[$0] != old.days[$0] }
            return visited.symmetricDifference(old.visited).union(colors)
                .union(unconfirmedVisits.symmetricDifference(old.unconfirmedVisits))
        }
    }
    private struct Input: Equatable, Sendable {
        let uid: String?
        let visits: [String: NativeStore.VisitMarker]
        let trip: Trip?
    }
    private let account: AccountSession
    private let activeDraft: (() -> TripDraft?)?
    private var published = Value()
    private var publishedUID: String?
    private var requested: Input?
    private var generation = UUID()
    private var active = false
    private var task: Task<Void, Never>?
    private var scope: String? { account.identity?.uid ?? account.tripScope }
    var value: Value { publishedUID == scope ? published : Value() }
    init(account: AccountSession, activeDraft: (() -> TripDraft?)? = nil) {
        self.account = account
        self.activeDraft = activeDraft
    }
    func start() {
        guard !active else { return }
        active = true
        observe()
    }
    private func observe() {
        let generation = generation
        let input = withObservationTracking {
            let draft = activeDraft?()
            return Input(
                uid: scope,
                visits: account.nativeVisits?.overview?.markers ?? [:],
                trip: draft?.trip)
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.active, self.generation == generation else { return }
                self.observe()
            }
        }
        guard requested != input else { return }
        requested = input
        task?.cancel()
        task = Task { [weak self] in
            let value = await Self.project(input)
            guard let self, !Task.isCancelled, self.requested == input else { return }
            self.publishedUID = input.uid
            self.published = value
            self.task = nil
        }
    }
    @concurrent private static func project(_ input: Input) async -> Value {
        var places: [String: Value.Place] = [:]
        var days: [ParkID: TripDayColor.Assignment] = [:]
        var stopNumbers: [String: [ParkID: [Int]]] = [:]
        if let trip = input.trip {
            let assignments = TripDayColor.assignments(for: trip.days)
            // A repeated park has one stable ring: its earliest assigned day. Connecting road legs
            // do not move the previous day's last park into a different marker state.
            for (day, assignment) in zip(trip.days, assignments) {
                for id in day.stops.compactMap(\.parkID) where days[id] == nil { days[id] = assignment }
                for (index, stop) in day.stops.enumerated() {
                    if let id = stop.parkID {
                        stopNumbers[day.id, default: [:]][id, default: []].append(index + 1)
                    } else {
                        places[stop.id] = Value.Place(stop: stop, day: assignment, number: index + 1)
                    }
                }
            }
            let bookends = TripRoutePlan.bookendDays(in: trip)
            for (stop, index) in [(trip.start, bookends.start), (trip.end, bookends.finish)] {
                guard let stop, let index, assignments.indices.contains(index) else { continue }
                if stop.parkID == nil {
                    places[stop.id] = Value.Place(stop: stop, day: assignments[index], number: nil)
                }
                if let id = stop.parkID, days[id] == nil {
                    days[id] = assignments[index]
                }
            }
        }
        return Value(
            places: places,
            visited: Set(input.visits.values.filter(\.visited).map { ParkID(rawValue: $0.officialPlaceID) }),
            // Keys survive removals (.null). Only acceptance/resolution removes an intent; retries
            // and rejected-but-unresolved changes must not look server-confirmed on the map.
            unconfirmedVisits: Set(
                input.visits.values.filter(\.pending).map { ParkID(rawValue: $0.officialPlaceID) }),
            trip: input.trip?.parkIDs ?? [], days: days, stopNumbers: stopNumbers)
    }
    func stop() {
        generation = UUID()
        active = false
        requested = nil
        task?.cancel()
        task = nil
    }
}
