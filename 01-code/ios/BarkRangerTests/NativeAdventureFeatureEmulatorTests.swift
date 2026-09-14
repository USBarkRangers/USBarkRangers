import BarkDomain
import FirebaseAuth
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeAdventureFeatureEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func mapPassportDateBulkRemovalAndCSVUseNativeRecordsAfterLostReply() async throws {
        try await withApp { f in
            #expect(
                f.session.state == nil && f.session.cloud == nil && f.session.visits == nil
                    && f.session.expeditions == nil)
            let parks = try #require(await f.context.catalog.current().snapshot?.parks)
            let park = try #require(parks.first { !$0.isRetired })
            await f.offline()
            f.map.detail.show(park)
            f.map.detail.markVisit(usingLocation: false)
            try await eventually {
                !f.map.detail.isSavingVisit && f.passport.pendingCount == 1 && f.map.detail.isVisited
            }
            f.map.detail.markVisit(usingLocation: false)
            try await eventually { !f.map.detail.isSavingVisit }
            #expect(try await f.store.visitQueue().count == 1)
            let selected = try await f.visits.repository.workingState(park: park)
            let command = try #require(try await f.store.nextVisitSubmission())
            #expect(try await f.visitCloud.submit(command.submission).status == .accepted)
            // The server saved the visit, but the command receipt was lost locally.
            try await f.store.acceptNativeProgress(f.visitCloud.progress())
            try await eventually { f.visits.overview?.progress?.sites == 1 }
            #expect(f.passport.pendingCount == 1 && f.visits.overview?.progress?.points == 1)
            try await f.settle()
            try await eventually { f.passport.pendingCount == 0 }
            #expect(try await f.visitCloud.history().items.count == 1)
            let progress = Task { await f.passport.observeProgress() }
            defer { progress.cancel() }
            try await eventually { f.passport.history != nil && f.passport.content?.summary.sites == 1 }
            let history = try #require(f.passport.history)
            let observer = Task { await history.observe() }
            defer {
                observer.cancel()
                history.stop()
            }
            try await eventually { history.items.count == 1 && !history.loading }
            let reviewed = try await f.visits.repository.selectHistory(history.items)
            await f.offline()
            let earlier = Date(timeIntervalSince1970: 1_700_000_000)
            var completed = false
            f.passport.changeDate(try #require(reviewed.first), date: earlier) { completed = true }
            try await eventually { completed && !f.passport.working }
            try await eventually { history.items.first?.visit.happenedAt == earlier }
            let csv = try await f.visits.repository.exportCSV(parks: parks)
            defer { try? FileManager.default.removeItem(at: csv) }
            let text = try String(contentsOf: csv, encoding: .utf8)
            #expect(text.contains("2023-11-14") && text.components(separatedBy: "\r\n").count == 3)
            // The old confirmed selection cannot remove the newer pending date edit.
            await #expect(throws: NativeStore.Failure.unavailable) {
                try await f.visits.repository.remove([selected])
            }
            let changed = try await f.visits.repository.selectHistory(history.items)
            f.passport.remove(changed)
            try await eventually { !f.passport.working && history.items.isEmpty && !f.map.detail.isVisited }
            try await f.settle()
            #expect(try await f.visitCloud.history().items.isEmpty)
            #expect(try await f.store.nativeProgress()?.sites == 0)
            f.passport.recordActivity()
            await f.visits.sync?.wait()
            let daily = try await f.store.nativeProgress()
            #expect(daily?.streakCount == 1)
            f.passport.recordActivity()
            await f.visits.sync?.wait()
            #expect(try await f.store.nativeProgress()?.revision == daily?.revision)
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func connectedWalksKeepConfirmedTotalsSeparateAndPreserveCompletionAfterCorrections() async throws {
        try await withApp { f in
            let trail = try #require(f.expedition.trails.first { $0.id == "angels_landing" })
            await f.offline()
            f.expedition.assign(trail)
            try await eventually { f.expedition.expedition.trailID == trail.id && !f.expedition.busy }
            let run = try #require(f.expedition.expedition.runID)
            f.expedition.logManual(miles: 5)
            try await eventually { !f.expedition.busy && f.expedition.pendingCount == 2 }
            #expect(f.expedition.expedition.meters == 0 && f.expedition.expedition.lifetimeMeters == 0)
            let assignment = try #require(try await f.store.nextExpeditionSubmission())
            let assigned = try await f.walkCloud.submit(assignment.submission)
            try await f.store.acceptNativeExpeditionOutcome(
                assigned, snapshot: f.walkCloud.current(runID: run))
            let pending = try #require(try await f.store.nextExpeditionSubmission())
            let activityID = try #require(pending.operation.action.activityID)
            #expect(try await f.walkCloud.submit(pending.submission).status == .accepted)
            try await f.store.acceptNativeExpedition(f.walkCloud.current())
            try await eventually { f.expedition.expedition.lifetimeMeters == 5 * 1609.344 }
            #expect(f.expedition.pendingCount > 0)
            #expect(f.expedition.expedition.meters == 5 * 1609.344)  // Not ten after lost reply.
            try await f.settle()
            try await eventually { f.expedition.canClaim }
            f.expedition.claim()
            try await eventually { !f.expedition.busy }
            try await f.settle()
            try await eventually { f.expedition.completed.first?.runID == run }
            #expect(try await f.store.nativeProgress()?.walkPoints == 1)
            let historyTask = Task { await f.expedition.observeHistory() }
            defer {
                historyTask.cancel()
                f.expedition.history?.stop()
            }
            try await eventually { f.expedition.history?.items.count == 1 }
            let original = try #require(f.expedition.history?.items.first)
            #expect(original.id == activityID && original.summary.runID == run)
            await f.offline()
            #expect(
                await f.expedition.edit(
                    original, miles: 1, date: Date().addingTimeInterval(-1000), trailName: "My corrected walk"
                ))
            try await eventually { f.expedition.history?.items.first?.revision == 2 }
            let edited = try #require(f.expedition.history?.items.first)
            f.expedition.remove(edited)
            try await eventually { !f.expedition.busy && f.expedition.history?.items.isEmpty == true }
            try await f.settle()
            #expect(try await f.walkCloud.current().state?.lifetimeMiles == 0)
            #expect(try await f.store.nativeVirtualRun(id: run)?.miles == 5)
            #expect(try await f.store.nativeProgress()?.walkPoints == 1)
            try await f.walks.repository.commitWalk(
                WalkSummary(
                    id: original.id, source: original.summary.source,
                    startedAt: Date(timeIntervalSince1970: Double(original.summary.startedAtMs) / 1000),
                    endedAt: Date(timeIntervalSince1970: Double(original.summary.endedAtMs) / 1000),
                    meters: original.summary.meters, elapsedSeconds: original.summary.elapsedSeconds,
                    runID: run), trailName: original.trailName)
            try await f.settle()
            #expect(try await f.walkCloud.history().items.isEmpty)
            #expect(try await f.walks.repository.importedIDs([activityID]).contains(activityID))
            #expect(try await f.store.nativeProgress()?.walkPoints == 1)
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func settledHistoryConflictDoesNotBlockIndependentWalkAndRequiresFreshReview() async throws {
        try await withApp { f in
            f.expedition.logManual(miles: 5)
            try await eventually { !f.expedition.busy }
            try await f.settle()
            let record = try #require(try await f.walkCloud.history().items.first)
            let original = try #require(try NativeActivityDraft(record: record))
            await f.offline()
            #expect(
                await f.expedition.edit(
                    original, miles: 2, date: Date().addingTimeInterval(-10), trailName: "My choice"))
            #expect(
                try await f.send(
                    .edit(
                        activityID: original.id, revision: 1, meters: 3 * 1609.344,
                        happenedAtMs: original.happenedAtMs, trailName: "Other device")
                ).status == .accepted)
            f.expedition.logManual(miles: 1)
            try await eventually { !f.expedition.busy }
            f.session.connectivityChanged(true)
            try await eventually(timeout: .seconds(20)) {
                let count = try? await f.store.expeditionQueue().count
                return f.expedition.conflicts.count == 1 && count == 1
            }
            #expect(try await f.walkCloud.history().items.count == 2)
            let conflict = try #require(f.expedition.conflicts.first)
            let oldReview = try await f.walks.repository.reviewConflict(conflict)
            #expect(oldReview.entries.count == 1 && oldReview.replacements?.count == 1)
            #expect(
                try await f.send(
                    .edit(
                        activityID: original.id, revision: 2, meters: 4 * 1609.344,
                        happenedAtMs: original.happenedAtMs, trailName: "Newer remote")
                ).status == .accepted)
            try await f.store.acceptNativeExpedition(f.walkCloud.current(activityID: original.id))
            await #expect(throws: NativeStore.Failure.unavailable) {
                try await f.walks.repository.resolveConflict(oldReview, keepLocal: true)
            }
            let fresh = try await f.walks.repository.reviewConflict(conflict)
            f.expedition.resolve(fresh, keepLocal: true)
            try await eventually { !f.expedition.busy }
            try await f.settle()
            let resolved = try await f.walkCloud.current(activityID: original.id)
            #expect(resolved.activity?.details?.trailName == "My choice" && resolved.activity?.revision == 4)
            #expect(resolved.state?.lifetimeMiles == 3)
            #expect(try await f.store.expeditionQueue().isEmpty)
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func changedRunRetainsOriginalRecordingWithoutBlockingANewUnrelatedTrail() async throws {
        try await withApp { f in
            let trails = f.expedition.trails
            f.expedition.assign(trails[0])
            try await eventually { !f.expedition.busy }
            try await f.settle()
            let run = try #require(f.expedition.expedition.runID)
            let summary = WalkSummary(
                source: .gps, startedAt: Date().addingTimeInterval(-180),
                endedAt: Date().addingTimeInterval(-10), meters: 100, elapsedSeconds: 170, runID: run)
            await f.offline()
            let remoteRun = UUID().uuidString.lowercased()
            #expect(
                try await f.send(
                    .assign(
                        trailID: trails[1].id, runID: remoteRun,
                        selectionRevision: 1, expectedActiveRunID: run)
                ).status == .accepted)
            try await f.walks.repository.commitWalk(summary, trailName: trails[0].name)
            f.session.connectivityChanged(true)
            try await eventually(timeout: .seconds(15)) {
                f.expedition.conflicts.count == 1 && f.expedition.expedition.runID == remoteRun
            }
            let id = try #require(f.expedition.conflicts.first)
            let review = try await f.walks.repository.reviewConflict(id)
            #expect(review.replacements == nil)
            #expect(
                try await f.store.expeditionOperation(id).afterActivity()?.summary
                    == NativeActivitySummary(summary))
            #expect(f.expedition.canChooseTrail)
            f.expedition.assign(trails[2])
            try await eventually { !f.expedition.busy }
            try await eventually(timeout: .seconds(15)) { (try? await f.store.expeditionQueue().count) == 1 }
            #expect(try await f.walkCloud.current().runs.first?.trailID == trails[2].id)
            #expect(try await f.store.expeditionOperation(id).afterActivity()?.summary.runID == run)
            #expect(try await f.walkCloud.history().items.isEmpty)
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func remoteDateChangeRefreshesTheOpenHistoryInsteadOfLeavingAGhostDeletion() async throws {
        try await withApp { f in
            let parks = try #require(await f.context.catalog.current().snapshot?.parks)
            let park = try #require(parks.first { !$0.isRetired })
            try await f.visits.repository.mark(park: park)
            try await f.settle()
            let history = NativeVisitHistory(repository: f.visits.repository)
            let observer = Task { await history.observe() }
            defer { observer.cancel(); history.stop() }
            try await eventually { history.items.count == 1 && !history.loading && !history.hasMore }
            let selected = try await f.visits.repository.workingState(park: park)
            let before = try #require(selected.draft)
            var after = before
            after.happenedAtMs -= 86_400_000
            let operation = NativeVisitOperation.single(.init(intent: .init(target: selected.target(),
                edit: .changeDate(happenedAtMs: after.happenedAtMs, timeZone: after.timeZone)), before: before, after: after))
            let id = UUID()
            let bytes = try operation.commandBytes(id: id, createdAtMs: NativeClientTime.milliseconds(Date()))
            #expect(try await f.visitCloud.submit(.init(id: id, bytes: bytes, attempts: 0)).status == .accepted)
            // Do not point-read or manually reload the edited visit. The account's
            // marker refresh must repair the already-open screen by itself.
            f.visits.sync?.request(refresh: true)
            await f.visits.sync?.wait()
            try await eventually { history.items.first?.visit.happenedAtMs == after.happenedAtMs && !history.loading }
            #expect(history.items.count == 1 && history.items.first?.revision == 2)
        }
    }

    private func withApp(_ work: (NativeAdventureAppFixture) async throws -> Void) async throws {
        let f = try await NativeAdventureAppFixture.make()
        do {
            try await work(f)
            await f.close()
        } catch {
            await f.close()
            throw error
        }
    }
}
