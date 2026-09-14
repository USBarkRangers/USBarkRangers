import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

/// Exercise the actual Planner → checkpoint → Map → native-overlay path, including queued work.
@MainActor struct TripDayConsistencyTests {
    private func draft() throws -> TripDraft {
        var draft = TripDraft(trip: Trip(id: "itinerary", name: "Day navigation"))
        draft.trip.days = try (1...3).map { day in
            .init(
                id: "day-\(day)",
                stops: try (1...2).map { index in
                    .init(
                        name: "Day \(day) stop \(index)",
                        coordinate: try #require(
                            Coordinate(latitude: 40 + Double(day), longitude: -80 + Double(index))))
                })
        }
        draft.activeDayID = "day-1"
        return draft
    }
    private func leg(_ segment: TripRoutePlan.Segment) -> DayRouteService.Leg {
        let coordinates = [segment.from, segment.to].compactMap(\.coordinate).map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }
        return .init(
            polyline: MKPolyline(coordinates: coordinates, count: coordinates.count), meters: 1000,
            seconds: 100)
    }

    @Test func plannerDayChangesPrioritizeCurrentDayWithoutRebuildingGeometry() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let original = try draft()
        try await fixture.repository.saveDraft(original)
        try await eventually { fixture.session.state?.activeDraftID == original.id }
        var requests: [String] = []
        var release: CheckedContinuation<Void, Never>?
        let routes = DayRouteService { segment in
            requests.append(segment.id)
            if requests.count == 1 { await withCheckedContinuation { release = $0 } }
            return leg(segment)
        }
        let map = RouteDaySheetViewModel.testModel(account: fixture.session, routes: routes)
        let planner = fixture.model(activeTrip: map.activeTrip)
        planner.open(original)
        map.start()
        map.open(tripID: original.id)
        try await eventually { release != nil && !map.isOpening }
        let version = routes.geometryVersion
        planner.selectDay("day-3")
        #expect(await planner.awaitCheckpoint())
        try await eventually { map.target == planner.target }
        // Allow the account observer to react; there is no trip-content change to rebuild the plan.
        try await Task.sleep(for: .milliseconds(30))
        #expect(routes.geometryVersion == version)
        release?.resume()
        try await eventually { !routes.isLoading }
        #expect(
            requests.dropFirst().first?.hasPrefix("day-3:") == true,
            "The selected day must be next, not the previously selected day's remaining queue")
        map.stop()
        planner.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func addFourthDayAndArrowBackRetainsTheCurrentRouteOnReturnToMap() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let original = try draft()
        try await fixture.repository.saveDraft(original)
        try await eventually { fixture.session.state?.activeDraftID == original.id }
        var requests = 0
        let routes = DayRouteService { segment in
            requests += 1
            return leg(segment)
        }
        let map = RouteDaySheetViewModel.testModel(account: fixture.session, routes: routes)
        let planner = fixture.model(activeTrip: map.activeTrip)
        planner.open(original)
        map.start()
        map.open(tripID: original.id)
        try await eventually { routes.tripID == original.id && !routes.isLoading && !map.isOpening }
        let native = MKMapView(frame: CGRect(x: 0, y: 0, width: 400, height: 800))
        let overlays = MapRouteOverlays()
        overlays.apply(map.visibleRoutes, selection: map.target, to: native)
        let identities = Set(overlays.overlays.map(ObjectIdentifier.init))
        let camera = native.region
        let before = requests
        map.stop()
        planner.selectDay("day-3")
        planner.addDay(after: "day-3")
        planner.addDay(after: "day-3")
        planner.stepDay(-1)
        planner.stepDay(-1)
        #expect(await planner.awaitCheckpoint())
        try await eventually { map.draft?.activeDayID == "day-2" }
        #expect(planner.draft?.trip.days.count == 4)
        map.start()
        try await eventually { routes.days.count == 4 && !routes.isLoading }
        #expect(map.target == planner.target)
        overlays.apply(map.visibleRoutes, selection: map.target, to: native)
        #expect((native.overlays.last as? DayRoutePolyline)?.owner == planner.target)
        #expect(Set(overlays.overlays.map(ObjectIdentifier.init)) == identities)
        #expect(requests == before, "Day navigation and an empty day must reuse road geometry")
        #expect(native.region.center.latitude == camera.center.latitude)
        for line in overlays.overlays where !line.isCasing {
            #expect(overlays.renderer(for: line).lineWidth == (line.owner == planner.target ? 9 : 6))
        }
        map.stop()
        planner.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func closingADayCancelsAQueuedOpenInsteadOfRestoringItsRouteSelection() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let map = RouteDaySheetViewModel.testModel(account: fixture.session, routes: fixture.model().routes)
        map.start()
        var completed = false
        map.open(tripID: fixture.a.id) { completed = true }
        map.close()
        try await Task.sleep(for: .milliseconds(100))
        #expect(
            map.target == nil && !map.isOpening && !completed,
            "A queued open cannot bring back the sheet or selection after Close")
        map.stop()
        await fixture.session.stopAndWait()
    }
}
