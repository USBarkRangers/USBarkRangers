import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct SharedDayControlTests {
    @Test func structuralEditsRejectStalePlusAndRemovalSelectsPreviousDay() throws {
        var draft = TripDraft(
            trip: Trip(
                id: "trip",
                days: [
                    .init(id: "one"), .init(id: "two"), .init(id: "three"), .init(id: "four"),
                ]))
        let target = TripDayID(tripID: draft.id, dayID: "three")
        draft.activeDayID = target.dayID
        let removed = try TripDayEdit.removeDay.applying(to: draft, target: target)
        #expect(removed.activeDayID == "two")
        #expect(removed.trip.days.map(\.id) == ["one", "two", "four"])
        let last = TripDayID(tripID: draft.id, dayID: "four")
        let added = try TripDayEdit.appendDay(.init(id: "five")).applying(to: draft, target: last)
        #expect(added.activeDayID == "five" && added.trip.days.count == 5)
        #expect(throws: TripDayEdit.Failure.self) {
            try TripDayEdit.appendDay(.init(id: "six")).applying(to: added, target: last)
        }
        draft.activeDayID = "one"
        let firstRemoved = try TripDayEdit.removeDay.applying(
            to: draft, target: .init(tripID: draft.id, dayID: "one"))
        #expect(firstRemoved.activeDayID == "two")
        let only = TripDraft(trip: Trip())
        #expect(throws: TripDayEdit.Failure.self) {
            try TripDayEdit.removeDay.applying(
                to: only, target: .init(tripID: only.id, dayID: only.trip.days[0].id))
        }
    }

    @Test func mapHandoffUsesTheSelectedDayAndInjectedMapsAdapter() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let a = Trip.Stop(name: "A", coordinate: try #require(Coordinate(latitude: 44, longitude: -68)))
        let b = Trip.Stop(name: "B", coordinate: try #require(Coordinate(latitude: 44, longitude: -67)))
        let c = Trip.Stop(name: "C", coordinate: try #require(Coordinate(latitude: 44, longitude: -66)))
        var draft = fixture.a
        draft.trip.days = [.init(id: "one", stops: [a, b]), .init(id: "two", stops: [c])]
        draft.activeDayID = "one"
        try await fixture.repository.saveDraft(draft)
        var opened: URL?
        let model = RouteDaySheetViewModel.testModel(
            account: fixture.session, routes: DayRouteService { _ in throw CancellationError() },
            maps: MapsHandoff {
                opened = $0
                return true
            })
        model.start()
        model.open(tripID: draft.id, dayID: "two")
        try await eventually {
            !model.isOpening && model.target?.dayID == "two" && !model.navigationParts(google: false).isEmpty
        }
        let expected = try #require(model.navigationParts(google: false).first?.url)
        model.navigateDay(google: false, part: 0)
        model.close()
        try await eventually { !model.isWorking }
        #expect(opened == nil, "A dismissed day cannot launch a queued Maps handoff")
        model.select(.init(tripID: draft.id, dayID: "two"))
        model.navigateDay(google: false, part: 0)
        try await eventually { opened != nil && !model.isWorking }
        #expect(opened == expected)
        #expect(opened?.host == "maps.apple.com")
        #expect(opened?.absoluteString.contains("44.0,-66.0") == true)
        model.stop()
        await fixture.session.stopAndWait()
    }

    @Test func mapAndPlannerUseTheSameStoredDayAndLateEditsCannotReselectTheirTarget() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        var draft = fixture.a
        draft.trip.days = [.init(id: "one"), .init(id: "two"), .init(id: "three")]
        draft.activeDayID = "one"
        try await fixture.repository.saveDraft(draft)
        #expect(try await fixture.repository.currentDraft(id: draft.id) == draft)
        var routeRequests = 0
        let routes = DayRouteService { _ in
            routeRequests += 1
            throw CancellationError()
        }
        let map = RouteDaySheetViewModel.testModel(account: fixture.session, routes: routes)
        let planner = fixture.model(activeTrip: map.activeTrip)
        planner.open(draft)
        map.start()
        map.open(tripID: draft.id)
        try await eventually { map.target?.dayID == "one" && !map.isOpening }
        map.position = .medium
        map.selectDay("two")
        map.selectDay("three")
        try await eventually { map.target?.dayID == "three" && !map.activeTrip.checkpointPending }
        #expect(map.position == .medium)
        await planner.resumeActive()
        #expect(planner.target == map.target)
        // A write submitted for an earlier day cannot pull either presentation back to it.
        try await fixture.repository.editDay(
            .init(tripID: draft.id, dayID: "one"), edit: .notes(expected: "", value: "Earlier day"))
        try await eventually { map.draft?.trip.days[0].notes == "Earlier day" }
        #expect(map.target?.dayID == "three")
        await planner.resumeActive()
        planner.stepDay(-1)
        #expect(await planner.awaitCheckpoint())
        try await eventually { map.target == planner.target }
        #expect(map.target?.dayID == "two")
        map.removeDay(expectedDayID: "two")
        try await eventually { map.target?.dayID == "one" && !map.isWorking }
        await planner.resumeActive()
        #expect(planner.target == map.target && planner.draft?.trip.days.count == 2)
        map.selectDay("three")
        try await eventually { map.target?.dayID == "three" && !map.activeTrip.checkpointPending }
        map.addDay(after: "three")
        map.addDay(after: "three")
        try await eventually { map.draft?.trip.days.count == 3 && !map.isWorking }
        let newID = try #require(map.target?.dayID)
        map.addDay(after: "three")
        #expect(map.draft?.trip.days.count == 3)
        await planner.resumeActive()
        #expect(planner.target == map.target)
        map.edit(.color(TripDayColor.palette[3].hex))
        try await eventually { map.day?.color == TripDayColor.palette[3].hex && !map.isWorking }
        await planner.resumeActive()
        #expect(planner.activeDay?.color == map.day?.color)
        map.close()
        #expect(map.target == nil && map.draft?.activeDayID == newID)
        map.selectDay("one")
        map.close()
        try await Task.sleep(for: .milliseconds(30))
        #expect(map.target == nil, "Closing cancels queued navigation and cannot reopen the day")
        #expect(routeRequests == 0, "Selection and empty-day controls must not calculate roads")
        map.stop()
        planner.resetScope()
        await fixture.session.stopAndWait()
    }
}
