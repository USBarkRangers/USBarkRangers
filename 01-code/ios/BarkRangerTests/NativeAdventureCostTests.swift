import BarkDomain
import Foundation
import SwiftData
import Synchronization
import Testing

@testable import BarkRanger

struct NativeAdventureCostTests {
    @MainActor
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func completedTrailsAreLazyAndWarmReadsAreReused() async throws {
        let f = try await NativeAdventureAppFixture.make()
        let feature = NativeExpeditionFeature(scope: "cost-scope", store: f.store, cloud: f.walkCloud)
        do {
            try await feature.start()
            let transport = f.walkCloud.transport
            _ = await transport.recordedCallKinds(reset: true)
            feature.sync?.setAllowed(true)
            await feature.sync?.wait()
            #expect(await transport.recordedCallKinds(reset: true) == ["expedition"])
            #expect(feature.completedCount == nil)  // Not-yet-read is not a confirmed zero.
            feature.requestCompletedTrails()
            await feature.sync?.wait()
            #expect(await transport.recordedCallKinds(reset: true) == ["completedTrails"])
            try await eventually { feature.completedCount == 0 }
            for _ in 0..<3 {
                feature.sync?.setAllowed(false)
                await feature.sync?.wait()
                feature.sync?.setAllowed(true)
                feature.requestCompletedTrails()
                await feature.sync?.wait()
            }
            #expect(await transport.recordedCallKinds().isEmpty)
            await feature.close()
            await f.close()
        } catch {
            await feature.close()
            await f.close()
            throw error
        }
    }

    @MainActor
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func historyDemandSurvivesAnOlderViewClosingAndReopeningReconcilesRemoteDeletion() async throws {
        let f = try await NativeAdventureAppFixture.make()
        do {
            f.expedition.logManual(miles: 1)
            try await eventually { !f.expedition.busy }
            try await f.settle()
            let page = try await f.walks.repository.history(before: nil)
            let record = try #require(page.items.first)
            let old = f.walks.beginHistory()
            let current = f.walks.beginHistory()
            f.walks.endHistory(old)
            await f.walks.sync?.wait()
            let transport = try #require(f.walks.repository.cloud?.transport)
            _ = await transport.recordedCallKinds(reset: true)
            f.walks.sync?.request(refresh: true)
            await f.walks.sync?.wait()
            #expect(await transport.recordedCallKinds(reset: true).contains("activityChanges"))
            f.walks.endHistory(current)
            _ = try await f.send(.remove(activityID: record.id, revision: record.revision))
            f.walks.sync?.request(refresh: true)
            await f.walks.sync?.wait()
            #expect(!((await transport.recordedCallKinds(reset: true)).contains("activityChanges")))
            // No background read removed the cached row; opening history must reconcile it.
            #expect(try await f.store.nativeActivity(id: record.id)?.deleted == false)
            let reopened = f.walks.beginHistory()
            await f.walks.sync?.wait()
            #expect(await transport.recordedCallKinds().contains("activityChanges"))
            #expect(try await f.store.nativeActivity(id: record.id)?.deleted != false)
            f.walks.endHistory(reopened)
            await f.close()
        } catch {
            await f.close()
            throw error
        }
    }

    @MainActor
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func quietForegroundReturnsDoNotRepeatFreshSummaryRequests() async throws {
        let f = try await NativeAdventureAppFixture.make()
        do {
            f.visits.recordActivity()
            await f.session.waitForSync()
            let trips = try #require(f.session.nativeTrips?.repository.cloud?.transport)
            let visits = try #require(f.visits.repository.cloud?.transport)
            let walks = try #require(f.walks.repository.cloud?.transport)
            let profile = try #require(f.session.nativeProfile?.sync)
            let profileReads = await profile.recordedDocumentReadCount()
            for transport in [trips, visits, walks] { _ = await transport.recordedCallKinds(reset: true) }
            for _ in 0..<3 {
                f.session.setForeground(false)
                await f.session.waitForSync()
                f.session.setForeground(true)
                f.visits.recordActivity()
                await f.session.waitForSync()
            }
            let calls =
                await trips.recordedCallKinds() + visits.recordedCallKinds() + walks.recordedCallKinds()
            print("NATIVE_REFRESH_COST three_quiet_returns=\(calls)")
            #expect(calls.isEmpty)
            #expect(await profile.recordedDocumentReadCount() == profileReads)

            // A forced refresh still observes another device; it is not suppressed
            // by the recent successful foreground refresh or by an empty outbox.
            f.session.requestSync(refresh: true)
            await f.session.waitForSync()
            #expect(await trips.recordedCallKinds().contains("tripChanges"))
            #expect(await visits.recordedCallKinds().contains("progress"))
            #expect(await walks.recordedCallKinds().contains("expedition"))
            #expect(await profile.recordedDocumentReadCount() > profileReads)
            await f.close()
        } catch {
            await f.close()
            throw error
        }
    }

    @MainActor
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func closedWalkHistoryDoesNotContinueDownloadingChanges() async throws {
        let f = try await NativeAdventureAppFixture.make()
        let observer = Task { await f.expedition.observeHistory() }
        do {
            try await eventually { f.expedition.history?.hasConfirmedPage == true }
            observer.cancel()
            f.expedition.history?.stop()
            await observer.value
            await f.session.waitForSync()
            let transport = try #require(f.walks.repository.cloud?.transport)
            _ = await transport.recordedCallKinds(reset: true)
            f.session.requestSync(refresh: true)
            await f.session.waitForSync()
            let calls = await transport.recordedCallKinds()
            print("NATIVE_REFRESH_COST closed_history_forced_summary_refresh=\(calls)")
            #expect(!calls.contains("activityChanges") && !calls.contains("activityHistory"))
            await f.close()
        } catch {
            observer.cancel()
            await observer.value
            await f.close()
            throw error
        }
    }

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
