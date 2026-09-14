import Foundation
import Testing

@testable import BarkDomain

struct TripStopPolicyTests {
    private func park(_ id: String, aliases: [ParkID] = []) throws -> Park {
        Park(
            id: .init(rawValue: id), siteID: .init(rawValue: id), name: id,
            coordinate: try #require(Coordinate(latitude: 44, longitude: -68)), aliases: aliases)
    }
    @Test func newStopsShareIdentityAliasAndBookendRulesWithoutCoordinateDeduplication() throws {
        let a = try park("old-A")
        let b = try park("B")
        let renamed = try park("A", aliases: [a.id])
        let original = Trip(days: [.init(id: "one", stops: [.init(park: a)]), .init(id: "two")])
        let added = try TripStopPolicy.adding(.init(park: b), to: original, destination: .day("two"))
        #expect(added.totalStops == 2, "Different parks at the same coordinate stay distinct")
        #expect(added.dayIndex(containing: renamed) == 0)
        for destination in [TripStopPolicy.Destination.day("two"), .start, .end] {
            #expect(throws: TripDayEdit.Failure.self) {
                try TripStopPolicy.adding(
                    .init(park: renamed), aliases: Set(renamed.aliases),
                    to: added, destination: destination)
            }
        }
        let bookend = try TripStopPolicy.adding(.init(park: renamed), to: Trip(), destination: .start)
        #expect(throws: TripDayEdit.Failure.self) {
            try TripStopPolicy.adding(
                .init(park: renamed), to: bookend, destination: .day(bookend.days[0].id))
        }
    }
    @Test func plannerRoundTripBookendsAreExplicitAndRepeatedHistoryIsNotRewritten() throws {
        let a = try park("A")
        let started = try TripStopPolicy.adding(.init(park: a), to: Trip(), destination: .start)
        let loop = try TripStopPolicy.adding(.init(park: a), to: started, destination: .end)
        #expect(loop.start?.parkID == loop.end?.parkID && loop.start?.id != loop.end?.id)
        let repeated = Trip(days: [
            .init(id: "one", stops: [.init(park: a)]), .init(id: "two", stops: [.init(park: a)]),
        ])
        #expect(TripStopPolicy.dayIndices(for: a, in: repeated) == [0, 1])
        let b = try park("B")
        let added = try TripStopPolicy.adding(.init(park: b), to: repeated, destination: .day("two"))
        #expect(added.days[0] == repeated.days[0])
        #expect(added.days[1].stops.first == repeated.days[1].stops.first)
        var historicalBookend = Trip(
            days: [.init(id: "one", stops: [.init(park: b)]), .init(id: "two", stops: [.init(park: a)])])
        historicalBookend.start = .init(park: a)
        #expect(historicalBookend.dayIndex(containing: a) == 1,
            "Actual day membership keeps precedence over a historical repeated bookend")
    }
    @Test func stopNoteLimitUsesUTF16AndClearDoesNotChangeDayNotes() throws {
        let a = Trip.Stop(park: try park("A"))
        let trip = Trip(days: [.init(id: "day", stops: [a], notes: "Day unchanged")])
        let full = try TripDayEdit.stopNotes(
            id: a.id, expected: "", value: String(repeating: "🐾", count: 500)
        )
        .applying(to: trip, dayID: "day")
        let clear = try TripDayEdit.stopNotes(
            id: a.id, expected: String(repeating: "🐾", count: 500), value: ""
        )
        .applying(to: full, dayID: "day")
        #expect(clear.days[0].notes == "Day unchanged")
        #expect(clear.days[0].stops[0].notes.isEmpty)
        for value in [
            UserValue.string(String(repeating: "🐾", count: 501)),
            .string(String(repeating: "e\u{301}", count: 501)),
        ] {
            var malformed = trip
            malformed.days[0].stops[0].notes = try #require(value.string)
            #expect(throws: Trip.Failure.self) { try malformed.validate() }
        }
        for value in [UserValue.null, .object([:]), .number(1)] {
            #expect(throws: Trip.Failure.self) {
                try TripRecordCodec.decodeStop(.object(["notes": value]), fallbackID: "invalid")
            }
        }
    }
}
