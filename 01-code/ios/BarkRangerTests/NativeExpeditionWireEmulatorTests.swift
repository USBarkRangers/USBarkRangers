import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeExpeditionWireEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func typedCommandsAndActualSDKPreserveNativeActivityAndRunContracts() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let user = try await auth.createUser(
            withEmail: "\(UUID().uuidString)@native.invalid", password: UUID().uuidString
        ).user
        let profile = try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: user.uid)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: user.uid)
        let profileSync = NativeProfileSync(store: store, cloud: profile)
        #expect(try await profileSync.synchronize() == .current)
        try await NativeEmulatorFixture.seedAccess(uid: user.uid, app: app)
        #expect(try await profileSync.synchronize() == .current)
        let transport = try NativeCallableTransport(uid: user.uid, auth: auth)
        let cloud = NativeExpeditionCloud(transport: transport)
        func submission(_ action: NativeExpeditionAction) throws -> NativeStore.Submission {
            let id = UUID()
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let command = NativeExpeditionCommand(
                id: id, createdAtMs: Int64(Date().timeIntervalSince1970 * 1000), action: action)
            return .init(id: id, bytes: try encoder.encode(command), attempts: 0)
        }
        #expect(try await cloud.current().state == nil)
        let runID = UUID().uuidString.lowercased()
        let assign = try submission(
            .assign(trailID: "angels_landing", runID: runID, selectionRevision: 0, expectedActiveRunID: nil))
        #expect(try await cloud.submit(assign).status == .accepted)
        let assigned = try await cloud.current(runID: runID)
        #expect(assigned.state?.activeRunID == runID && assigned.state?.selectionRevision == 1)
        #expect(assigned.runs.first?.trailRevision == 1 && assigned.runs.first?.status == .active)
        try await store.acceptNativeExpedition(assigned)
        #expect(try await store.nativeVirtualRun(id: runID) == assigned.runs.first)
        let now = Date()
        let summary = try NativeActivitySummary(
            WalkSummary(
                source: .manual, startedAt: now, endedAt: now,
                meters: 5 * 1609.344, elapsedSeconds: 0, runID: runID))
        let record = try submission(.record(summary))
        let saved = try await cloud.submit(record)
        #expect(
            saved.status == .accepted && saved.revisions.activity == 1 && saved.revisions.activityClaim == 1)
        #expect(try await cloud.submit(record) == saved)
        let recorded = try await cloud.current(activityID: summary.activityID)
        #expect(recorded.activity?.details?.source == .manual && recorded.activityClaimed)
        #expect(recorded.runs.first?.miles == 5 && recorded.progress?.walkPoints == 0)
        #expect(recorded.state?.lifetimeMiles == 5 && recorded.state?.selectionRevision == 1)
        try await store.acceptNativeExpedition(recorded)
        let firstHistory = try await cloud.history()
        #expect(try await store.acceptNativeActivityHistory(firstHistory, after: nil, bootstrap: true))
        #expect(try await store.nativeActivity(id: summary.activityID) == recorded.activity)
        let claimed = try await cloud.submit(submission(.claim(runID: runID, revision: 2)))
        #expect(claimed.status == .accepted)
        let completed = try await cloud.current(activityID: summary.activityID, runID: runID)
        #expect(completed.runs.first?.status == .completed && completed.runs.first?.completionPoints == 1)
        #expect(completed.state?.activeRunID == nil && completed.progress?.walkPoints == 1)
        try await store.acceptNativeExpedition(completed)
        let completionList = try await cloud.completedTrails()
        try await store.acceptNativeCompletedTrails(completionList)
        #expect(try await store.nativeCompletedTrails() == completionList.items)
        #expect(try await cloud.completedTrails().items.first?.runID == runID)
        #expect(try await cloud.history().items.first?.id == summary.activityID)
        let edited = try await cloud.submit(
            submission(
                .edit(
                    activityID: summary.activityID, revision: 1,
                    meters: 1609.344, happenedAtMs: summary.endedAtMs - 1000, trailName: "My walk")))
        #expect(edited.status == .accepted)
        let corrected = try await cloud.current(activityID: summary.activityID)
        #expect(corrected.activity?.details?.trailName == "My walk")
        #expect(corrected.state?.lifetimeMiles == 1 && corrected.progress?.walkPoints == 1)
        #expect(corrected.runs.first?.miles == 5)  // Completed run evidence remains frozen.
        try await store.acceptNativeExpedition(corrected)
        #expect(try await store.acceptNativeActivityHistory(firstHistory, after: nil) == false)
        #expect(
            try await cloud.submit(submission(.remove(activityID: summary.activityID, revision: 2))).status
                == .accepted)
        let removed = try await cloud.current(activityID: summary.activityID)
        #expect(removed.activity?.deleted == true && removed.activityClaimed)
        #expect(removed.activity?.details == nil && removed.state?.lifetimeMiles == 0)
        try await store.acceptNativeExpedition(removed)
        try await store.acceptNativeExpedition(recorded)  // Delayed pre-deletion point read.
        #expect(try await store.nativeActivity(id: summary.activityID)?.deleted == true)
        #expect(try await store.nativeActivityHistory().isEmpty)
        #expect(try await cloud.history().items.isEmpty)
        let identities = try await cloud.claimedActivities([
            summary.activityID, UUID().uuidString.lowercased(),
        ])
        #expect(identities.claimedIDs == [summary.activityID])
        try await store.acceptNativeActivityClaims(identities, requested: identities.activityIDs)
        #expect(try await store.knownNativeActivityIDs(Set(identities.activityIDs)) == [summary.activityID])
        // A reconstructed local recording file uses the stable activity identity even
        // if the short-lived transport receipt is unavailable. It cannot add points twice.
        #expect(try await cloud.submit(submission(.record(summary))).revisions.activity == 3)
        #expect(try await cloud.current().state?.lifetimeMiles == 0)
        let maximum = try NativeActivitySummary(
            WalkSummary(
                source: .gps,
                startedAt: now.addingTimeInterval(-86_400), endedAt: now, meters: 500_000,
                elapsedSeconds: 86_400))
        #expect(try await cloud.submit(submission(.record(maximum))).status == .accepted)
        let maximumRecord = try await cloud.current(activityID: maximum.activityID)
        #expect(maximumRecord.activity?.details?.originalMeters == 500_000)
        #expect(maximumRecord.activity?.details?.miles == (500_000 / 1609.344 * 100).rounded() / 100)
        let roundTrip = try JSONDecoder().decode(
            NativeActivityRecord.self,
            from: JSONEncoder().encode(#require(maximumRecord.activity)))
        #expect(roundTrip == maximumRecord.activity)
        let cursor = try #require(try await store.activityChangesQuery())
        let changes = try await cloud.changes(cursor)
        #expect(try await store.acceptNativeActivityChanges(changes, requested: cursor))
        #expect(try await store.nativeActivity(id: maximum.activityID) == maximumRecord.activity)
        #expect(try await store.nativeActivity(id: summary.activityID)?.deleted == true)
        #expect(try await store.acceptNativeActivityChanges(changes, requested: cursor) == false)
        try auth.signOut()
        await #expect(throws: NativeCallableTransport.Failure.accountChanged) { try await cloud.current() }
        await transport.close()
        await profileSync.stop()
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: user.uid)
        #expect(try await reopened.nativeExpeditionState()?.activeRunID == nil)
        #expect(try await reopened.nativeCompletedTrails().first?.runID == runID)
        #expect(try await reopened.nativeActivity(id: summary.activityID)?.deleted == true)
        #expect(try await reopened.nativeActivity(id: maximum.activityID) == maximumRecord.activity)
        await reopened.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }
}
