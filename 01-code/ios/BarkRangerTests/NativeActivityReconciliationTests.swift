import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeActivityReconciliationTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func newerPointReadCannotSkipAnotherActivitysUpdateOrDeletion() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let user = try await auth.createUser(
            withEmail: "\(UUID().uuidString)@native.invalid", password: UUID().uuidString).user
        let profile = try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: user.uid)
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: user.uid)
        let profileSync = NativeProfileSync(store: store, cloud: profile)
        _ = try await profileSync.synchronize()
        try await NativeEmulatorFixture.seedAccess(uid: user.uid, app: app)
        _ = try await profileSync.synchronize()
        let transport = try NativeCallableTransport(uid: user.uid, auth: auth)
        let cloud = NativeExpeditionCloud(transport: transport)
        func send(_ action: NativeExpeditionAction) async throws {
            let id = UUID()
            let command = NativeExpeditionCommand(id: id,
                createdAtMs: Int64(Date().timeIntervalSince1970 * 1000), action: action)
            let result = try await cloud.submit(.init(id: id, bytes: JSONEncoder().encode(command), attempts: 0))
            #expect(result.status == .accepted)
        }
        let now = Date()
        let summaries = try (0..<3).map { _ in
            try NativeActivitySummary(WalkSummary(source: .manual, startedAt: now, endedAt: now,
                meters: 1609.344, elapsedSeconds: 0))
        }
        for value in summaries { try await send(.record(value)) }
        let initial = try await cloud.history()
        #expect(try await store.acceptNativeActivityHistory(initial, after: nil, bootstrap: true))
        let start = try #require(try await store.activityChangesQuery())
        try await send(.edit(activityID: summaries[1].activityID, revision: 1,
            meters: 2 * 1609.344, happenedAtMs: summaries[1].endedAtMs, trailName: "Updated B"))
        try await send(.remove(activityID: summaries[2].activityID, revision: 1))
        let delayed = try await cloud.changes(start)
        try await send(.edit(activityID: summaries[0].activityID, revision: 1,
            meters: 3 * 1609.344, happenedAtMs: summaries[0].endedAtMs, trailName: "Newer A"))
        try await store.acceptNativeExpedition(cloud.current(activityID: summaries[0].activityID))
        #expect(try await store.acceptNativeActivityChanges(delayed, requested: start) == false)
        let restarted = try #require(try await store.activityChangesQuery())
        #expect(restarted.since == start.since && restarted.upper == nil && restarted.after == nil)
        // Reopen between restart and refetch: the completed lower bound is durable.
        await store.close()
        let reopened = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: user.uid)
        #expect(try await reopened.activityChangesQuery() == restarted)
        let fresh = try await cloud.changes(restarted)
        #expect(try await reopened.acceptNativeActivityChanges(fresh, requested: restarted))
        #expect(try await reopened.nativeActivity(id: summaries[0].activityID)?.details?.trailName == "Newer A")
        #expect(try await reopened.nativeActivity(id: summaries[1].activityID)?.details?.trailName == "Updated B")
        #expect(try await reopened.nativeActivity(id: summaries[2].activityID)?.deleted == true)
        #expect(try await reopened.acceptNativeActivityHistory(initial, after: nil) == false)
        let d = try NativeActivitySummary(WalkSummary(source: .manual, startedAt: now, endedAt: now,
            meters: 1609.344, elapsedSeconds: 0))
        let dID = try await reopened.stageNativeExpeditionOperation(.init(action: .record(d), recordedTrailName: "D"))
        let dCommand = try #require(try await reopened.nextExpeditionSubmission())
        let dOutcome = try await cloud.submit(dCommand.submission)
        let delayedD = try await cloud.current(activityID: d.activityID)
        try await send(.edit(activityID: summaries[0].activityID, revision: 2,
            meters: 4 * 1609.344, happenedAtMs: summaries[0].endedAtMs, trailName: "A overtakes D reply"))
        try await reopened.acceptNativeExpedition(cloud.current(activityID: summaries[0].activityID))
        await #expect(throws: NativeStore.Failure.staleRead) {
            try await reopened.acceptNativeExpeditionOutcome(dOutcome, snapshot: delayedD)
        }
        #expect(try await reopened.expeditionQueue().map(\.id) == [dID])
        let worker = NativeExpeditionSync(store: reopened, cloud: cloud)
        #expect(try await worker.synchronize().pendingCount == 0)
        #expect(try await reopened.nativeActivity(id: d.activityID)?.revision == 1)
        await worker.stop()
        await reopened.close()
        await transport.close()
        await profileSync.stop()
        try auth.signOut()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }
}
