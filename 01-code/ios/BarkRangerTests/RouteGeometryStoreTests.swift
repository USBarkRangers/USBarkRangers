import Foundation
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct RouteGeometryStoreTests {
    @Test func thirtyDayDeadlineSurvivesRelaunchAndReadsNeverExtendIt() async throws {
        let directory = RouteCacheFixture.directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let store = RouteGeometryStore(directory: directory)
        await store.save(try RouteCacheFixture.snapshot(at: start), key: "road", scope: "alice", now: start)
        let nearExpiry = start.addingTimeInterval(30 * 86_400 - 1)
        let reopened = RouteGeometryStore(directory: directory)
        #expect(await reopened.load(keys: ["road"], scope: "alice", now: nearExpiry).count == 1)
        let expired = start.addingTimeInterval(30 * 86_400)
        #expect(
            await RouteGeometryStore(directory: directory).load(keys: ["road"], scope: "alice", now: expired)
                .isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
    }

    @Test func corruptAndFutureRecordsAreMissesWithoutDiscardingHealthySegments() async throws {
        let directory = RouteCacheFixture.directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let date = Date()
        let store = RouteGeometryStore(directory: directory)
        await store.save(try RouteCacheFixture.snapshot(at: date), key: "bad", scope: "alice", now: date)
        let bad = try #require(
            FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        try Data("truncated".utf8).write(to: bad)
        await store.save(try RouteCacheFixture.snapshot(1, at: date), key: "good", scope: "alice", now: date)
        let read = await store.load(keys: ["bad", "good"], scope: "alice", now: date)
        #expect(Set(read.keys) == ["good"])
        #expect(!FileManager.default.fileExists(atPath: bad.path))
        #expect(await store.load(keys: ["good"], scope: "alice", now: date.addingTimeInterval(-1)).isEmpty)
    }

    @Test func byteBudgetEvictsOldestGeometryAndNotTripData() async throws {
        let directory = RouteCacheFixture.directory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let date = Date()
        let initial = RouteGeometryStore(directory: directory)
        await initial.save(try RouteCacheFixture.snapshot(at: date), key: "aa", scope: "alice", now: date)
        let url = try #require(
            FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        let size = try Data(contentsOf: url).count
        let limited = RouteGeometryStore(directory: directory, maximumBytes: size * 2 + 10)
        for (index, key) in ["bb", "cc"].enumerated() {
            let now = date.addingTimeInterval(Double(index + 1))
            await limited.save(try RouteCacheFixture.snapshot(at: now), key: key, scope: "alice", now: now)
        }
        let loaded = await limited.load(
            keys: ["aa", "bb", "cc"], scope: "alice", now: date.addingTimeInterval(3))
        #expect(Set(loaded.keys) == ["bb", "cc"])
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path).count == 2)
    }

    @Test func failedDiskWritesStillReturnTheCalculatedRoute() async throws {
        let blocked = RouteCacheFixture.directory()
        defer { try? FileManager.default.removeItem(at: blocked) }
        try Data("a file occupies the cache directory".utf8).write(to: blocked)
        var calls = 0
        let provider = RoutePreviewService(
            calculate: { segment in
                calls += 1
                return RouteCacheFixture.route(segment)
            }, store: RouteGeometryStore(directory: blocked))
        provider.clear(scope: "alice")
        let segment = try RouteCacheFixture.segment()
        let route = try await provider.route(segment)
        #expect(route.polyline.pointCount == 2 && route.meters == 1609.344)
        _ = try await provider.route(segment)
        #expect(calls == 1)
    }
}
