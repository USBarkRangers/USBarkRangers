import Foundation
import Testing

@testable import BarkDomain

struct StateProgressOrderTests {
    @Test func matchesWebNearestThenRecentCompletionsThenDistance() throws {
        let badges = [badge("TX"), badge("OH"), badge("PA"), badge("NY", date: 20), badge("CA", date: 10)]
        let parks = try [park("OH", longitude: 0.1), park("PA", longitude: 1), park("TX", longitude: 8)]
        let ordered = StateProgressOrder.ordered(
            badges, parks: parks, reference: try #require(Coordinate(latitude: 0, longitude: 0)))
        #expect(ordered.map(\.id) == ["OH", "NY", "CA", "PA", "TX"])
        #expect(ordered.sorted { $0.id < $1.id } == badges.sorted { $0.id < $1.id })
    }

    @Test func usesClosestParkRatherThanStateAverageAndHandlesTerritoriesAndZeroCoordinates() throws {
        let badges = [badge("PA"), badge("GU"), badge("OH")]
        let parks = try [
            park("OH", longitude: 0), park("OH", longitude: 100), park("PA", longitude: 1),
            park("GU", longitude: 2), park("GU", longitude: 0, retired: true),
        ]
        let result = StateProgressOrder.ordered(
            badges, parks: parks, reference: try #require(Coordinate(latitude: 0, longitude: 0)))
        #expect(result.map(\.id) == ["OH", "PA", "GU"])
    }

    @Test func missingLocationUsesStableCompletedThenNameOrderAndPreservesOtherCategories() {
        let other = AchievementPolicy.Badge(
            definition: .init(
                id: "paw", name: "Paw", category: "paws", rule: "visits", criteria: "", target: 1,
                classified: false, state: nil), earned: false, verified: false, date: nil)
        let badges = [badge("TX"), badge("OH"), other, badge("NY", date: 20), badge("CA", date: 10)]
        let ordered = StateProgressOrder.ordered(badges, parks: [], reference: nil)
        #expect(ordered.map(\.id) == ["paw", "NY", "CA", "OH", "TX"])
        #expect(ordered.first == other)
    }

    private func badge(_ code: String, date: TimeInterval? = nil) -> AchievementPolicy.Badge {
        .init(
            definition: .init(
                id: code, name: code, category: "states", rule: "state", criteria: "", target: 1,
                classified: false, state: code),
            earned: date != nil, verified: false, date: date.map(Date.init(timeIntervalSince1970:)))
    }
    private func park(_ state: String, longitude: Double, retired: Bool = false) throws -> Park {
        .init(
            id: .init(rawValue: "\(state)-\(longitude)"), siteID: .init(rawValue: state), name: state,
            coordinate: try #require(Coordinate(latitude: 0, longitude: longitude)),
            stateCodes: [state], isRetired: retired)
    }
}
