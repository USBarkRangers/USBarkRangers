import BarkDomain
import Foundation
import MapKit
import Testing

@testable import BarkRanger

/// HTTP scenarios are served by the checked-in loopback fixture server. CI starts it before tests.
@MainActor
struct CatalogTests {
    private func disk() throws -> CatalogDiskStore {
        let bundle = try #require(Bundle.main.resourceURL)
        return CatalogDiskStore(
            directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString),
            bundleDirectory: bundle)
    }
    private func client(_ scenario: String) throws -> CatalogHTTPClient {
        CatalogHTTPClient(
            manifestURL: try #require(URL(string: "http://127.0.0.1:8787/\(scenario)/manifest.json")))
    }
    private func original(_ disk: CatalogDiskStore) throws -> CatalogDiskStore.Envelope {
        try #require(disk.loadCandidates().first?.envelope)
    }
    @Test func corruptCurrentAndInterruptedCommitRetainNewestCompatibleCandidate() async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let old = try original(disk)
        try disk.commit(old, previous: nil)
        try Data("interrupted temporary bytes".utf8).write(
            to: disk.directory.appendingPathComponent("unfinished.tmp"))
        try Data("corrupt".utf8).write(to: disk.directory.appendingPathComponent("current.json"))
        let catalog = CatalogRepository(disk: disk, client: nil)
        let loaded = await catalog.loadLocal()
        #expect(loaded.snapshot?.parks.count == 393)
        #expect(loaded.source == .bundle)
        try disk.commit(old, previous: old)
        try Data("corrupt".utf8).write(to: disk.directory.appendingPathComponent("current.json"))
        let restored = await CatalogRepository(disk: disk, client: nil).loadLocal()
        #expect(restored.source == .saved)
    }
    @Test func validatedUpdateCommitsThenRestartsOffline() async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let catalog = CatalogRepository(disk: disk, client: try client("valid"))
        let local = await catalog.loadLocal()
        await catalog.refresh(reason: .startup)
        let updated = await catalog.current()
        #expect(updated.status == .fresh)
        #expect(try #require(updated.snapshot?.revision) > #require(local.snapshot?.revision))
        #expect(updated.snapshot?.parks.count == 393)
        let offline = await CatalogRepository(disk: disk, client: nil).loadLocal()
        #expect(offline.snapshot?.revision == updated.snapshot?.revision)
        #expect(offline.source == .saved)
        await catalog.refresh(reason: .manual)
        #expect(await catalog.current().status == .fresh)
    }
    @Test(arguments: ["malformed", "shrunk", "hash-mismatch"])
    func rejectedResponsesRetainAcceptedCatalog(_ scenario: String) async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let catalog = CatalogRepository(disk: disk, client: try client(scenario))
        let local = await catalog.loadLocal()
        await catalog.refresh(reason: .startup)
        let state = await catalog.current()
        #expect(state.status == .unavailable)
        #expect(state.snapshot?.revision == local.snapshot?.revision)
        #expect(
            !FileManager.default.fileExists(
                atPath: disk.directory.appendingPathComponent("current.json").path))
    }
    @Test func stalledResponseBodyHonorsWholeRequestDeadline() async throws {
        let http = try client("stalled")
        let began = ContinuousClock.now
        guard
            case .changed(let manifest, _) = try await http.fetchManifest(
                etag: nil, deadline: .now.advanced(by: .seconds(1)))
        else {
            Issue.record("Expected fixture manifest")
            return
        }
        do {
            _ = try await http.download(manifest, deadline: .now.advanced(by: .milliseconds(150)))
            Issue.record("Expected deadline")
        } catch { #expect(began.duration(to: .now) < .seconds(2)) }
    }
    @Test func loaderRevealsSavedDataWhileSlowUpdateContinues() async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let catalog = CatalogRepository(disk: disk, client: try client("slow"))
        let startup = StartupModel(
            catalog: catalog, network: NetworkMonitor(), diagnostics: Diagnostics(enabled: false),
            decisionBudget: .milliseconds(150))
        #expect(startup.start())
        #expect(!startup.start())
        try await Task.sleep(for: .milliseconds(400))
        #expect(startup.state == .ready)
        #expect(try #require(startup.dismissalMilliseconds) < 1000)
        #expect(await catalog.current().source == .bundle)
        await catalog.refresh(reason: .manual)
        #expect(await catalog.current().source == .online)
        #expect(startup.state == .ready)
        startup.stop()
    }
    @Test func freshUpdateCanBeAcceptedBeforeCoverDismissal() async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let catalog = CatalogRepository(disk: disk, client: try client("valid"))
        let startup = StartupModel(
            catalog: catalog, network: NetworkMonitor(), diagnostics: Diagnostics(enabled: false))
        startup.start()
        try await Task.sleep(for: .seconds(2))
        #expect(startup.state == .ready)
        #expect(await catalog.current().status == .fresh)
        #expect(try #require(startup.localReadyMilliseconds) < #require(startup.dismissalMilliseconds))
        startup.stop()
    }
    @Test func existingParksRefreshOnReconnectWithoutResettingPresentation() async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let catalog = CatalogRepository(disk: disk, client: try client("valid"))
        _ = await catalog.loadLocal()
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let model = MapFeatureModel(
            catalog: catalog, settings: SettingsRepository(defaults: defaults), location: LocationClient(),
            maps: MapsHandoff(open: { _ in false }))
        model.start()
        try await Task.sleep(for: .milliseconds(50))
        let park = try #require(model.parks.first)
        model.selectPark(id: park.id)
        var filter = model.query
        filter.swag = [park.swag]
        model.setFilters(filter)
        let camera = model.cameraRequest?.id
        let coordinator = MapCoordinator(model: model)
        let map = MKMapView()
        coordinator.apply(to: map)
        let annotation = try #require(coordinator.annotations[park.id])
        await catalog.noteOffline()
        await catalog.refresh(reason: .reconnect)
        try await Task.sleep(for: .milliseconds(100))
        coordinator.apply(to: map)
        #expect(model.catalogState.status == .fresh)
        #expect(model.query == filter && model.selectedID == park.id && model.cameraRequest?.id == camera)
        #expect(coordinator.annotations[park.id] === annotation)
        #expect(model.result.matchingCount == model.parks.count)
        model.stop()
    }
    @Test func appleMapsURLCannotInjectQueryFieldsAndFailureIsPresented() async throws {
        let disk = try disk()
        let catalog = CatalogRepository(disk: disk, client: nil)
        let state = await catalog.loadLocal()
        let source = try #require(state.snapshot?.parks.first)
        let maliciousName = "Park &dirflg=w?token=secret #日本"
        let park = Park(
            id: source.id, siteID: source.siteID, name: maliciousName, coordinate: source.coordinate)
        let url = try #require(MapsHandoff.navigationURL(for: park))
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(components.host == "maps.apple.com")
        #expect(components.queryItems?.count == 3)
        #expect(components.queryItems?.first(where: { $0.name == "q" })?.value == maliciousName)
        let detail = ParkDetailModel(maps: MapsHandoff(open: { _ in false }))
        detail.show(source)
        detail.navigate()
        await detail.navigation?.value
        #expect(detail.message != nil && !detail.isOpeningMaps)
    }
    @Test func pinSelectionPreservesZoomAndUpdatesDetailsAndDirectionsTogether() async throws {
        let catalog = CatalogRepository(disk: try disk(), client: nil)
        _ = await catalog.loadLocal()
        let suite = "bark.test.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        var opened: URL?
        let model = MapFeatureModel(
            catalog: catalog, settings: SettingsRepository(defaults: defaults), location: LocationClient(),
            maps: MapsHandoff(open: {
                opened = $0
                return true
            }))
        model.start()
        defer { model.stop() }
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while model.parks.isEmpty && ContinuousClock.now < deadline { await Task.yield() }
        let first = try #require(model.parks.first)
        let second = try #require(model.parks.dropFirst().first)
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 760))
        map.setRegion(
            .init(
                center: .init(latitude: 40, longitude: -80),
                span: .init(latitudeDelta: 5, longitudeDelta: 5)), animated: false)
        let coordinator = MapCoordinator(model: model)
        coordinator.apply(to: map)
        model.selectPark(id: first.id, focusOnMap: false)
        let cameraRequest = model.cameraRequest?.id
        let distance = map.camera.centerCoordinateDistance
        coordinator.mapView(map, didSelect: try #require(coordinator.annotations[second.id]))
        #expect(model.selectedID == second.id && model.detail.park?.id == second.id)
        #expect(model.cameraRequest?.id == cameraRequest)
        coordinator.apply(to: map)
        #expect(abs(map.camera.centerCoordinateDistance - distance) < 10)
        model.detail.navigate()
        await model.detail.navigation?.value
        #expect(opened == MapsHandoff.navigationURL(for: second))
        model.dismissPark()
        model.stop()
        await Task.yield()
        coordinator.apply(to: map)
        #expect(model.selectedID == nil && model.detail.park == nil)
        #expect(map.selectedAnnotations.isEmpty)
    }

    @Test func offlineGeographyIsActuallyBundled() {
        #expect(!OfflineBasemapOverlay.loadOutlines().isEmpty)
        let overlay = OfflineBasemapOverlay(urlTemplate: nil)
        #expect(overlay.canReplaceMapContent)
        overlay.loadTile(at: MKTileOverlayPath(x: 0, y: 0, z: 0, contentScaleFactor: 1)) { bytes, error in
            #expect(bytes?.isEmpty == false && error == nil)
        }
    }
    private func revised(_ envelope: CatalogDiskStore.Envelope, revision: Int64) throws
        -> CatalogDiskStore.Envelope
    {
        var body = try #require(JSONSerialization.jsonObject(with: envelope.payload) as? [String: Any])
        body["revision"] = revision
        let bytes = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        var fields = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope.manifest)) as? [String: Any])
        fields["revision"] = revision
        fields["bytes"] = bytes.count
        fields["sha256"] = CatalogValidator.hash(bytes)
        fields["path"] = "revisions/\(revision)-\(CatalogValidator.hash(bytes)).json"
        let manifest = try JSONDecoder().decode(
            CatalogManifest.self, from: JSONSerialization.data(withJSONObject: fields))
        return CatalogDiskStore.Envelope(manifest: manifest, payload: bytes)
    }
    @Test func newerBundleWinsOverOlderValidDiskAndInvalidNewerDiskIsIgnored() async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let bundle = try original(disk)
        try disk.commit(revised(bundle, revision: bundle.manifest.revision - 1), previous: nil)
        let selected = await CatalogRepository(disk: disk, client: nil).loadLocal()
        #expect(selected.source == .bundle)
        #expect(selected.snapshot?.revision == bundle.manifest.revision)
        let newer = try revised(bundle, revision: bundle.manifest.revision + 100)
        let damaged = CatalogDiskStore.Envelope(manifest: newer.manifest, payload: Data("wrong bytes".utf8))
        try disk.commit(damaged, previous: bundle)
        let recovered = await CatalogRepository(disk: disk, client: nil).loadLocal()
        #expect(recovered.snapshot?.revision == bundle.manifest.revision)
    }
    @Test func failedDiskCommitAndCancelledDownloadCannotPublish() async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        try Data("file blocks creation of directory".utf8).write(to: disk.directory)
        let catalog = CatalogRepository(disk: disk, client: try client("valid"))
        let local = await catalog.loadLocal()
        await catalog.refresh(reason: .startup)
        #expect(await catalog.current().snapshot?.revision == local.snapshot?.revision)
        #expect(await catalog.current().status == .unavailable)
        let otherDisk = try self.disk()
        defer { try? FileManager.default.removeItem(at: otherDisk.directory) }
        let other = CatalogRepository(disk: otherDisk, client: try client("stalled"))
        let task = Task { await other.refresh(reason: .startup) }
        try await Task.sleep(for: .milliseconds(100))
        let began = ContinuousClock.now
        await other.cancelRefresh()
        await task.value
        #expect(began.duration(to: .now) < .seconds(2))
        #expect(await other.current().source == .bundle)
    }
    @Test func retryAfterBlocksManualAndReconnectRequests() async throws {
        let disk = try disk()
        let catalog = CatalogRepository(disk: disk, client: try client("throttled"))
        await catalog.refresh(reason: .startup)
        #expect(await catalog.current().status == .unavailable)
        #expect(await catalog.nextRefreshDelay() > .seconds(59))
        let begin = ContinuousClock.now
        await catalog.refresh(reason: .manual)
        await catalog.refresh(reason: .reconnect)
        #expect(begin.duration(to: .now) < .milliseconds(50))
        #expect(await catalog.current().status == .unavailable)
    }
    @Test func largeCatalogRemainsFilterableAndSearchableAfterNetworkAcceptance() async throws {
        let disk = try disk()
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let catalog = CatalogRepository(disk: disk, client: try client("large"))
        let begin = ContinuousClock.now
        await catalog.refresh(reason: .startup)
        let state = await catalog.current()
        #expect(state.status == .fresh)
        #expect(state.snapshot?.parks.count == 5000)
        let snapshot = try #require(state.snapshot)
        var query = ParkFilter.Query()
        query.search = "Synthetic Park 4500"
        let matches = ParkFilter.apply(
            catalog: snapshot, query: query, searchIDs: state.index?.search(query.search))
        #expect(matches.matchingCount == 1 && matches.totalCount == 5000)
        print(
            "PHASE2 5000-record HTTP acceptance milliseconds=\(Double(begin.duration(to: .now).components.attoseconds) / 1e15 + Double(begin.duration(to: .now).components.seconds) * 1000)"
        )
    }

    @Test func settingsChangesRebuildResultsWithoutAMountedMapView() async throws {
        let disk = try disk()
        let catalog = CatalogRepository(disk: disk, client: nil)
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let preferences = SettingsRepository(defaults: defaults)
        let model = MapFeatureModel(
            catalog: catalog, settings: preferences, location: LocationClient(),
            maps: MapsHandoff(open: { _ in false }))
        _ = await catalog.loadLocal()
        model.start()
        try await Task.sleep(for: .milliseconds(50))
        var query = model.query
        query.search = "zzzzzzzzz"
        model.setFilters(query)
        try await eventually { model.projection?.input.query == query }
        #expect(model.result.matchingCount == 0)
        preferences.resetPreferences()
        try await Task.sleep(for: .milliseconds(50))
        #expect(model.result.matchingCount == 393)
        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 13.4, longitude: 144.7),
            span: MKCoordinateSpan(latitudeDelta: 1, longitudeDelta: 2))
        model.cameraChanged(region)
        #expect(model.lastRegion?.center.longitude == 144.7)
        model.stop()
    }

}
