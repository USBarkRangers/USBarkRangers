import BarkDomain
import Foundation
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct MapTripLifecycleTests {
    @Test func deletedDisplayedTripIsClearedWhenReturningFromPlanner() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let map = RouteDaySheetViewModel.testModel(
            account: fixture.session,
            routes: DayRouteService { _ in
                throw URLError(.notConnectedToInternet)
            })
        map.start()
        map.open(tripID: fixture.a.id)
        try await eventually { map.draft?.id == fixture.a.id && !map.isOpening }
        map.stop()
        try await fixture.repository.delete(matching: fixture.a)
        try await eventually {
            fixture.session.nativeTrips?.library.drafts.contains { $0.id == fixture.a.id } == false
        }
        map.start()
        try await eventually { map.context == nil && map.visibleRoutes == nil }
        try await eventually { map.routes.tripID == nil && map.activeTrip.tripID == nil }
        #expect(try await fixture.repository.currentDraft(id: fixture.b.id) == fixture.b)
        #expect(try await fixture.repository.store.tripLocalLists().drafts.map(\.id) == [fixture.b.id])
        map.stop()
        await fixture.session.stopAndWait()
    }
}

extension MapTripLifecycleTests {
    @Test func addStopFocusIsConsumedOnceWithoutChangingSearchOrTripState() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let planner = fixture.model()
        let day = RouteDaySheetViewModel.testModel(
            account: fixture.session, routes: planner.routes, activeTrip: planner.activeTrip)
        let map = MapFeatureModel(
            catalog: fixture.context.catalog, settings: fixture.context.settings,
            location: LocationClient(manager: nil), maps: MapsHandoff(open: { _ in true }),
            account: fixture.session, routeDay: day)
        day.start()
        day.open(tripID: fixture.a.id)
        try await eventually { !day.isOpening && day.draft?.id == fixture.a.id }
        var query = map.query
        query.search = "Acadia"
        map.setFilters(query)
        let request = StopSearchRequest(
            scope: try #require(fixture.session.tripScope), tripID: fixture.a.id,
            destination: .day(try #require(day.draft?.activeDayID)))
        map.beginAdding(request) {}
        try await eventually { map.searchFocusRequest != nil }
        #expect(map.consumeSearchFocusRequest())
        #expect(!map.consumeSearchFocusRequest())
        #expect(map.query == query && day.draft?.id == fixture.a.id)
        #expect(day.editor.insertion == request)
        map.beginAdding(request) {}
        try await eventually { map.searchFocusRequest != nil }
        #expect(map.consumeSearchFocusRequest())
        day.stop()
        planner.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test func firstAddPublishesMembershipAndSecondAddRequestsOneRoadLeg() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        try await fixture.repository.discardDraft(id: fixture.a.id)
        try await fixture.repository.discardDraft(id: fixture.b.id)
        try await eventually { fixture.session.nativeTrips?.library.drafts.isEmpty == true }
        var requests = 0
        let routes = DayRouteService { segment in
            requests += 1
            let coordinates = [segment.from, segment.to].compactMap(\.coordinate).map {
                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
            }
            return DayRouteService.Leg(
                polyline: MKPolyline(coordinates: coordinates, count: coordinates.count), meters: 100,
                seconds: 10)
        }
        let day = RouteDaySheetViewModel.testModel(account: fixture.session, routes: routes)
        let map = MapFeatureModel(
            catalog: fixture.context.catalog, settings: fixture.context.settings,
            location: LocationClient(manager: nil), maps: MapsHandoff(open: { _ in true }),
            account: fixture.session, routeDay: day)
        map.start()
        day.start()
        try await eventually { map.parks.count > 1 }
        let a = map.parks[0]
        let b = map.parks[1]
        map.selectPark(id: a.id)
        let selection = try #require(map.detail.selection)
        guard case .add(_, _, let add) = MapStopActions.action(for: selection, model: day, openDay: {}) else {
            Issue.record("First park should offer Add to Trip")
            return
        }
        add()
        add()
        try await eventually { !day.isWorking && day.draft?.trip.totalStops == 1 }
        let id = try #require(day.draft?.id)
        #expect(try await fixture.repository.store.tripLocalLists().drafts.count == 1 && requests == 0)
        #expect(map.selectionID == selection.id && map.detail.message == nil && day.editor.notice == nil)
        guard
            case .member(let number, _, _, _, _, _) = MapStopActions.action(
                for: selection, model: day, openDay: {})
        else {
            Issue.record("Accepted add should immediately present membership")
            return
        }
        #expect(number == 1)
        try await eventually { map.personal?.value.day(for: a)?.index == 0 }
        day.add(b) {}
        try await eventually { day.draft?.trip.totalStops == 2 && routes.legs.count == 1 }
        #expect(requests == 1 && day.draft?.id == id)
        day.position = .high
        day.position = .medium
        day.position = .low
        #expect(requests == 1)
        map.stop()
        await fixture.session.stopAndWait()
    }
    @Test func capturedMoveCreatesOneDayAndDeletedInsertionNeverFallsBackToAnotherTrip() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let day = RouteDaySheetViewModel.testModel(
            account: fixture.session,
            routes: DayRouteService { _ in
                throw URLError(.notConnectedToInternet)
            })
        day.start()
        day.open(tripID: fixture.a.id)
        try await eventually { day.draft?.id == fixture.a.id && !day.isWorking }
        let park = try #require(fixture.context.model.parks.first)
        day.add(park) {}
        try await eventually { day.draft?.trip.totalStops == 1 && !day.isWorking }
        guard
            case .member(_, _, let previous, let next, _, _) = MapStopActions.action(
                for: .park(park), model: day, openDay: {})
        else {
            Issue.record("Expected member actions")
            return
        }
        #expect(previous == nil)
        let forward = try #require(next)
        forward()
        forward()
        try await eventually { day.draft?.trip.days.count == 2 && !day.isWorking }
        #expect(day.draft?.trip.days[0].stops.isEmpty == true && day.draft?.trip.days[1].stops.count == 1)
        forward()  // A menu captured before the first move is stale even after the first action ends.
        try await eventually { !day.isWorking }
        #expect(day.draft?.trip.days.count == 2)
        let request = StopSearchRequest(
            scope: "user-a", tripID: fixture.a.id,
            destination: .day(try #require(day.draft?.trip.days[0].id)))
        day.editor.prepareInsertion(request)
        let current = try #require(try await fixture.repository.currentDraft(id: fixture.a.id))
        try await fixture.repository.delete(matching: current)
        // Even before the observation callback clears presentation, an old target cannot add into B.
        day.editor.add(.init(park: park), aliases: [], tripID: fixture.a.id, destination: request.destination)
        { _ in
            Issue.record("Deleted destination must not be recreated")
        }
        try await eventually { day.context == nil && !day.isWorking }
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id) == nil)
        #expect(try await fixture.repository.currentDraft(id: fixture.b.id)?.trip.totalStops == 0)
        day.stop()
        await fixture.session.stopAndWait()
    }
    @Test func plannerSearchUsesNewDraftAndExactAddBelowRequest() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let planner = fixture.model()
        let day = RouteDaySheetViewModel.testModel(
            account: fixture.session, routes: planner.routes, activeTrip: planner.activeTrip)
        day.start()
        day.open(tripID: fixture.a.id)
        try await eventually { !day.isOpening }
        #expect(planner.newTrip())
        #expect(await planner.awaitCheckpoint())
        let park = try #require(fixture.context.model.parks.first)
        #expect(planner.addStop(.init(park: park)))
        let target = try #require(planner.target)
        let anchor = try #require(planner.activeDay?.stops.first?.id)
        var opened = false
        planner.searchOnMap(destination: .day(target.dayID), after: anchor) { request in
            day.beginAdding(request) { opened = true }
        }
        try await eventually { opened && !planner.saving && !day.isOpening }
        #expect(day.draft?.id == target.tripID && day.draft?.id != fixture.a.id)
        #expect(day.editor.insertion?.after == anchor)
        let custom = Trip.Stop(
            name: "Home", coordinate: try #require(Coordinate(latitude: 41, longitude: -81)))
        day.add(custom)
        try await eventually { day.draft?.trip.totalStops == 2 && !day.isWorking }
        #expect(day.editor.insertion == nil)
        await planner.resumeActive()
        #expect(planner.activeDay?.stops.map(\.id) == [anchor, custom.id])
        #expect(await planner.awaitCheckpoint())
        #expect(planner.draft?.trip == day.draft?.trip)
        #expect(try await fixture.repository.currentDraft(id: fixture.a.id)?.trip.totalStops == 0)
        planner.resetScope()
        day.stop()
        await fixture.session.stopAndWait()
    }
}
