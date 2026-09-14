import Foundation
import Testing

@testable import BarkDomain

struct TripRoutePlanTests {
    @Test func bookendsAndPinMembershipFollowPopulatedDaysThroughEdits() throws {
        let start = try park("start", latitude: 40)
        let finish = try park("finish", latitude: 44)
        var trip = Trip(days: [
            .init(id: "empty-first"),
            .init(id: "one", stops: [.init(park: try park("a", latitude: 41))]),
            .init(id: "two", stops: [.init(park: try park("b", latitude: 42))]),
            .init(id: "empty-last"),
        ])
        trip.start = .init(park: start)
        trip.end = .init(park: finish)
        try check(trip, start: start, finish: finish, expectedStart: 1, expectedFinish: 2)

        trip = try TripDayEdit.remove(trip.days[2].stops[0].id).applying(to: trip, dayID: "two")
        try check(trip, start: start, finish: finish, expectedStart: 1, expectedFinish: 1)

        trip = try TripDayEdit.remove(trip.days[1].stops[0].id).applying(to: trip, dayID: "one")
        try check(trip, start: start, finish: finish, expectedStart: 0, expectedFinish: 0)
        #expect(trip.totalStops == 0 && trip.days.count == 4)
        #expect(TripRoutePlan.build(trip).days[0].segments.count == 1)
    }

    @Test func aSingleBookendStaysVisibleWithoutInventingARoute() throws {
        let finish = try park("finish", latitude: 44)
        var trip = Trip(days: [.init(id: "one"), .init(id: "two")])
        trip.end = .init(park: finish)
        #expect(TripRoutePlan.bookendDays(in: trip).finish == 0)
        #expect(TripStopPolicy.membership(of: try #require(trip.end), in: trip)?.dayIndex == 0)
        #expect(TripRoutePlan.build(trip).days.allSatisfy { $0.segments.isEmpty })

        trip.days = []
        #expect(TripRoutePlan.bookendDays(in: trip).finish == nil)
        #expect(TripStopPolicy.membership(of: try #require(trip.end), in: trip) == nil)
        #expect(TripRoutePlan.build(trip).days.isEmpty)
    }

    private func check(
        _ trip: Trip, start: Park, finish: Park, expectedStart: Int, expectedFinish: Int
    ) throws {
        let placement = TripRoutePlan.bookendDays(in: trip)
        #expect(placement.start == expectedStart && placement.finish == expectedFinish)
        #expect(TripStopPolicy.dayIndices(for: start, in: trip) == [expectedStart])
        #expect(TripStopPolicy.dayIndices(for: finish, in: trip) == [expectedFinish])
        #expect(TripStopPolicy.membership(of: try #require(trip.start), in: trip)?.dayIndex == expectedStart)
        #expect(TripStopPolicy.membership(of: try #require(trip.end), in: trip)?.dayIndex == expectedFinish)
        let routes = TripRoutePlan.build(trip)
        #expect(routes.days[expectedStart].points.first?.id == trip.start?.id)
        #expect(routes.days[expectedFinish].points.last?.id == trip.end?.id)
        for index in trip.days.indices where trip.days[index].stops.isEmpty && index != expectedStart {
            #expect(routes.days[index].points.isEmpty && routes.days[index].segments.isEmpty)
        }
    }

    private func park(_ name: String, latitude: Double) throws -> Park {
        Park(
            id: .init(rawValue: name), siteID: .init(rawValue: name), name: name,
            coordinate: try #require(Coordinate(latitude: latitude, longitude: -81)))
    }
}
