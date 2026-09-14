import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

struct NativeExpeditionRecoveryTests {
    @Test func unknownSelectionIsNotAnEmptySelectionAndConfirmedAbsenceSurvivesReopen() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "absence")
        let unknown = try await store.nativeExpeditionOverview()
        #expect(!unknown.hasConfirmedSelection && unknown.runID == nil)
        let trail = try #require(Trail.bundled().first)
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.assignNativeTrail(trail, matching: unknown)
        }
        try await store.acceptNativeExpedition(emptySnapshot())
        #expect(try await store.nativeExpeditionOverview().hasConfirmedSelection)
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "absence")
        let confirmed = try await reopened.nativeExpeditionOverview()
        #expect(confirmed.hasConfirmedSelection && confirmed.state == nil && confirmed.runID == nil)
        await reopened.close()
    }

    @Test func reviewedChainResolutionIsAtomicAndDoesNotConsumeAnIndependentWalk() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let failSave = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "recovery",
            beforeSave: { if failSave.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        let snapshot = try emptySnapshot()
        try await store.acceptNativeExpedition(snapshot)
        func record(_ name: String) throws -> NativeExpeditionOperation {
            let now = Date()
            return .init(
                action: .record(
                    try NativeActivitySummary(
                        WalkSummary(
                            source: .manual,
                            startedAt: now, endedAt: now, meters: 2 * 1609.344, elapsedSeconds: 0))),
                recordedTrailName: name)
        }
        let first = try record("Reviewed walk")
        let root = try await store.stageNativeExpeditionOperation(first)
        let unrelated = try await store.stageNativeExpeditionOperation(record("Independent walk"))
        let before = try #require(try first.afterActivity())
        let edit = NativeExpeditionOperation(
            action: .edit(
                activityID: before.id, revision: before.revision,
                meters: 1609.344, happenedAtMs: before.happenedAtMs, trailName: "Reviewed correction"),
            beforeActivity: before)
        let editID = try await store.stageNativeExpeditionOperation(edit)
        #expect(try await store.nextExpeditionSubmission()?.submission.id == root)
        try await store.rejectExpeditionOperation(root, code: "premium-required")
        let entries = try await store.expeditionConflictEntries(root)
        #expect(entries.map(\.id) == [root, editID])
        let plan = try NativeExpeditionRecovery.rebase(
            entries.map(\.operation), onto: snapshot, failure: "premium-required")
        let review = NativeStore.ExpeditionConflictReview(
            entries: entries, remote: snapshot, replacements: plan)
        let forged = NativeStore.ExpeditionConflictReview(
            entries: entries, remote: snapshot, replacements: [])
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.resolveExpeditionConflict(forged, keepLocal: true)
        }
        let original = try await store.expeditionQueue()
        failSave.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.resolveExpeditionConflict(review, keepLocal: true)
        }
        failSave.withLock { $0 = false }
        #expect(try await store.expeditionQueue() == original)
        #expect(try await store.expeditionConflictEntries(root) == entries)
        try await store.resolveExpeditionConflict(review, keepLocal: true)
        let replaced = try await store.expeditionQueue()
        #expect(replaced.count == 3 && replaced[1].id == unrelated)
        #expect(!replaced.map(\.id).contains(root) && !replaced.map(\.id).contains(editID))
        #expect(try await store.expeditionOperation(replaced[0].id) == first)
        #expect(try await store.expeditionOperation(replaced[2].id) == edit)
        #expect(try await store.nativeActivityDraft(id: before.id)?.summary == before.summary)
        await store.close()
    }

    private func emptySnapshot() throws -> NativeExpeditionSnapshot {
        try JSONDecoder().decode(
            NativeExpeditionSnapshot.self,
            from: JSONSerialization.data(withJSONObject: [
                "version": 1, "activityID": NSNull(), "runID": NSNull(), "state": NSNull(),
                "progress": NSNull(),
                "activity": NSNull(), "activityClaimed": false, "runs": [],
                "readTime": ["seconds": Int64(Date().timeIntervalSince1970), "nanoseconds": 0],
            ]))
    }
}
