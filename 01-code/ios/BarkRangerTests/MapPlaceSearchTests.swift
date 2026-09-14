import BarkDomain
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct MapPlaceSearchTests {
    // Opt-in platform smoke test: ordinary regression runs remain deterministic and offline.
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_LIVE_MAP_SEARCH"] == "1"))
    func appleCompletionResolvesAPublicBusinessWithoutCatalogIdentity() async throws {
        let nearby = MKCoordinateRegion(
            center: .init(latitude: 29.65, longitude: -82.35),
            span: .init(latitudeDelta: 0.5, longitudeDelta: 0.5))
        for (query, region) in [("Target Gainesville FL", nil), ("Target", nearby)] {
            let results = try await MapSearchClient.live.suggestions(query, region)
            let suggestion = try #require(
                results.first { $0.title.localizedCaseInsensitiveContains("Target") })
            let place = try await MapSearchClient.live.resolve(suggestion)
            let coordinate = try #require(place.stop.coordinate)
            #expect(place.stop.parkID == nil && !place.subtitle.isEmpty)
            #expect((29...30).contains(coordinate.latitude) && (-83 ... -81).contains(coordinate.longitude))
            #expect(
                try JSONDecoder().decode(
                    Trip.self, from: JSONEncoder().encode(Trip(days: [.init(stops: [place.stop])]))
                ).days[0].stops[0].id
                    == place.stop.id)
        }
    }
    @Test func lateSuggestionsAndResolutionCannotReplaceNewQueryOrClosedSearch() async throws {
        let backend = HeldPlaceSearch()
        let model = MapPlaceSearchModel(client: backend.client, delay: .zero)
        model.update(query: "old", region: nil, permitted: true, connected: true)
        try await eventually { backend.queries["old"] != nil }
        model.update(query: "new", region: nil, permitted: true, connected: true)
        try await eventually { backend.queries["new"] != nil }
        backend.finish("new")
        try await eventually { model.suggestions.first?.title == "new" }
        backend.finish("old")
        await Task.yield()
        #expect(model.suggestions.first?.title == "new")
        var selected: String?
        model.select(try #require(model.suggestions.first)) { selected = $0.stop.name }
        try await eventually { backend.resolution != nil }
        model.cancel()
        backend.finishResolution()
        await Task.yield()
        #expect(selected == nil && model.suggestions.isEmpty && !model.isResolving)
    }
    @Test func identicalQueryAndCameraChangesDoNotRequestAgainAndResolutionDoesNotAdd() async throws {
        var requests = 0
        let coordinate = try #require(Coordinate(latitude: 41, longitude: -81))
        let stop = Trip.Stop(name: "Target", coordinate: coordinate)
        let client = MapSearchClient(
            suggestions: { _, _ in
                requests += 1
                return [.init(id: "target", title: "Target", subtitle: "Gainesville")]
            }, resolve: { _ in .init(stop: stop, subtitle: "Gainesville") })
        let model = MapPlaceSearchModel(client: client, delay: .zero)
        model.update(query: "target", region: nil, permitted: true, connected: true)
        try await eventually { !model.isSearching }
        for _ in 0..<100 {
            model.update(query: "target", region: MKCoordinateRegion(), permitted: true, connected: true)
        }
        #expect(requests == 1)
        var selection: Trip.Stop?
        model.select(try #require(model.suggestions.first)) { selection = $0.stop }
        try await eventually { selection != nil }
        #expect(selection == stop && stop.parkID == nil)
        model.cancel()
    }
    @Test func offlineAndFreeSearchKeepCoordinateFallbackWithoutNetworkRequests() async throws {
        let model = MapPlaceSearchModel(
            client: .init(
                suggestions: { _, _ in
                    Issue.record("Must not call native online search")
                    return []
                }, resolve: { _ in throw CancellationError() }), delay: .zero)
        model.update(query: "address", region: nil, permitted: false, connected: true)
        #expect(model.notice?.contains("Premium") == true && !model.isSearching)
        model.update(query: "address", region: nil, permitted: true, connected: false)
        #expect(model.notice?.contains("Connect") == true && !model.isSearching)
        model.update(query: "41.2, -81.5", region: nil, permitted: false, connected: false)
        var selected: Trip.Stop?
        model.select(try #require(model.suggestions.first)) { selected = $0.stop }
        try await eventually { selected != nil }
        #expect(selected?.coordinate == Coordinate(latitude: 41.2, longitude: -81.5))
        #expect(selected?.parkID == nil)
        model.cancel()
    }
    @Test func parkAndPlaceShareOneDetailIdentityAndDirectionsTarget() async throws {
        var opened: URL?
        let context = try DiscoveryTestContext(
            maps: MapsHandoff {
                opened = $0
                return true
            })
        try await context.start()
        let model = context.model
        let park = try #require(model.parks.first)
        model.selectPark(id: park.id)
        let stop = Trip.Stop(name: "Home", coordinate: try #require(Coordinate(latitude: 41, longitude: -81)))
        model.selectPlace(.init(stop: stop, subtitle: "Ohio"))
        #expect(model.selectedID == nil && model.detail.park == nil && model.detail.place == stop)
        model.detail.navigate()
        await model.detail.navigation?.value
        #expect(opened == MapsHandoff.navigationURL(for: stop))
        model.selectPark(id: park.id)
        #expect(model.detail.place == nil && model.selectedID == park.id)
        model.dismissPark()
        #expect(model.selectionID == nil)
        context.close()
    }
}

@MainActor private final class HeldPlaceSearch {
    var queries: [String: CheckedContinuation<[MapSearchClient.Suggestion], any Error>] = [:]
    var resolution: CheckedContinuation<MapSearchClient.Place, any Error>?
    var client: MapSearchClient {
        .init(
            suggestions: { query, _ in
                try await withCheckedThrowingContinuation { self.queries[query] = $0 }
            }, resolve: { _ in try await withCheckedThrowingContinuation { self.resolution = $0 } })
    }
    func finish(_ query: String) {
        queries.removeValue(forKey: query)?.resume(returning: [.init(id: query, title: query, subtitle: "")])
    }
    func finishResolution() {
        guard let coordinate = Coordinate(latitude: 40, longitude: -80) else { return }
        resolution?.resume(
            returning: .init(stop: .init(name: "Late place", coordinate: coordinate), subtitle: ""))
        resolution = nil
    }
}
