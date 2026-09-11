import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct SyncEngineTests {
    @Test func lostResponseKeepsDurableIntentAndRetryUsesTheSameOperation() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
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
