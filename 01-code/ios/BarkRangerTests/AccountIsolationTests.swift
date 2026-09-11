import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AccountIsolationTests {
    @Test func accountSwitchClearsPresentationBeforeDelayedReadAndPendingAStaysInA() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let auth = SyntheticAuth()
        let cloud = ControlledUserCloud()
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder)
        session.setForeground(true)
        auth.select("a")
        try await eventually { session.profile != nil }
        await cloud.hold("a")
        session.connectivityChanged(true)
        try await eventually { await cloud.isWaiting() }
        try await session.profile?.editDisplayName("Pending A")
        try await eventually { session.state?.pending.count == 1 }
        auth.select("b")
        try await eventually { session.identity?.uid == "b" }
        #expect(session.state == nil)
        #expect(session.profile == nil)
        #expect(session.entitlement.access == nil)
        await cloud.release()
        try await eventually { session.state?.baseline.uid == "b" }
        #expect(session.state?.pending.isEmpty == true)
        #expect(await cloud.submissions.isEmpty)
        session.connectivityChanged(false)
        auth.select("a")
        try await eventually { session.state?.baseline.uid == "a" }
        #expect(session.state?.visible.profile.displayName == "Pending A")
        #expect(session.state?.pending.count == 1)
        await session.stopAndWait()
    }
    @Test func editArrivingDuringReadTriggersAnotherPassWithoutLosingIntent() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let auth = SyntheticAuth()
        let cloud = ControlledUserCloud()
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder)
        await cloud.hold("a")
        session.setForeground(true)
        session.connectivityChanged(true)
        auth.select("a")
        try await eventually { await cloud.isWaiting() }
        try await session.profile?.editDisplayName("During read")
        try await eventually { session.state?.pending.count == 1 }
        await cloud.release()
        await session.waitForSync()
        try await eventually { session.state?.pending.isEmpty == true }
        #expect(session.state?.visible.profile.displayName == "During read")
        #expect(await cloud.submissions.count == 1)
        await session.stopAndWait()
    }
    @Test func failedSignOutRetainsScopeAndSuccessfulSignOutClosesIt() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let auth = SyntheticAuth()
        let session = AccountSession(auth: auth, cloud: nil, directory: folder)
        session.setForeground(true)
        auth.select("a")
        try await eventually { session.state != nil }
        auth.signOutFails = true
        #expect(throws: (any Error).self) { try auth.signOut() }
        #expect(session.identity?.uid == "a")
        auth.signOutFails = false
        try auth.signOut()
        try await eventually { session.identity == nil }
        #expect(session.state == nil)
        await session.stopAndWait()
    }
    @Test func backgroundCancellationPreventsDelayedReadFromApplying() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let auth = SyntheticAuth()
        let cloud = ControlledUserCloud()
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder)
        await cloud.hold("a")
        session.setForeground(true)
        session.connectivityChanged(true)
        auth.select("a")
        try await eventually { await cloud.isWaiting() }
        session.setForeground(false)
        await cloud.release()
        await session.waitForSync()
        #expect(session.state?.baseline.confirmedAt == nil)
        #expect(!session.isSyncing)
        await session.stopAndWait()
    }
}
