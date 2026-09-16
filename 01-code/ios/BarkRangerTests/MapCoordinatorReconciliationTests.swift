import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct MapCoordinatorReconciliationTests {
    @Test func gainingStopNumberEndsUngrouped() async throws {
        let f = try await ReconciliationFixture.make()
        try await f.addTarget()
        f.coordinator.apply(to: f.map)
        let pin = try #require(f.map.pins[f.target.id])
        #expect(pin.clusteringIdentifier == nil)
        #expect(pin.accessibilityValue?.contains("Stop 2") == true)
        await f.close()
    }

    @Test func selectedPinStaysOutsideClusters() async throws {
        let f = try await ReconciliationFixture.make()
        f.model.selectPark(id: f.target.id, focusOnMap: false)
        f.coordinator.apply(to: f.map, reduceMotion: true)
        #expect(f.map.pins[f.target.id]?.clusteringIdentifier == nil)
        for clustering in [false, true] {
            var settings = f.context.settings.value
            settings.clustering = clustering
            f.context.settings.update(settings)
            f.coordinator.apply(to: f.map, reduceMotion: true)
            #expect(f.map.pins[f.target.id]?.clusteringIdentifier == nil)
        }
        await f.close()
    }

    @Test func losingStopNumberRegroups() async throws {
        let f = try await ReconciliationFixture.make()
        try await f.addTarget()
        f.coordinator.apply(to: f.map)
        f.draft.trip.days[0].stops.removeLast()
        try await f.save()
        try await eventually { f.model.personal?.value.stopNumbers["one"]?[f.target.id] == nil }
        f.coordinator.apply(to: f.map)
        let pin = try #require(f.map.pins[f.target.id])
        #expect(pin.clusteringIdentifier == "parks")
        #expect(pin.accessibilityValue?.contains("Stop ") == false)
        await f.close()
    }

    @Test func clusteringToggleReenrollsEveryVisibleAnnotation() async throws {
        let f = try await ReconciliationFixture.make()
        let identities = f.coordinator.annotations
        let visible = try #require(f.model.projection?.matchingIDs)
        for clustering in [false, true] {
            f.map.added = []
            f.map.removed = []
            var settings = f.context.settings.value
            settings.clustering = clustering
            f.context.settings.update(settings)
            f.coordinator.apply(to: f.map)
            #expect(Set(f.map.added) == visible && f.map.added.count == visible.count)
            #expect(Set(f.map.removed) == visible && f.map.removed.count == visible.count)
            #expect(identities.allSatisfy { f.coordinator.annotations[$0.key] === $0.value })
            #expect(f.map.pins[f.target.id]?.clusteringIdentifier == (clustering ? "parks" : nil))
        }
        await f.close()
    }

    @Test func changingDayColorKeepsExistingNumberLabel() async throws {
        let f = try await ReconciliationFixture.make()
        try await f.addTarget()
        f.coordinator.apply(to: f.map)
        let pin = try #require(f.map.pins[f.target.id])
        let ring = try #require(pin.layer.sublayers?.first { $0.name == "park.state" } as? CAShapeLayer)
        let color = TripDayColor.palette[2]
        f.draft.trip.days[0].color = color.hex
        try await f.save()
        try await eventually { f.model.personal?.value.day(for: f.target)?.color == color }
        f.map.added = []
        f.map.removed = []
        f.coordinator.apply(to: f.map)
        #expect(pin.accessibilityValue?.contains("Stop 2") == true)
        #expect(pin.clusteringIdentifier == nil && ring.strokeColor == color.uiColor.cgColor)
        #expect(f.map.added.isEmpty && f.map.removed.isEmpty)
        await f.close()
    }
}

@MainActor private final class ReconciliationFixture {
    let context: DiscoveryTestContext
    let directory: URL
    let account: AccountSession
    let day: RouteDaySheetViewModel
    let model: MapFeatureModel
    let coordinator: MapCoordinator
    let map = SynchronousReconciliationMap(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    let target: Park
    var draft: TripDraft

    private init(
        context: DiscoveryTestContext, directory: URL, account: AccountSession,
        day: RouteDaySheetViewModel, model: MapFeatureModel, target: Park, draft: TripDraft
    ) {
        self.context = context
        self.directory = directory
        self.account = account
        self.day = day
        self.model = model
        self.target = target
        self.draft = draft
        coordinator = MapCoordinator(model: model)
        map.delegate = coordinator
        coordinator.apply(to: map)
    }
    static func make() async throws -> ReconciliationFixture {
        let context = try DiscoveryTestContext()
        try await context.start()
        var settings = context.settings.value
        settings.clustering = true
        context.settings.update(settings)
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let account = AccountSession(auth: nil, directory: directory)
        account.start()
        try await eventually { account.nativeTrips != nil }
        let repository = try #require(account.nativeTrips?.repository)
        let first = try #require(context.model.parks.first)
        let target = context.model.parks[1]
        let draft = TripDraft(
            trip: Trip(
                id: "reconciliation",
                days: [
                    .init(id: "one", stops: [.init(park: first)])
                ]))
        try await repository.saveDraft(draft)
        let day = RouteDaySheetViewModel.testModel(
            account: account, routes: DayRouteService { _ in throw URLError(.notConnectedToInternet) })
        day.start()
        day.open(tripID: draft.id)
        try await eventually { day.target?.dayID == "one" && !day.isWorking }
        let model = MapFeatureModel(
            catalog: context.catalog, settings: context.settings, location: LocationClient(manager: nil),
            maps: MapsHandoff(open: { _ in true }), account: account, routeDay: day)
        model.start()
        try await eventually {
            model.projection != nil && model.personal?.value.stopNumbers["one"]?[first.id] == [1]
        }
        return ReconciliationFixture(
            context: context, directory: directory, account: account, day: day, model: model,
            target: target, draft: draft)
    }
    func addTarget() async throws {
        draft.trip.days[0].stops.append(.init(park: target))
        try await save()
        try await eventually { model.personal?.value.stopNumbers["one"]?[target.id] == [2] }
    }
    func save() async throws {
        try await #require(account.nativeTrips?.repository).saveDraft(draft)
    }
    func close() async {
        map.delegate = nil
        model.stop()
        day.close()
        await account.stopAndWait()
        context.close()
        try? FileManager.default.removeItem(at: directory)
    }
}

/// Makes MapKit's permitted synchronous viewFor callback deterministic. Only enrolled
/// annotations have materialized views; re-enrollment requests their representation again.
@MainActor private final class SynchronousReconciliationMap: MKMapView {
    var added: [ParkID] = []
    var removed: [ParkID] = []
    var pins: [ParkID: ParkAnnotationView] = [:]
    private var enrolled: [ParkID: ParkAnnotation] = [:]
    private var selected: [any MKAnnotation] = []
    override var annotations: [any MKAnnotation] { Array(enrolled.values) }
    override var selectedAnnotations: [any MKAnnotation] {
        get { selected }
        set { selected = newValue }
    }
    override func selectAnnotation(_ annotation: any MKAnnotation, animated: Bool) { selected = [annotation] }
    override func deselectAnnotation(_ annotation: (any MKAnnotation)?, animated: Bool) {
        selected.removeAll { $0 === annotation }
    }
    override func view(for annotation: any MKAnnotation) -> MKAnnotationView? {
        guard let park = annotation as? ParkAnnotation, enrolled[park.park.id] != nil else { return nil }
        return pins[park.park.id]
    }
    override func dequeueReusableAnnotationView(
        withIdentifier identifier: String, for annotation: any MKAnnotation
    ) -> MKAnnotationView {
        let park = annotation as! ParkAnnotation
        let pin =
            pins[park.park.id] ?? ParkAnnotationView(annotation: annotation, reuseIdentifier: identifier)
        pins[park.park.id] = pin
        return pin
    }
    override func addAnnotations(_ annotations: [any MKAnnotation]) {
        for case let park as ParkAnnotation in annotations {
            enrolled[park.park.id] = park
            added.append(park.park.id)
            _ = delegate?.mapView?(self, viewFor: park)
        }
    }
    override func removeAnnotations(_ annotations: [any MKAnnotation]) {
        for case let park as ParkAnnotation in annotations {
            enrolled.removeValue(forKey: park.park.id)
            removed.append(park.park.id)
        }
    }
}
