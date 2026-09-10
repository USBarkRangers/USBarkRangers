import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

/// Owns each test's temporary disk/preferences and the optional controlled computation boundary.
@MainActor
final class DiscoveryTestContext {
    let disk: CatalogDiskStore
    let defaults: UserDefaults
    let suite = "bark.discovery-test.\(UUID())"
    let catalog: CatalogRepository
    let settings: SettingsRepository
    let model: MapFeatureModel

    init(
        scenario: String? = nil, compute: @escaping ParkResults.Compute = ParkResults.compute,
        maps: MapsHandoff = MapsHandoff(open: { _ in true })
    ) throws {
        disk = CatalogDiskStore(
            directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString),
            bundleDirectory: try #require(Bundle.main.resourceURL))
        defaults = try #require(UserDefaults(suiteName: suite))
        catalog = CatalogRepository(
            disk: disk,
            client: try scenario.map {
                CatalogHTTPClient(
                    manifestURL: try #require(URL(string: "http://127.0.0.1:8787/\($0)/manifest.json")))
            }, diagnostics: Diagnostics(enabled: false))
        settings = SettingsRepository(defaults: defaults)
        model = MapFeatureModel(
            catalog: catalog, settings: settings, location: LocationClient(manager: nil), maps: maps,
            computeResults: compute)
    }
    func start() async throws {
        _ = await catalog.loadLocal()
        model.start()
        try await eventually { self.model.projection != nil }
    }
    func close() {
        model.stop()
        defaults.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: disk.directory)
    }
}

@MainActor
func eventually(_ condition: @MainActor () async -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(5))
    while !(await condition()) && ContinuousClock.now < deadline { await Task.yield() }
    try #require(await condition())
}

/// A suspended, deliberately non-cooperative completion verifies the model's stale-result guard.
actor ControlledParkResults {
    private(set) var inputs: [ParkResults.Input] = []
    private var holds: Set<String> = []
    private var waiting: [String: CheckedContinuation<Void, Never>] = [:]
    func hold(_ query: String) { holds.insert(query) }
    func release(_ query: String) {
        holds.remove(query)
        waiting.removeValue(forKey: query)?.resume()
    }
    func isWaiting(_ query: String) -> Bool { waiting[query] != nil }
    func compute(_ snapshot: CatalogSnapshot, _ index: ParkSearchIndex?, _ query: ParkFilter.Query)
        async throws -> ParkResults
    {
        inputs.append(.init(revision: snapshot.revision, query: query))
        let result = try await ParkResults.compute(snapshot: snapshot, index: index, query: query)
        if holds.contains(query.search) {
            await withCheckedContinuation { waiting[query.search] = $0 }
        }
        return result
    }
}
