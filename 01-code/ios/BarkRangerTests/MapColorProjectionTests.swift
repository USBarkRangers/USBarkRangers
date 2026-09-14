import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct MapColorProjectionTests {
    @Test func colorEditsUseTheDisplayedTripWithoutSearchOrAnnotationRebuilds() async throws {
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try await context.start()
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let account = AccountSession(auth: nil, cloud: nil, directory: directory)
        account.start()
        try await eventually { account.nativeTrips != nil }
        let repository = try #require(account.nativeTrips?.repository)
        let a = try #require(context.model.parks.first)
        let b = context.model.parks[1]
        var draft = TripDraft(
            trip: Trip(
                id: "shown",
                days: [
                    .init(id: "one", stops: [.init(park: a)]),
                    .init(id: "two", stops: [.init(park: b), .init(park: a)]),
                ]))
        try await repository.saveDraft(draft)
        let day = RouteDaySheetViewModel.testModel(
            account: account, routes: DayRouteService { _ in throw URLError(.notConnectedToInternet) })
        day.start()
        day.open(tripID: draft.id)
        try await eventually { day.context?.tripID == draft.id && !day.isWorking }
        let probe = ControlledParkResults()
        var settings = context.settings.value
        settings.filters.personal = .trip
        context.settings.update(settings)
        let model = MapFeatureModel(
            catalog: context.catalog, settings: context.settings, location: LocationClient(manager: nil),
            maps: MapsHandoff(open: { _ in true }), computeResults: probe.compute, account: account,
            routeDay: day)
        model.start()
        defer { model.stop() }
        try await eventually { model.personal?.value.days.count == 2 && model.parks.count == 2 }
        let personal = try #require(model.personal)
        #expect(personal.value.day(for: a)?.dayID == "one", "Repeated parks use their earliest assigned day")
        #expect(personal.value.day(for: b)?.color == TripDayColor.palette[1])
        let original = personal.value
        let map = ColorRecordingMap(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let coordinator = MapCoordinator(model: model)
        coordinator.apply(to: map)
        let identities = coordinator.annotations
        let version = model.annotationVersion
        let searches = await probe.inputs.count
        map.clearCounts()
        draft.trip.days[0].color = TripDayColor.palette[2].hex
        try await repository.saveDraft(draft)
        try await eventually { personal.value.day(for: a)?.color == TripDayColor.palette[2] }
        try await Task.sleep(for: .milliseconds(30))
        coordinator.apply(to: map)
        #expect(Set(map.lookups) == personal.value.changedMarkers(from: original))
        #expect(map.annotationMutations == 0 && model.annotationVersion == version)
        #expect(identities.allSatisfy { coordinator.annotations[$0.key] === $0.value })
        #expect(await probe.inputs.count == searches)
        map.clearCounts()
        for height in 200..<500 { coordinator.apply(to: map, detailFramingHeight: CGFloat(height)) }
        #expect(map.lookups.isEmpty && map.annotationMutations == 0)
        let annotationA = try #require(identities[a.id])
        let annotationB = try #require(identities[b.id])
        let pinA = try #require(map.view(for: annotationA) as? ParkAnnotationView)
        let pinB = try #require(map.view(for: annotationB) as? ParkAnnotationView)
        #expect(pinA.accessibilityValue?.contains("Stop 1") == true)
        #expect(pinB.accessibilityValue?.contains("Stop ") == false)
        day.moveDay(1)
        try await eventually { day.target?.dayID == "two" && !day.activeTrip.checkpointPending }
        coordinator.apply(to: map)
        #expect(pinA.accessibilityValue?.contains("Stop 2") == true)
        #expect(pinB.accessibilityValue?.contains("Stop 1") == true)
        #expect(pinA.clusteringIdentifier == nil && pinB.clusteringIdentifier == nil)
        #expect(model.annotationVersion == version)
        #expect(await probe.inputs.count == searches)
        map.clearCounts()
        for height in 200..<500 { coordinator.apply(to: map, detailFramingHeight: CGFloat(height)) }
        #expect(map.lookups.isEmpty && map.annotationMutations == 0)
        day.close()
        coordinator.apply(to: map)
        #expect(pinA.accessibilityValue?.contains("Stop ") == false)
        #expect(pinB.accessibilityValue?.contains("Stop ") == false)
        #expect(model.annotationVersion == version)
        #expect(await probe.inputs.count == searches)
        #expect(identities.allSatisfy { coordinator.annotations[$0.key] === $0.value })
        // Opening a different Planner trip now replaces Map membership as well.
        let other = TripDraft(trip: Trip(id: "planner", days: [.init(stops: [.init(park: b)])]))
        try await repository.saveDraft(other)
        try await eventually { account.nativeTrips?.selectedID == other.id }
        try await eventually { personal.value.trip == [b.id] && day.draft?.id == other.id }
        #expect(personal.value.day(for: a) == nil)
        #expect(personal.value.day(for: b)?.color == TripDayColor.palette[0])
        model.stop()
        await account.stopAndWait()
        #expect(personal.value == .init(), "A closed account scope cannot keep personal colors")
        try FileManager.default.removeItem(at: directory)
    }

    @Test func aliasesAndSameMembershipDayChangesInvalidateOnlyAffectedPins() throws {
        let coordinate = try #require(Coordinate(latitude: 44, longitude: -68))
        let alias = ParkID(rawValue: "legacy")
        let park = Park(
            id: .init(rawValue: "canonical"), siteID: .init(rawValue: "site"), name: "Park",
            coordinate: coordinate, category: .national, aliases: [alias])
        let old = PersonalParkProjection.Value(
            visited: [alias], trip: [alias],
            days: [alias: .init(dayID: "one", index: 0, color: TripDayColor.palette[0])])
        var next = old
        next.days[alias] = .init(dayID: "three", index: 2, color: TripDayColor.palette[2])
        #expect(next.day(for: park)?.dayID == "three")
        #expect(next.changedMarkers(from: old) == [alias])
        #expect(next.visited == old.visited && next.trip == old.trip)
        #expect(PersonalParkProjection.Value().changedMarkers(from: next) == [alias])
        for color in TripDayColor.palette {
            var hue: CGFloat = 0
            color.uiColor.getHue(&hue, saturation: nil, brightness: nil, alpha: nil)
            #expect(!(0.12...0.70).contains(hue), "Day colors must stay outside yellow, green and blue")
        }
    }
}

@MainActor private final class ColorRecordingMap: MKMapView {
    var lookups: [ParkID] = []
    var annotationMutations = 0
    private var pins: [ParkID: ParkAnnotationView] = [:]
    override func view(for annotation: any MKAnnotation) -> MKAnnotationView? {
        guard let park = annotation as? ParkAnnotation else { return nil }
        lookups.append(park.park.id)
        if pins[park.park.id] == nil {
            pins[park.park.id] = ParkAnnotationView(annotation: park, reuseIdentifier: "park")
        }
        return pins[park.park.id]
    }
    override func addAnnotations(_ annotations: [any MKAnnotation]) {
        annotationMutations += 1
        super.addAnnotations(annotations)
    }
    override func removeAnnotations(_ annotations: [any MKAnnotation]) {
        annotationMutations += 1
        super.removeAnnotations(annotations)
    }
    func clearCounts() {
        lookups = []
        annotationMutations = 0
    }
}
