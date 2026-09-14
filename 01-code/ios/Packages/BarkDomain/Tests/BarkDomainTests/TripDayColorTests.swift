import Foundation
import Testing

@testable import BarkDomain

struct TripDayColorTests {
    @Test func baseColorsRepeatWithoutNumberedLabelsAndReservedMeaningsStayProtected() {
        let trip = Trip(days: (0..<50).map { Trip.Day(id: "day-\($0)") })
        let before = trip.record
        let colors = TripDayColor.assignments(for: trip.days)
        #expect(Set(colors.map(\.color)).count == 4)
        #expect(
            Array(colors.prefix(4).map(\.color.name)) == [
                "Purple", "Orange", "Red", "Magenta",
            ])
        #expect(TripRoutePlan.build(trip).days.map(\.color) == colors.map(\.color.hex))
        #expect(trip.record == before)
        for reserved in [
            "#0F766E", "#00FF00", "#FFFF00", "#2684FF", "#009CCE", "#000000", "yellow", "invalid",
        ] {
            #expect(TripDayColor.matching(reserved) == nil)
            #expect(
                TripDayColor.assignments(for: [.init(color: reserved)])[0].color == TripDayColor.palette[0])
        }
    }
    @Test func explicitChoicesAndRepeatsSurviveDeterministically() {
        let purple = TripDayColor.palette[0]
        let days: [Trip.Day] = [
            .init(id: "a", color: purple.hex), .init(id: "b", color: purple.hex), .init(id: "c"),
        ]
        let colors = TripDayColor.assignments(for: days)
        #expect(colors[0].color == purple)
        #expect(colors[1].color == purple)
        #expect(TripDayColor.assignments(for: days) == colors)
    }
}
