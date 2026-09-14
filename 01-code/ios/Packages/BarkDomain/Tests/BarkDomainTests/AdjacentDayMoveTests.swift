import Foundation
import Testing

@testable import BarkDomain

struct AdjacentDayMoveTests {
    private func stop() throws -> Trip.Stop {
        var stop = Trip.Stop(
            name: "A place", coordinate: try #require(Coordinate(latitude: 44, longitude: -68)))
        stop.notes = "Keep me"
        stop.arrivalTime = "09:30"
        return stop
    }
    @Test func movingToNewDayIsAtomicPreservesIdentityAndRejectsRepeatedIntent() throws {
        let stop = try stop()
        let trip = Trip(days: [.init(id: "first", stops: [stop])])
        let edit = TripDayEdit.moveToNewDay(stop: stop.id, day: .init(id: "second"), expectedOrder: [stop.id])
        let moved = try edit.applying(to: trip, dayID: "first")
        #expect(moved.days.count == 2 && moved.days[0].stops.isEmpty)
        #expect(moved.days[1].stops == [stop])
        #expect(throws: TripDayEdit.Failure.self) { try edit.applying(to: moved, dayID: "first") }
        #expect(trip.days.count == 1 && trip.days[0].stops == [stop])
    }
    @Test func newDayMoveRejectsStaleLastDayAndDayLimit() throws {
        let stop = try stop()
        let edit = TripDayEdit.moveToNewDay(stop: stop.id, day: .init(id: "new"), expectedOrder: [stop.id])
        let stale = Trip(days: [.init(id: "source", stops: [stop]), .init(id: "later")])
        #expect(throws: TripDayEdit.Failure.self) { try edit.applying(to: stale, dayID: "source") }
        var full = Trip(days: (0..<50).map { .init(id: "day-\($0)") })
        full.days[49].stops = [stop]
        #expect(throws: Trip.Failure.self) { try edit.applying(to: full, dayID: "day-49") }
        #expect(full.days.count == 50 && full.days[49].stops == [stop])
    }
    @Test func membershipChoosesExactDayOccurrenceAndKeepsBookendsSeparate() throws {
        let coordinate = try #require(Coordinate(latitude: 44, longitude: -68))
        let park = Park(
            id: .init(rawValue: "park"), siteID: .init(rawValue: "site"), name: "Park", coordinate: coordinate
        )
        let first = Trip.Stop(park: park)
        let second = Trip.Stop(park: park)
        let trip = Trip(days: [.init(id: "one", stops: [first]), .init(id: "two", stops: [second])])
        let selected = try #require(
            TripStopPolicy.membership(of: .init(park: park), in: trip, preferredDayID: "two"))
        #expect(selected.stopID == second.id && selected.dayIndex == 1)
        var bookend = Trip(days: [.init(id: "one")])
        bookend.start = first
        #expect(TripStopPolicy.membership(of: first, in: bookend)?.destination == .start)
    }
    @Test func customPlaceIdentityNeverMatchesAParkByNameOrCoordinates() throws {
        var a = try stop()
        var b = try stop()
        a.placeIdentity = .provider(name: "apple", id: "apple-place")
        b.placeIdentity = .provider(name: "apple", id: "apple-place")
        let trip = Trip(days: [.init(stops: [a])])
        #expect(TripStopPolicy.membership(of: b, in: trip)?.stopID == a.id)
        b.placeIdentity = .custom("independent-pin")
        #expect(TripStopPolicy.membership(of: b, in: trip) == nil)
        let park = Park(
            id: .init(rawValue: "park"), siteID: .init(rawValue: "site"), name: a.name,
            coordinate: try #require(a.coordinate))
        #expect(TripStopPolicy.membership(of: .init(park: park), in: trip) == nil)
    }
    @Test func historicalShadesRemainRecognizedWithoutNumberedMenuChoices() {
        #expect(TripDayColor.palette.map(\.name) == ["Purple", "Orange", "Red", "Magenta"])
        let oldShade = "#8F54F1"
        let shade = TripDayColor.matching(oldShade)
        #expect(shade?.name == "Purple" && shade?.pickerColor == TripDayColor.palette[0])
        let days: [Trip.Day] = [.init(color: oldShade), .init(color: TripDayColor.palette[0].hex)]
        #expect(TripDayColor.assignments(for: days)[0].color.hex == oldShade)
    }
}
