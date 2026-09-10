import BarkDomain
import Foundation
import MapKit
import Testing

@testable import BarkRanger

@MainActor
struct DiscoveryPerformanceTests {
    @Test(arguments: [false, true])
    func geometryCameraAndUnrelatedSettingsDoNotReconcileAnnotations(large: Bool) async throws {
        let probe = ControlledParkResults()
        let context = try DiscoveryTestContext(scenario: large ? "large" : "valid", compute: probe.compute)
        defer { context.close() }
        if large { await context.catalog.refresh(reason: .startup) }
        try await context.start()
        let model = context.model
        let count = large ? 5000 : 393
        #expect(model.parks.count == count)
        let map = CountingMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let coordinator = MapCoordinator(model: model)
        coordinator.apply(to: map)
        let initialOrder = model.result.matchingIDs
        let originalAnnotations = coordinator.annotations
        map.clearCounts()
        var reorderedQuery = model.query
        reorderedQuery.search = " "
        model.setFilters(reorderedQuery)
        try await eventually { model.projection?.input.query == reorderedQuery }
        #expect(model.result.matchingIDs != initialOrder)
        #expect(Set(model.result.matchingIDs) == Set(initialOrder))
        coordinator.apply(to: map)
        #expect(map.markerLookups == 0 && map.mutations == 0)
        #expect(Set(map.annotations.compactMap { ($0 as? ParkAnnotation)?.park.id }) == Set(initialOrder))
        #expect(originalAnnotations.allSatisfy { coordinator.annotations[$0.key] === $0.value })
        let selected = try #require(model.parks.first { $0.name.contains("Hulls Cove") })
        let annotation = try #require(coordinator.annotations[selected.id])
        model.selectPark(id: selected.id, focusOnMap: false)
        coordinator.apply(to: map, detailFramingHeight: 440, topObstruction: 130)
        map.clearCounts()
        let begin = ContinuousClock.now
        for height in 200..<500 {
            coordinator.apply(
                to: map, detailFramingHeight: CGFloat(height),
                topObstruction: 130)
        }
        print(
            "CLEANUP records=\(count) geometryUpdates=300 milliseconds=\(milliseconds(begin.duration(to: .now))) markerLookups=\(map.markerLookups) addRemoveCalls=\(map.mutations)"
        )
        #expect(map.markerLookups == 0 && map.mutations == 0)
        model.cameraChanged(map.region)
        var preferences = context.settings.value
        preferences.units = .kilometers
        context.settings.update(preferences)
        coordinator.apply(to: map)
        #expect(map.markerLookups == 0 && map.mutations == 0)
        preferences.clustering.toggle()
        context.settings.update(preferences)
        coordinator.apply(to: map)
        #expect(map.markerLookups >= count)
        #expect(await probe.inputs.count == 2)
        var query = model.query
        query.search = "hulls cove"
        model.setFilters(query)
        try await eventually { model.projection?.input.query == query }
        coordinator.apply(to: map)
        #expect(model.parks.count == 1)
        #expect(Set(map.annotations.compactMap { ($0 as? ParkAnnotation)?.park.id }) == [selected.id])
        #expect(coordinator.annotations[selected.id] === annotation)
        map.clearCounts()
        query.categories = [.national]
        model.setFilters(query)
        try await eventually { model.projection?.input.query == query }
        coordinator.apply(to: map)
        #expect(map.markerLookups == 0 && map.mutations == 0)
        let computations = await probe.inputs.count
        await context.catalog.refresh(reason: .manual)
        try await eventually {
            model.catalogState.status == .fresh
                && model.projection?.input.revision == model.catalogState.snapshot?.revision
        }
        coordinator.apply(to: map)
        #expect(coordinator.annotations[selected.id] === annotation)
        #expect(annotation.park == model.catalogState.snapshot?.park(id: selected.id))
        #expect(await probe.inputs.count == computations + (large ? 0 : 1))
    }

    @Test(arguments: [393, 5000])
    func projectionTimingsAndMainActorResponsiveness(count: Int) async throws {
        let data = try Data(
            contentsOf: #require(Bundle.main.url(forResource: "catalog", withExtension: "json")))
        let base = try JSONDecoder().decode(CatalogSnapshot.self, from: data)
        let extras = try (base.parks.count..<count).map { index in
            Park(
                id: ParkID(rawValue: "synthetic-\(index)"),
                siteID: SiteID(rawValue: "synthetic-site-\(index)"),
                name: "Synthetic Park \(index)",
                coordinate: try #require(
                    Coordinate(latitude: Double(index % 160) - 80, longitude: Double(index % 360) - 180)),
                state: "Maine", stateCodes: ["ME"], category: .national)
        }
        let snapshot = CatalogSnapshot(
            revision: base.revision, publishedAt: base.publishedAt,
            sourceRevision: base.sourceRevision, parks: base.parks + extras)
        // Build once off the main actor, just as CatalogRepository does for accepted data.
        let index = await makeIndex(snapshot)
        var ticks = 0
        let heartbeat = Task { @MainActor in
            while !Task.isCancelled {
                ticks += 1
                await Task.yield()
            }
        }
        defer { heartbeat.cancel() }
        for text in ["", "park", "hulls cove", "zzzzzzzzz", "Synthetic Park 4500"] {
            var query = ParkFilter.Query()
            query.search = text
            var durations: [Double] = []
            let before = ticks
            for _ in 0..<5 {
                let began = ContinuousClock.now
                let projection = try await ParkResults.compute(snapshot: snapshot, index: index, query: query)
                durations.append(milliseconds(began.duration(to: .now)))
                #expect(projection.result.totalCount == count)
                #expect(projection.result.matchingIDs == projection.parks.map(\.id))
                if text == "hulls cove" { #expect(projection.parks.count == 1) }
                if text == "Synthetic Park 4500" {
                    #expect(projection.parks.count == (count == 5000 ? 1 : 0))
                }
            }
            #expect(ticks > before)
            print(
                "CLEANUP records=\(count) query=\(text.isEmpty ? "empty" : text) projectionMedianMs=\(durations.sorted()[2]) projectionMaxMs=\(durations.max() ?? 0) mainActorTicks=\(ticks - before)"
            )
        }
    }
    @concurrent private func makeIndex(_ snapshot: CatalogSnapshot) async -> ParkSearchIndex {
        ParkSearchIndex(parks: snapshot.parks)
    }
    private func milliseconds(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
    }
}

/// Count actual MapKit mutation/render lookups, without production-only test counters.
@MainActor
private final class CountingMapView: MKMapView {
    var markerLookups = 0
    var mutations = 0
    override func view(for annotation: any MKAnnotation) -> MKAnnotationView? {
        markerLookups += 1
        return super.view(for: annotation)
    }
    override func addAnnotations(_ annotations: [any MKAnnotation]) {
        mutations += 1
        super.addAnnotations(annotations)
    }
    override func removeAnnotations(_ annotations: [any MKAnnotation]) {
        mutations += 1
        super.removeAnnotations(annotations)
    }
    func clearCounts() {
        markerLookups = 0
        mutations = 0
    }
}
