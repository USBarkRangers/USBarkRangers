import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct RouteDayTests {
    private func stop(_ name: String, _ longitude: Double) throws -> Trip.Stop {
        .init(name: name, coordinate: try #require(Coordinate(latitude: 44, longitude: longitude)))
    }
    private func trip() throws -> Trip {
        try Trip(
            id: "map-trip",
            days: [
                .init(id: "first", stops: [stop("A", -68), stop("B", -67.9)]),
                .init(id: "second", stops: [stop("C", -67.8), stop("D", -67.7)]),
            ])
    }
    private func leg(_ segment: TripRoutePlan.Segment) throws -> DayRouteService.Leg {
        let points = try [segment.from, segment.to].map { stop in
            let c = try #require(stop.coordinate)
            return CLLocationCoordinate2D(latitude: c.latitude, longitude: c.longitude)
        }
        return .init(
            polyline: MKPolyline(coordinates: points, count: points.count), meters: 1609.344, seconds: 600)
    }
    @Test func onlyChangedLegsAndTheDependentNextDayConnectorAreRequested() async throws {
        var requests: [String] = []
        let service = DayRouteService { segment in
            requests.append(segment.geometryKey)
            return try leg(segment)
        }
        var trip = try trip()
        let original = TripRoutePlan.build(trip)
        service.update(tripID: trip.id, plan: original, preferredDay: "first", permitted: true)
        try await eventually { !service.isLoading }
        #expect(requests.count == 3)
        let retained = try #require(service.leg(original.days[1].segments[1]))
        let before = service.geometryVersion
        trip.days[0].notes = "A note is not a route change"
        for _ in 0..<30 {
            service.update(
                tripID: trip.id, plan: TripRoutePlan.build(trip), preferredDay: "second", permitted: true)
            service.prioritize("first")
        }
        #expect(requests.count == 3 && service.geometryVersion == before)
        trip = try TripDayEdit.add(stop("E", -67.85)).applying(to: trip, dayID: "first")
        service.update(
            tripID: trip.id, plan: TripRoutePlan.build(trip), preferredDay: "first", permitted: true)
        try await eventually { !service.isLoading }
        #expect(requests.count == 5, "Only B→E and the changed E→C connector need directions")
        #expect(service.leg(original.days[1].segments[1])?.polyline === retained.polyline)
        #expect(service.legs.count == 4)
    }
    @Test func stopNotesDoNotRequestRoadsAndReorderRetainsTheUnaffectedDayLeg() async throws {
        var requests: [String] = []
        let service = DayRouteService { segment in
            requests.append(segment.geometryKey)
            return try leg(segment)
        }
        var trip = try trip()
        let original = TripRoutePlan.build(trip)
        service.update(tripID: trip.id, plan: original, preferredDay: "first", permitted: true)
        try await eventually { !service.isLoading }
        let retained = try #require(service.leg(original.days[1].segments[1]))
        trip = try TripDayEdit.stopNotes(id: trip.days[0].stops[0].id, expected: "", value: "Water for dog")
            .applying(to: trip, dayID: "first")
        service.update(
            tripID: trip.id, plan: TripRoutePlan.build(trip), preferredDay: "first", permitted: true)
        #expect(requests.count == 3)
        let ids = trip.days[0].stops.map(\.id)
        trip = try TripDayEdit.order(Array(ids.reversed()), expected: ids).applying(to: trip, dayID: "first")
        service.update(
            tripID: trip.id, plan: TripRoutePlan.build(trip), preferredDay: "first", permitted: true)
        try await eventually { !service.isLoading }
        #expect(requests.count == 5, "Only the reversed first leg and dependent next-day connector change")
        #expect(service.leg(original.days[1].segments[1])?.polyline === retained.polyline)
    }
    @Test func nonCooperativeOldRequestCannotPublishAfterScopeReset() async throws {
        var release: CheckedContinuation<DayRouteService.Leg, Never>?
        let service = DayRouteService { _ in await withCheckedContinuation { release = $0 } }
        let trip = try trip()
        let plan = TripRoutePlan.build(trip)
        service.update(tripID: trip.id, plan: plan, preferredDay: nil, permitted: true)
        try await eventually { release != nil }
        service.reset()
        release?.resume(returning: try leg(plan.days[0].segments[0]))
        try await Task.sleep(for: .milliseconds(30))
        #expect(service.tripID == nil && service.legs.isEmpty && !service.isLoading)
    }
    @Test func failureRetryAndOfflineSuspendRetainConfirmedGeometryWithoutFanout() async throws {
        var count = 0
        let service = DayRouteService { segment in
            count += 1
            if count == 2 { throw URLError(.notConnectedToInternet) }
            return try leg(segment)
        }
        let trip = try trip()
        let plan = TripRoutePlan.build(trip)
        service.update(tripID: trip.id, plan: plan, preferredDay: "first", permitted: true)
        try await eventually { !service.isLoading }
        #expect(count == 3 && service.legs.count == 2 && service.failures.count == 1)
        service.update(tripID: trip.id, plan: plan, preferredDay: nil, permitted: false)
        service.retry()
        #expect(count == 3 && !service.isLoading && service.legs.count == 2)
        service.update(tripID: trip.id, plan: plan, preferredDay: nil, permitted: true)
        try await eventually { !service.isLoading }
        #expect(count == 4 && service.legs.count == 3)
    }
    @Test func differentParksAtOneCoordinateRemainDistinctStops() throws {
        let coordinate = try #require(Coordinate(latitude: 44, longitude: -68))
        let first = Park(
            id: .init(rawValue: "one"), siteID: .init(rawValue: "one"), name: "One", coordinate: coordinate,
            category: .national)
        let second = Park(
            id: .init(rawValue: "two"), siteID: .init(rawValue: "two"), name: "Two", coordinate: coordinate,
            category: .state)
        let trip = Trip(days: [.init(id: "day", stops: [.init(park: first)])])
        let added = try TripDayEdit.add(.init(park: second)).applying(to: trip, dayID: "day")
        #expect(added.days[0].stops.count == 2)
        #expect(throws: TripDayEdit.Failure.self) {
            try TripDayEdit.add(.init(park: first)).applying(to: added, dayID: "day")
        }
        #expect(RouteDayFormat.duration(.infinity) == "—")
    }
    @Test func mapAndPlannerEditsUseOneCheckpointAndRejectAnObsoleteBuffer() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "days")
        try await store.seedPremium()
        let repository = NativeTripRepository(store: store, cloud: nil)
        let base = TripDraft(trip: try trip())
        try await repository.saveDraft(base)
        let target = TripDayID(tripID: base.id, dayID: "second")
        try await repository.editDay(target, edit: .add(stop("E", -67.6)))
        var obsolete = base
        obsolete.trip.name = "Old buffer"
        await #expect(throws: TripDayEdit.Failure.self) {
            try await repository.checkpoint(obsolete, replacing: base)
        }
        let current = try await repository.openDraft(id: base.id)
        #expect(current.trip.days[1].stops.count == 3 && current.trip.days[0] == base.trip.days[0])
        #expect(current.trip.name == base.trip.name)
        var fresh = current
        fresh.trip.days[1].notes = "Planner follows map"
        _ = try await repository.checkpoint(fresh, replacing: current)
        await #expect(throws: TripDayEdit.Failure.self) {
            try await repository.editDay(target, edit: .order(base.trip.days[1].stops.map(\.id)))
        }
        #expect(try await store.pendingTripIDs().isEmpty)
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "days")
        #expect(
            try await reopened.currentNativeDraft(id: base.id)?.trip.days[1].notes == "Planner follows map")
        await reopened.close()
        try FileManager.default.removeItem(at: directory)
    }
    @Test func daySelectionAndAddFollowStoreUpdatesWithoutDuplicatingItineraryState() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let account = AccountSession(auth: nil, directory: directory)
        account.start()
        try await eventually { account.nativeTrips != nil }
        let trip = try trip()
        try await account.nativeTrips?.repository.saveDraft(TripDraft(trip: trip))
        try await eventually { account.nativeTrips?.library.drafts.count == 1 }
        let model = RouteDaySheetViewModel.testModel(
            account: account,
            routes: DayRouteService { _ in
                Issue.record("Guest editing must not request premium road routing")
                throw CancellationError()
            })
        model.start()
        model.open(tripID: trip.id)
        try await eventually { model.target?.dayID == "first" && !model.isWorking }
        model.position = .medium
        model.moveDay(1)
        try await eventually { model.target?.dayID == "second" && !model.activeTrip.checkpointPending }
        #expect(model.position == .medium && model.target?.dayID == "second")
        model.edit(.notes(expected: "", value: "Map note"))
        try await eventually { model.day?.notes == "Map note" && !model.isWorking }
        #expect(
            try await account.nativeTrips?.repository.currentDraft(id: try #require(model.draft?.id))?.trip
                .days[1].notes == model.day?.notes)
        model.close()
        #expect(model.target == nil && model.context?.tripID == trip.id)
        model.select(.init(tripID: trip.id, dayID: "second"))
        #expect(model.position == .medium)
        var completed = false
        let coordinate = try #require(Coordinate(latitude: 44.2, longitude: -67.5))
        let park = Park(
            id: .init(rawValue: "new-park"), siteID: .init(rawValue: "new-site"), name: "New park",
            coordinate: coordinate, category: .state)
        model.add(park) { completed = true }
        model.close()
        model.select(.init(tripID: trip.id, dayID: "second"))
        try await eventually { !model.isWorking && model.day?.stops.count == 3 }
        #expect(
            !completed && model.position == .medium,
            "A later selection of the same day owns its own presentation")
        model.stop()
        await account.stopAndWait()
        try FileManager.default.removeItem(at: directory)
    }
}
