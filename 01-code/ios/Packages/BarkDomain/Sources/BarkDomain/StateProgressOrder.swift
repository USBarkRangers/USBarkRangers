import Foundation

/// Matches the web's nearest-park-per-state ordering, without location services or award mutations.
public enum StateProgressOrder {
    public static func ordered(
        _ badges: [AchievementPolicy.Badge], parks: [Park], reference: Coordinate?
    ) -> [AchievementPolicy.Badge] {
        let states = badges.filter { $0.definition.category == "states" }
        let known = Set(states.compactMap(\.definition.state))
        var distances: [String: Double] = [:]
        if let reference {
            for park in parks where !park.isRetired {
                let distance = reference.distance(to: park.coordinate)
                for state in park.stateCodes where known.contains(state) {
                    distances[state] = min(distances[state] ?? .infinity, distance)
                }
            }
        }
        let nearest = distances.keys.min {
            let first = distances[$0] ?? .infinity
            let second = distances[$1] ?? .infinity
            return first == second ? $0 < $1 : first < second
        }
        let ordered = states.sorted { first, second in
            let firstHere = nearest != nil && first.definition.state == nearest
            let secondHere = nearest != nil && second.definition.state == nearest
            if firstHere != secondHere { return firstHere }
            if first.earned != second.earned { return first.earned }
            if first.earned, first.date != second.date {
                return (first.date ?? .distantPast) > (second.date ?? .distantPast)
            }
            let firstDistance = first.definition.state.flatMap { distances[$0] } ?? .infinity
            let secondDistance = second.definition.state.flatMap { distances[$0] } ?? .infinity
            if firstDistance != secondDistance { return firstDistance < secondDistance }
            if first.definition.name != second.definition.name {
                return first.definition.name < second.definition.name
            }
            return first.id < second.id
        }
        return badges.filter { $0.definition.category != "states" } + ordered
    }
}
