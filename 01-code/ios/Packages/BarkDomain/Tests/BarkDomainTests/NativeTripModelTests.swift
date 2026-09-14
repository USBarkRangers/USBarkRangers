import Foundation
import Testing
@testable import BarkDomain

struct NativeTripModelTests {
    private func trip() throws -> Trip {
        let point = try #require(Coordinate(latitude: 44, longitude: -68))
        return Trip(name: "A trip", days: [.init(id: "day", stops: [
            .init(id: "a", placeIdentity: .custom("pin-a"), name: "A", coordinate: point),
            .init(id: "b", placeIdentity: .custom("pin-b"), name: "B",
                coordinate: try #require(Coordinate(latitude: 45, longitude: -69))),
        ], notes: "Day notes")])
    }

    @Test func typedRoundTripHasNoShadowFieldsAndRejectsInvalidNoteTypes() throws {
        var trip = try trip()
        trip.days[0].stops[0].notes = "Water"
        let data = try JSONEncoder().encode(trip)
        #expect(try JSONDecoder().decode(Trip.self, from: data) == trip)
        let raw = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(raw["fields"] == nil && raw["tripDays"] == nil)
        let days = try #require(raw["days"] as? [[String: Any]])
        #expect(days[0]["fields"] == nil)
        let stops = try #require(days[0]["stops"] as? [[String: Any]])
        #expect(stops[0]["fields"] == nil)
        var invalid = stops[0]
        invalid["notes"] = 42
        let invalidData = try JSONSerialization.data(withJSONObject: invalid)
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(Trip.Stop.self, from: invalidData) }
    }

    @Test func nonRouteEditsDoNotInvalidateInputButVisibleStopChangesDo() throws {
        var trip = try trip()
        let input = TripRouteInput(trip)
        let plan = TripRoutePlan.build(input)
        trip.name = "Renamed"
        trip.days[0].notes = "Unrelated day note"
        trip.days[0].date = "2026-09-13"
        #expect(TripRouteInput(trip) == input)
        trip.days[0].stops[0].notes = "New stop note"
        trip.days[0].stops[0].name = "New label"
        trip.days[0].color = "#ff0000"
        #expect(TripRouteInput(trip) != input)
        let updated = TripRoutePlan.build(trip)
        #expect(updated.days[0].points[0].notes == "New stop note")
        #expect(updated.days[0].points[0].name == "New label")
        #expect(updated.days[0].segments.map(\.geometryKey) == plan.days[0].segments.map(\.geometryKey))
    }

    @Test func identityIsStableAcrossOccurrencesLabelsAndTripsWithoutFuzzyMerging() throws {
        var trip = try trip()
        let stop = trip.days[0].stops[0]
        let occurrence = stop.newOccurrence()
        #expect(occurrence.id != stop.id && occurrence.placeIdentity == stop.placeIdentity)
        #expect(trip.duplicate().days[0].stops[0].placeIdentity == stop.placeIdentity)
        trip.days[0].stops[0].name = "Moved and renamed"
        trip.days[0].stops[0].coordinate = Coordinate(latitude: 0, longitude: 0)
        #expect(trip.days[0].stops[0].placeIdentity.storageID == stop.placeIdentity.storageID)
        #expect(PlaceIdentity.custom("a").storageID != PlaceIdentity.custom("b").storageID)
        #expect(PlaceIdentity.provider(name: "ab", id: "c").storageID
            != PlaceIdentity.provider(name: "a", id: "bc").storageID)
        #expect(PlaceIdentity.official(.init(rawValue: "park")).storageID
            != PlaceIdentity.custom("park").storageID)
    }
}
