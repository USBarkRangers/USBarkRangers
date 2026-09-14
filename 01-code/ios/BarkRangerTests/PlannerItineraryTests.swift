import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct PlannerItineraryTests {
    @Test func oldConfirmationCannotDismissANewerEditOrSaveFailure() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.open(fixture.a)
        let target = try #require(model.target)
        #expect(model.editDay(.notes(expected: "", value: "First edit"), target: target))
        #expect(await model.awaitCheckpoint())
        let first = model.activeTrip.editRevision
        #expect(model.editDay(.notes(expected: "First edit", value: "Second edit"), target: target))
        #expect(await model.awaitCheckpoint())
        model.dismissDayUpdate(revision: first)
        #expect(model.notice == "Day updated")
        let latest = model.activeTrip.editRevision
        model.dismissDayUpdate(revision: latest)
        #expect(model.notice == nil)
        #expect(!model.editDay(.notes(expected: "Stale note", value: "Rejected edit"), target: target))
        let error = try #require(model.notice)
        model.dismissDayUpdate(revision: latest)
        #expect(model.notice == error && error != "Day updated")
        #expect(model.activeDay?.notes == "Second edit")
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    private func stop(_ name: String, _ longitude: Double) throws -> Trip.Stop {
        .init(name: name, coordinate: try #require(Coordinate(latitude: 44, longitude: longitude)))
    }
    @Test func heldNativeDragChangesDaysAndCommitsThroughTheSameDomainPolicy() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let a = try stop("A", -68)
        let b = try stop("B", -67.9)
        let c = try stop("C", -67.8)
        var draft = fixture.a
        draft.trip.days = [.init(id: "one", stops: [a, b]), .init(id: "two", stops: [c])]
        draft.activeDayID = "one"
        try await fixture.repository.saveDraft(draft)
        #expect(try await fixture.repository.currentDraft(id: draft.id) == draft)
        let model = fixture.model()
        model.open(draft)
        let drag = RouteStopDragCoordinator()
        drag.destination = .init(
            scope: "user-a", target: try #require(model.target), stops: [a, b], enabled: true)
        let item = try #require(drag.begin(at: 0))
        let source = try #require(item.localObject as? RouteStopDragCoordinator.Source)
        model.stepDay(1)
        drag.destination = .init(
            scope: "user-a", target: try #require(model.target), stops: [c], enabled: true)
        #expect(drag.source?.stopID == a.id && model.dayIndex == 1)
        #expect(
            model.editDay(try #require(drag.change(for: source, at: 0)), target: try #require(model.target)))
        #expect(await model.awaitCheckpoint())
        #expect(model.draft?.trip.days[0].stops == [b] && model.activeDay?.stops == [a, c])
        #expect(model.notice == "Day updated")
        let target = try #require(model.target)
        #expect(model.editDay(.stopNotes(id: a.id, expected: "", value: "Stop only"), target: target))
        #expect(await model.awaitCheckpoint())
        #expect(model.editDay(.notes(expected: "", value: "Whole day"), target: target))
        #expect(await model.awaitCheckpoint())
        let stored = try #require(try await fixture.repository.currentDraft(id: draft.id))
        #expect(stored.trip.days[1].notes == "Whole day")
        #expect(stored.trip.days[1].stops[0].notes == "Stop only")
        #expect(
            !model.routes.isLoading, "An inactive app session must not request roads")
        drag.end()
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test func previewWaitsForTheExactCheckpointAndMapOpensTheRequestedDay() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.open(fixture.a)
        model.addDay()
        let target = try #require(model.target)
        #expect(model.addStop(try stop("Preview A", -68)))
        #expect(model.addStop(try stop("Preview B", -67.8)))
        var request: TripDayID?
        model.previewOnMap { request = $0 }
        try await eventually { request != nil && !model.saving }
        #expect(request == target)
        let stored = try #require(try await fixture.repository.currentDraft(id: target.tripID))
        #expect(stored.activeDayID == target.dayID && stored.trip.days[1].stops.count == 2)
        let day = RouteDaySheetViewModel.testModel(
            account: fixture.session, routes: model.routes, activeTrip: model.activeTrip)
        let map = MapFeatureModel(
            catalog: fixture.context.catalog, settings: fixture.context.settings,
            location: LocationClient(manager: nil), maps: MapsHandoff(open: { _ in true }),
            account: fixture.session, routeDay: day)
        map.previewTripDay(target)
        day.start()
        try await eventually { day.target == target && !day.isOpening && map.cameraRequest != nil }
        #expect(day.position == .medium && day.day?.stops.count == 2)
        try await fixture.repository.editDay(target, edit: .notes(expected: "", value: "Changed on Map"))
        try await eventually {
            fixture.session.state?.drafts?.first { $0.id == target.tripID }?.trip.days[1].notes
                == "Changed on Map"
        }
        await model.resumeActive()
        #expect(model.activeDay?.notes == "Changed on Map")
        map.stop()
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test func pendingPreviewCannotNavigateAfterOpeningAnotherTrip() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.open(fixture.a)
        var navigated = false
        model.previewOnMap { _ in navigated = true }
        model.open(fixture.b)
        try await Task.sleep(for: .milliseconds(40))
        #expect(!navigated && model.draft == fixture.b && model.notice == nil)
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test func bookendsAndColorsStayInTheSameCheckpointWhileInactive() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.open(fixture.a)
        let start = try stop("Start", -68.5)
        let end = try stop("Finish", -67)
        #expect(model.addStop(start, destination: .start))
        model.addDay()
        #expect(model.addStop(end, destination: .end))
        model.setColor(TripDayColor.palette[2].hex)
        #expect(await model.awaitCheckpoint())
        try await eventually { model.plan != nil }
        #expect(model.draft?.trip.start == start && model.draft?.trip.end == end)
        #expect(model.activeDay?.color == TripDayColor.palette[2].hex)
        #expect(!model.routes.isLoading && model.routes.legs.isEmpty)
        model.stepDay(-1)
        #expect(model.dayIndex == 0)
        model.stepDay(-1)
        #expect(model.dayIndex == 0 && model.draft?.trip.days.count == 2)
        #expect(await model.awaitCheckpoint())
        model.resetScope()
        await fixture.session.stopAndWait()
    }
}
