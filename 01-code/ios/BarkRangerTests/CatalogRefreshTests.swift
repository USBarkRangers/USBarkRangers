import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor
struct CatalogRefreshTests {
    @Test func automaticChecksWaitFiveMinutesAndDoNotRewriteUnchangedOfflineData() async throws {
        let time = Mutex(ContinuousClock.now)
        let disk = CatalogDiskStore(
            directory: URL.temporaryDirectory.appendingPathComponent(UUID().uuidString),
            bundleDirectory: try #require(Bundle.main.resourceURL))
        defer { try? FileManager.default.removeItem(at: disk.directory) }
        let catalog = CatalogRepository(
            disk: disk,
            client: CatalogHTTPClient(
                manifestURL: try #require(URL(string: "http://127.0.0.1:8787/polling/manifest.json"))),
            now: { time.withLock { $0 } })
        let before = try await requests()
        await catalog.refresh(reason: .startup)
        let accepted = await catalog.current()
        #expect(accepted.status == .fresh)
        #expect(await catalog.nextRefreshDelay() == .seconds(300))
        let cache = disk.directory.appendingPathComponent("current.json")
        let bytes = try Data(contentsOf: cache)
        let modified = try cache.resourceValues(forKeys: [.contentModificationDateKey])
            .contentModificationDate
        let initialRequests = try await requests()
        #expect(initialRequests - before == 2, "One small manifest and one changed payload")

        time.withLock { $0 = $0.advanced(by: .seconds(299)) }
        await catalog.refresh(reason: .regular)
        await catalog.refresh(reason: .foreground)
        #expect(try await requests() == initialRequests)
        #expect(await catalog.nextRefreshDelay() == .seconds(1))

        time.withLock { $0 = $0.advanced(by: .seconds(1)) }
        await catalog.refresh(reason: .regular)
        #expect(try await requests() == initialRequests + 1, "304 must not download the parks again")
        #expect(await catalog.nextRefreshDelay() == .seconds(300))
        #expect(try Data(contentsOf: cache) == bytes)
        #expect(
            try cache.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
                == modified)
        let offline = await CatalogRepository(disk: disk, client: nil).loadLocal()
        #expect(offline.source == .saved)
        #expect(offline.snapshot?.revision == accepted.snapshot?.revision)
        #expect(offline.snapshot?.parks.first?.info == accepted.snapshot?.parks.first?.info)
    }

    @Test func normalBuildHasAPublicCatalogEndpoint() throws {
        let value = try #require(
            Bundle.main.object(forInfoDictionaryKey: "BarkCatalogManifestURL") as? String)
        let endpoint = try #require(URL(string: value))
        #expect(endpoint.scheme == "https")
        #expect(endpoint.host == "storage.googleapis.com")
        #expect(endpoint.path == "/bark-ranger-ios-public-catalog/native-catalog/v1/manifest.json")
        #expect(CatalogHTTPClient.allowedEndpoint(endpoint))
    }

    private func requests() async throws -> Int {
        let url = try #require(URL(string: "http://127.0.0.1:8787/__stats"))
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode([String: Int].self, from: data)
            .filter { $0.key.hasPrefix("polling/") }.values.reduce(0, +)
    }
}
