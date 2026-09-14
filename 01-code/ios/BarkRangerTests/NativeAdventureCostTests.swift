import BarkDomain
import Foundation
import SwiftData
import Synchronization
import Testing

@testable import BarkRanger

struct NativeAdventureCostTests {
    @Test func thousandWalkArchiveKeepsBoundedCacheAndOneNewWalkTouchesOnlyItsOutboxRows() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "cost")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        let now = Int64(Date().timeIntervalSince1970 * 1000) - 1000
        var cursor: NativeActivityPage.Cursor?
        for pageIndex in 0..<20 {
            let objects: [[String: Any]] = (0..<50).map { offset in
                let at = now - Int64(pageIndex * 50 + offset) * 1000
                return [
                    "schemaVersion": 1, "id": UUID().uuidString.lowercased(), "revision": 1,
                    "updatedAt": ["seconds": now / 1000, "nanoseconds": 0], "deleted": false,
                    "source": "manual", "startedAtMs": at, "endedAtMs": at, "originalMeters": 1609.344,
                    "elapsedSeconds": 0, "runID": NSNull(), "miles": 1, "happenedAtMs": at,
                    "trailName": "History \(pageIndex * 50 + offset)",
                    "recordedAt": ["seconds": now / 1000, "nanoseconds": 0],
                ]
            }
            let last = try #require(objects.last)
            let page = try JSONDecoder().decode(
                NativeActivityPage.self,
                from: JSONSerialization.data(withJSONObject: [
                    "version": 1, "items": objects,
                    "readTime": ["seconds": now / 1000 + 1, "nanoseconds": 0],
                    "next": ["id": last["id"]!, "happenedAtMs": last["happenedAtMs"]!],
                ]))
            #expect(try await store.acceptNativeActivityHistory(page, after: cursor))
            cursor = page.next
        }
        #expect(try await store.activityCacheCount() == 250)
        let measurements = Mutex<[[String: Int]]>([])
        await store.measureAdventureCommits { rows in measurements.withLock { $0.append(rows) } }
        let profileEvents = Mutex(0)
        let observer = Task {
            for await _ in try await store.profileUpdates() { profileEvents.withLock { $0 += 1 } }
        }
        try await eventually { profileEvents.withLock { $0 } == 1 }
        let at = Date()
        let summary = try NativeActivitySummary(
            WalkSummary(
                source: .manual, startedAt: at, endedAt: at,
                meters: 1609.344, elapsedSeconds: 0))
        _ = try await store.stageNativeExpeditionOperation(
            .init(action: .record(summary), recordedTrailName: "New walk"))
        let commits = measurements.withLock { $0 }
        #expect(
            commits.count == 1 && commits.first?["PendingOperation"] == 1 && commits.first?["Metadata"] == 1)
        #expect(commits.first?.count == 2 && profileEvents.withLock { $0 } == 1)
        let submission = try #require(try await store.nextExpeditionSubmission())
        #expect(submission.submission.bytes.count < 1024)
        #expect(try await store.activityCacheCount() == 250)
        #expect(try await store.nativeExpeditionOverview().pendingIDs.count == 1)
        print(
            "NATIVE_WALK_COST history_loaded=1000 cached=250 new_walk_rows=\(commits) command_bytes=\(submission.submission.bytes.count) profile_invalidations=0"
        )
        observer.cancel()
        try await observer.value
        await store.close()
    }

    @Test func activityInvalidationsCoalesceWithoutLosingDeletionsAndOverflowRequestsBoundedReload()
        async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "events")
        let stream = try await store.changes(matching: [.activityHistory])
        await store.publish([.activityHistory, .activity("a")])
        await store.publish([.activityHistory, .activity("b")])
        var iterator = stream.makeAsyncIterator()
        let merged = try #require(await iterator.next())
        #expect(merged.contains(.activity("a")) && merged.contains(.activity("b")))
        for index in 0..<1200 { await store.publish([.activityHistory, .activity("id-\(index)")]) }
        let bounded = try #require(await iterator.next())
        #expect(bounded.contains(.activityHistoryReset) && bounded.count <= 512)
        await store.close()
    }
}
extension NativeStore {
    fileprivate func activityCacheCount() throws -> Int {
        try modelContext.fetchCount(FetchDescriptor<NativeLocalSchema.Activity>())
    }
    fileprivate func measureAdventureCommits(_ observer: @escaping @Sendable ([String: Int]) -> Void) {
        commitObserver = observer
    }
}
