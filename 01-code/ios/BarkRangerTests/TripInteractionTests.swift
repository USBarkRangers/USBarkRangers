import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct TripInteractionTests {
    private func park(_ id: String, aliases: [ParkID] = []) throws -> Park {
        Park(
            id: .init(rawValue: id), siteID: .init(rawValue: id), name: id,
            coordinate: try #require(Coordinate(latitude: 44, longitude: -68)), aliases: aliases)
    }
    @Test func insertionAndMembershipUseStableStopsAcrossTheWholeDisplayedTrip() throws {
        let a = try park("A")
        let b = try park("B")
        let c = try park("C")
        let trip = Trip(days: [
            .init(id: "one", stops: [.init(park: a), .init(park: b)]),
            .init(id: "two", stops: [.init(park: c)]),
        ])
        let d = try park("D")
        let inserted = try TripDayEdit.add(.init(park: d), after: trip.days[0].stops[0].id)
            .applying(to: trip, dayID: "one")
        #expect(inserted.days[0].stops.map(\.name) == ["A", "D", "B"])
        #expect(inserted.days[1] == trip.days[1])
        #expect(trip.dayIndex(containing: c) == 1)
        let renamed = try park("canonical-C", aliases: [c.id])
        #expect(trip.dayIndex(containing: renamed) == 1)
        #expect(throws: TripDayEdit.Failure.self) {
            try TripDayEdit.add(.init(park: renamed), aliases: Set(renamed.aliases)).applying(
                to: trip, dayID: "one")
        }
        #expect(throws: TripDayEdit.Failure.self) {
            try TripDayEdit.add(.init(park: d), after: "removed-stop").applying(to: trip, dayID: "one")
        }
    }
    @Test func stopAndDayNotesRemainSeparateAndRejectStaleEdits() throws {
        var stop = Trip.Stop(park: try park("A"))
        stop.arrivalTime = "09:30"
        let trip = Trip(days: [.init(id: "day", stops: [stop], notes: "Whole day")])
        let noted = try TripDayEdit.stopNotes(id: stop.id, expected: "", value: "Bring water")
            .applying(to: trip, dayID: "day")
        #expect(noted.days[0].notes == "Whole day")
        #expect(noted.days[0].stops[0].notes == "Bring water")
        #expect(noted.days[0].stops[0].arrivalTime == "09:30")
        #expect(try JSONDecoder().decode(Trip.self, from: JSONEncoder().encode(noted)) == noted)
        #expect(throws: TripDayEdit.Failure.self) {
            try TripDayEdit.stopNotes(id: stop.id, expected: "", value: "Old editor")
                .applying(to: noted, dayID: "day")
        }
        #expect(throws: Trip.Failure.self) {
            try TripDayEdit.stopNotes(
                id: stop.id, expected: "Bring water", value: String(repeating: "a", count: 1001)
            )
            .applying(to: noted, dayID: "day")
        }
    }
    @Test func reorderRejectsChangedOrderAndPreservesStopNotesAndIDs() throws {
        var a = Trip.Stop(park: try park("A"))
        a.notes = "A's note"
        let b = Trip.Stop(park: try park("B"))
        let c = Trip.Stop(park: try park("C"))
        let trip = Trip(days: [.init(id: "day", stops: [a, b, c])])
        let ids = trip.days[0].stops.map(\.id)
        let order = [b.id, c.id, a.id]
        let moved = try TripDayEdit.order(order, expected: ids).applying(to: trip, dayID: "day")
        #expect(moved.days[0].stops == [b, c, a])
        #expect(throws: TripDayEdit.Failure.self) {
            try TripDayEdit.order(ids, expected: ids).applying(to: moved, dayID: "day")
        }
    }
    @Test func clearSwitchAndAddWithoutASelectedDayUseTheSharedDraft() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let account = AccountSession(auth: nil, directory: directory)
        account.start()
        try await eventually { account.nativeTrips?.repository != nil }
        let a = try park("A")
        let b = try park("B")
        let c = try park("C")
        let shown = Trip(id: "shown", days: [.init(id: "one", stops: [.init(park: a)])])
        let other = Trip(id: "other", days: [.init(id: "other-day", stops: [.init(park: b)])])
        try await account.nativeTrips?.repository.saveDraft(TripDraft(trip: shown))
        try await account.nativeTrips?.repository.saveDraft(TripDraft(trip: other))
        let model = RouteDaySheetViewModel.testModel(
            account: account, routes: DayRouteService { _ in throw CancellationError() })
        model.start()
        let projection = PersonalParkProjection(account: account, activeDraft: { model.draft })
        projection.start()
        model.open(tripID: shown.id)
        try await eventually {
            model.draft?.id == shown.id && !model.isWorking && projection.value.trip == [a.id]
        }
        model.close()
        // An accepted Planner selection replaces the Map trip too.
        try await account.nativeTrips?.repository.saveDraft(TripDraft(trip: other))
        try await eventually { model.draft?.id == other.id }
        model.add(c) {}
        try await eventually { model.draft?.trip.days[0].stops.count == 2 && !model.isWorking }
        #expect(model.target == nil, "Adding keeps the park popup, without opening a day sheet")
        #expect(model.draft?.trip.days[0].stops.map(\.name) == ["B", "C"])
        #expect(try await account.nativeTrips?.repository.currentDraft(id: shown.id)?.trip == shown)
        model.clearMap()
        try await eventually { projection.value.trip.isEmpty && projection.value.days.isEmpty }
        #expect(
            account.nativeTrips?.library.drafts.count == 2 && model.target == nil
                && model.visibleRoutes == nil)
        model.open(tripID: shown.id)
        model.open(tripID: other.id)
        try await eventually { !model.isOpening && model.draft?.id == other.id }
        #expect(model.target?.dayID == "other-day")
        model.clearMap()
        try await eventually { !model.isWorking && model.context == nil }
        model.open(tripID: shown.id)
        model.clearMap()
        try await Task.sleep(for: .milliseconds(50))
        #expect(model.context == nil && !model.isOpening)
        projection.stop()
        model.stop()
        await account.stopAndWait()
        try FileManager.default.removeItem(at: directory)
    }
}
