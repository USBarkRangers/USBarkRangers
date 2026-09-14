import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct WalkRecorderTests {
    @Test func failedNativeHandoffRetainsOriginalRecordingUntilDurableRetry() async throws {
        let h = try await RecordingHarness.make()
        try await h.walk()
        let original = try #require(h.recorder.recording)
        await h.store.failRecordingHandoff(true)
        await h.recorder.finish()
        #expect(h.recorder.error != nil)
        #expect(try await h.store.expeditionQueue().isEmpty)
        let retained = try #require(try await h.files.recover(uid: "walker-a"))
        #expect(
            retained.id == original.id && retained.meters == original.meters && retained.phase == .finishing)
        await h.store.failRecordingHandoff(false)
        await h.recorder.finish()
        #expect(h.recorder.recording == nil)
        #expect(try await h.files.recover(uid: "walker-a") == nil)
        let entry = try #require(try await h.store.expeditionQueue().first)
        let saved = try await h.store.expeditionOperation(entry.id)
        #expect(saved.action.activityID == original.id && saved.selectedRunID == original.runID)
        #expect(try saved.afterActivity()?.summary.meters == original.meters)
        await h.close()
    }
    @Test func finishStagesOneDurableSummaryBeforeCleanupAndSurvivesLostCleanup() async throws {
        let h = try await RecordingHarness.make()
        try await h.walk()
        let id = try #require(h.recorder.recording?.id)
        h.gate.failOnWrite(3)  // Two checkpoint boundaries, then retirement of the recovery file.
        await h.recorder.finish()
        #expect(h.recorder.error != nil)
        #expect(try await h.files.recover(uid: "walker-a")?.phase == .finishing)
        let entry = try #require(try await h.store.expeditionQueue().first)
        let saved = try await h.store.expeditionOperation(entry.id)
        #expect(saved.action.activityID == id)
        let submission = try #require(try await h.store.nextExpeditionSubmission())
        let command = try #require(
            JSONSerialization.jsonObject(with: submission.submission.bytes) as? [String: Any])
        #expect((command["payload"] as? [String: Any])?.count == 7)
        h.clock.advance(60)
        await h.recorder.finish()
        #expect(h.recorder.recording == nil)
        #expect(try await h.files.recover(uid: "walker-a") == nil)
        #expect(try await h.store.expeditionQueue().count == 1)
        #expect(try await h.store.expeditionOperation(entry.id) == saved)
        await h.close()
        let reopened = try await NativeStore.open(
            directory: h.folder, project: "demo-bark-native", uid: "walker-a")
        #expect(try await reopened.expeditionOperation(entry.id) == saved)
        await reopened.close()
    }
    @Test func checkpointFailurePausesWithoutPretendingSavedAndRetryKeepsDistance() async throws {
        let h = try await RecordingHarness.make()
        await h.recorder.start(source: .gps)
        try await h.point(41)
        h.gate.failOnWrite(2)  // Bytes appended, checkpoint atomic replacement fails.
        h.clock.advance(100)
        try await h.point(41.001)
        #expect(h.recorder.recording?.phase == .paused)
        #expect(h.recorder.error != nil)
        #expect(try await h.store.expeditionQueue().isEmpty)
        await h.recorder.finish()
        #expect(h.recorder.recording == nil)
        let entry = try #require(try await h.store.expeditionQueue().first)
        let meters = try await h.store.expeditionOperation(entry.id).afterActivity()?.summary.meters ?? 0
        #expect(meters > 110 && meters < 112)
        await h.close()
    }
    @Test func accountSwitchCannotCreditOrExposePreviousWalk() async throws {
        let h = try await RecordingHarness.make()
        try await h.walk()
        let id = h.recorder.recording?.id
        h.auth.select("walker-b")
        try await eventually { h.account.nativeExpeditions?.scope.hasSuffix(":walker-b") == true }
        await h.recorder.activateAccount()
        #expect(h.recorder.recording == nil && h.recorder.points.isEmpty)
        #expect(try await h.files.recover(uid: "walker-a")?.id == id)
        #expect(try await h.account.nativeExpeditions?.repository.store.expeditionQueue().isEmpty == true)
        h.auth.select("walker-a")
        try await eventually { h.account.nativeExpeditions?.scope.hasSuffix(":walker-a") == true }
        await h.recorder.activateAccount()
        #expect(h.recorder.recording?.id == id)
        #expect(h.recorder.recording?.phase == .recovered)
        #expect(h.recorder.recording?.distance.anchor == nil)
        await h.close()
    }
    @Test func deniedPermissionPausesAndDisabledActivityDoesNotStopRecording() async throws {
        let h = try await RecordingHarness.make()
        h.activity.disabled = true
        try await h.walk()
        #expect(h.activity.starts == 0)
        #expect(h.recorder.recording?.phase == .recording)
        h.location.output?.finish(throwing: LocationClient.Failure.denied)
        try await eventually { h.recorder.recording?.phase == .paused }
        #expect(h.recorder.error != nil)
        #expect(try await h.files.recover(uid: "walker-a") != nil)
        await h.close()
    }
    @Test func pauseResumeReanchorsAndElapsedUsesUptimeInsteadOfWallClock() async throws {
        let h = try await RecordingHarness.make()
        try await h.walk()
        await h.recorder.pause()
        let meters = h.recorder.recording?.meters
        let elapsed = h.recorder.recording?.elapsedSeconds
        h.clock.advance(500)
        await h.recorder.resume()
        try await h.point(42)
        #expect(h.recorder.recording?.meters == meters)
        h.clock.uptime += 20
        await h.recorder.pause()
        #expect(h.recorder.recording?.elapsedSeconds == (elapsed ?? 0) + 20)
        await h.close()
    }
    @Test func tooShortFinishPersistsPausedRecoveryAndEndsActivity() async throws {
        let h = try await RecordingHarness.make()
        await h.recorder.start(source: .gps)
        await h.recorder.finish()
        #expect(h.recorder.recording?.phase == .paused)
        #expect(try await h.files.recover(uid: "walker-a")?.phase == .paused)
        #expect(try await h.store.expeditionQueue().isEmpty)
        #expect(h.recorder.error != nil)
        await h.close()
    }
    @Test func doubleStartAndDoubleFinishHaveOneSourceAndOneMutation() async throws {
        let h = try await RecordingHarness.make()
        await h.recorder.start(source: .gps)
        await h.recorder.start(source: .pedometer)
        #expect(h.location.starts == 1 && h.motion.starts == 0)
        try await h.point(41)
        h.clock.advance(100)
        try await h.point(41.001)
        async let first: Void = h.recorder.finish()
        async let second: Void = h.recorder.finish()
        _ = await (first, second)
        #expect(try await h.store.expeditionQueue().count == 1)
        await h.close()
    }
}

extension NativeStore {
    fileprivate func failRecordingHandoff(_ fail: Bool) {
        if fail { beforeSave = { throw CocoaError(.fileWriteOutOfSpace) } }
        else { beforeSave = nil }
    }
}
