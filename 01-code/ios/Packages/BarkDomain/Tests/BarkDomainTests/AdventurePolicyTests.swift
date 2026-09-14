import Foundation
import Testing

@testable import BarkDomain

struct AdventurePolicyTests {
    private let now = Date(timeIntervalSince1970: 1_789_000_000)
    private func catalog() throws -> CatalogSnapshot {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent(
            "../../../../BarkRanger/Resources/catalog.json")
        return try JSONDecoder().decode(CatalogSnapshot.self, from: Data(contentsOf: url))
    }
    @Test func proximityQualityAndBoundaryAreExplicit() throws {
        let park = try #require(catalog().parks.first)
        for accuracy in [-1.0, 5001, .nan] {
            #expect(throws: VisitPolicy.Failure.poorLocation) {
                try VisitPolicy.evaluateProximity(
                    park: park, fix: .init(coordinate: park.coordinate, accuracy: accuracy, date: now),
                    now: now)
            }
        }
        #expect(throws: VisitPolicy.Failure.poorLocation) {
            try VisitPolicy.evaluateProximity(
                park: park,
                fix: .init(coordinate: park.coordinate, accuracy: 10, date: now.addingTimeInterval(-60)),
                now: now)
        }
        let outside = try #require(
            Coordinate(latitude: park.coordinate.latitude + 0.23, longitude: park.coordinate.longitude))
        #expect(throws: VisitPolicy.Failure.outOfRange) {
            try VisitPolicy.evaluateProximity(
                park: park, fix: .init(coordinate: outside, accuracy: 10, date: now), now: now)
        }
    }
    @Test func fiftyDaysLongNotesAndOptimizationNeverDropStopsOrNotes() throws {
        let catalog = try catalog()
        let days = (0..<50).map { index in
            Trip.Day(
                id: "day-\(index)", stops: [Trip.Stop(park: catalog.parks[index])],
                notes: String(repeating: "n", count: 1000))
        }
        let trip = Trip(days: days)
        try trip.validate()
        let optimized = TripOptimizer.optimize(trip)
        #expect(Set(optimized.days.flatMap(\.stops).map(\.id)) == Set(trip.days.flatMap(\.stops).map(\.id)))
        #expect(optimized.days.map(\.notes) == trip.days.map(\.notes))
        let partitioned = try TripOptimizer.partition(trip, hoursPerDay: 16, visitMinutes: 0)
        #expect(
            partitioned.totalStops == trip.totalStops
                && partitioned.days.map(\.notes) == trip.days.map(\.notes))
        var invalid = trip
        invalid.days.append(Trip.Day())
        #expect(throws: Trip.Failure.self) { try invalid.validate() }
        invalid = trip
        invalid.days[0].notes += "x"
        #expect(throws: Trip.Failure.notesLimit) { try invalid.validate() }
        #expect(throws: Trip.Failure.self) {
            try TripOptimizer.partition(Trip(days: []), hoursPerDay: 4, visitMinutes: 30)
        }
    }
    @Test func duplicatePreservesItineraryWithoutSharingTripIdentityOrServerHistory() throws {
        var stop = Trip.Stop(park: try #require(catalog().parks.first))
        stop.notes = "Stop note"
        var original = Trip(
            name: String(repeating: "🐾", count: 50),
            days: [.init(stops: [stop], notes: "Day note", color: "#ff0000")])
        original.start = stop.newOccurrence()
        original.end = stop.newOccurrence()
        let copy = original.duplicate()
        try copy.validate()
        #expect(copy.id != original.id && copy.name.utf16.count <= 100 && copy.name.hasSuffix(" copy"))
        #expect(copy.days == original.days && copy.start == original.start && copy.end == original.end)
        #expect(copy.days[0].stops[0].notes == "Stop note")
        #expect(copy.days[0].stops[0].placeIdentity == stop.placeIdentity)
    }

}
