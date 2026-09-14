import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct SyncEngineTests {
    @Test func failedObservationBacksOffAndNeverChangesSavedData() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: folder, uid: "retry")
        let cloud = ControlledUserCloud()
        await cloud.failReads(with: URLError(.networkConnectionLost))
        let engine = SyncEngine(store: store, cloud: cloud, uid: "retry")
        for expected in [5, 10, 20, 40, 80, 160, 300, 300] {
            #expect(await engine.flush() == false)
            #expect(await engine.nextDelay() == .seconds(expected))
        }
        #expect(try await store.readSnapshot().baseline.confirmedAt == nil)
        await engine.stop()
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }
    @Test func idleFlushesReuseOneObservationAndLiveChangesNeedNoRefresh() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: folder, uid: "idle")
        let cloud = ControlledUserCloud()
        let engine = SyncEngine(store: store, cloud: cloud, uid: "idle")
        for _ in 0..<12 { #expect(await engine.flush()) }
        #expect(await cloud.observationStarts == 1)
        #expect(await cloud.reads == 1)
        #expect(await cloud.reconciliations == 0)
        #expect(await cloud.submissions.isEmpty)
        #expect(await engine.nextDelay() == nil)
        await cloud.setServerName("Other device", uid: "idle")
        try await eventually {
            (try? await store.readSnapshot().baseline.profile.displayName) == "Other device"
        }
        #expect(await cloud.reads == 1)
        #expect(await engine.flush(refresh: true))
        #expect(await cloud.observationStarts == 2)
        #expect(await cloud.reads == 2)
        await engine.pause()
        await cloud.setServerName("After cancellation", uid: "idle")
        #expect(try await store.readSnapshot().baseline.profile.displayName == "Other device")
        #expect(await engine.flush())
        #expect(try await store.readSnapshot().baseline.profile.displayName == "After cancellation")
        await engine.stop()
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }
    @Test func readOnlySyncPreservesPendingWritesWithoutSubmittingOrRetryingThem() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: folder, uid: "a")
        try await store.seedPremium()
        try await store.commit(kind: .profile, value: .string("Keep pending"))
        let before = try await store.readSnapshot().pending
        try await store.seedPremium()
        let cloud = ControlledUserCloud()
        let engine = SyncEngine(store: store, cloud: cloud, uid: "a", allowsMutations: false)
        #expect(await engine.flush())
        #expect(await cloud.submissions.isEmpty)
        #expect(await cloud.reads == 1)
        #expect(try await store.readSnapshot().pending == before)
        #expect(await engine.nextDelay() == nil)
        await engine.stop()
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }

    @Test func lostResponseKeepsDurableIntentAndRetryUsesTheSameOperation() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        try await store.seedPremium()
        let cloud = ControlledUserCloud()
        await cloud.loseResponse()
        let engine = SyncEngine(store: store, cloud: cloud, uid: "a")
        try await store.commit(kind: .profile, value: .string("Pending"))
        #expect(await engine.flush() == false)
        let pending = try #require(try await store.readSnapshot().pending.first)
        #expect(pending.attempts == 1)
        try await store.recordRetry(id: pending.id, now: Date().addingTimeInterval(-1000))
        #expect(await engine.flush())
        let submissions = await cloud.submissions
        #expect(submissions.count == 2)
        #expect(submissions.first == submissions.last)
        #expect(try await store.readSnapshot().pending.isEmpty)
        #expect(try await store.readSnapshot().visible.profile.displayName == "Pending")
        await engine.stop()
        await store.close()
    }
    @Test func retryOfAcceptedIntentDoesNotHideLaterWebEdit() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        try await store.seedPremium()
        let cloud = ControlledUserCloud()
        await cloud.loseResponse()
        let engine = SyncEngine(store: store, cloud: cloud, uid: "a")
        try await store.commit(kind: .profile, value: .string("Old accepted name"))
        #expect(await engine.flush() == false)
        let item = try #require(try await store.readSnapshot().pending.first)
        await cloud.setServerName("Newer web name", uid: "a")
        try await store.recordRetry(id: item.id, now: Date().addingTimeInterval(-1000))
        #expect(await engine.flush())
        #expect(try await store.readSnapshot().pending.isEmpty)
        #expect(try await store.readSnapshot().visible.profile.displayName == "Newer web name")
        await engine.stop()
        await store.close()
    }
    @Test func permanentRejectionRetainsVisibleIntentWithoutAutomaticResubmission() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        try await store.seedPremium()
        let cloud = ControlledUserCloud()
        await cloud.rejectChanges()
        let engine = SyncEngine(store: store, cloud: cloud, uid: "a")
        try await store.commit(kind: .profile, value: .string("Keep my text"))
        _ = await engine.flush()
        _ = await engine.flush()
        let state = try await store.readSnapshot()
        #expect(state.visible.profile.displayName == "Keep my text")
        #expect(state.pending.first?.receipt?.outcome == .rejected)
        #expect(await cloud.submissions.count == 1)
        await engine.stop()
        await store.close()
    }
    @Test func closedEngineCannotSubmitPendingIntent() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        try await store.seedPremium()
        let cloud = ControlledUserCloud()
        let engine = SyncEngine(store: store, cloud: cloud, uid: "a")
        try await store.commit(kind: .profile, value: .string("Offline"))
        await engine.stop()
        #expect(await engine.flush() == false)
        #expect(await cloud.submissions.isEmpty)
        #expect(try await store.readSnapshot().pending.count == 1)
        await store.close()
    }
}
