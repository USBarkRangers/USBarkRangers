import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AccountIsolationTests {
    @Test func terminatedObservationRecoversAutomaticallyAndCannotCrossAccounts() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let auth = SyntheticAuth()
        let cloud = ControlledUserCloud()
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder)
        session.setForeground(true)
        session.connectivityChanged(true)
        auth.select("a")
        try await eventually { session.state?.baseline.confirmedAt != nil }
        await session.waitForSync()
        await cloud.endObservation(uid: "a")
        try await eventually { session.message != nil }
        await cloud.setServerName("After reconnect", uid: "a")
        try await eventually(timeout: .seconds(10)) {
            session.state?.baseline.profile.displayName == "After reconnect" && session.message == nil
        }
        #expect(await cloud.observationStarts == 2)
        auth.select("b")
        try await eventually { session.state?.baseline.uid == "b" }
        await cloud.setServerName("Late old account update", uid: "a")
        await session.waitForSync()
        #expect(session.state?.baseline.uid == "b")
        #expect(session.state?.baseline.profile.displayName == "b")
        await session.stopAndWait()
        try FileManager.default.removeItem(at: folder)
    }
    @Test func repeatedLifecycleAndConfirmedAuthEventsDoNotRestartObservation() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let auth = SyntheticAuth()
        let cloud = ControlledUserCloud()
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder)
        session.setForeground(true)
        session.connectivityChanged(true)
        auth.select("same")
        try await eventually { session.state?.baseline.confirmedAt != nil }
        for _ in 0..<10 {
            session.setForeground(true)
            session.connectivityChanged(true)
            auth.select("same")
            session.requestSync()
        }
        await session.waitForSync()
        #expect(await cloud.observationStarts == 1)
        #expect(await cloud.reads == 1)
        session.setForeground(false)
        session.setForeground(true)
        await session.waitForSync()
        #expect(await cloud.observationStarts == 2)
        await session.stopAndWait()
        try FileManager.default.removeItem(at: folder)
    }
    @Test func livePreviewReadsAccountWithoutExposingEditsOrQueuingChanges() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let auth = SyntheticAuth()
        let cloud = ControlledUserCloud()
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder, capabilities: .init())
        let model = AccountModel(session: session)
        session.setForeground(true)
        session.connectivityChanged(true)
        auth.select("preview")
        try await eventually { session.state?.baseline.confirmedAt != nil }
        #expect(session.state?.visible.profile.displayName == "preview")
        #expect(!model.capabilities.profileWrites)
        #expect(!model.capabilities.appleSignIn)
        #expect(session.profile == nil)
        model.saveName("Must not be saved")
        model.email("other", password: "example", create: true)
        await session.waitForSync()
        #expect(session.identity?.uid == "preview")
        #expect(session.state?.pending.isEmpty == true)
        #expect(await cloud.submissions.isEmpty)
        let preferences = SettingsRepository(defaults: nil, account: session)
        try await preferences.setMapStyle(.satellite)
        #expect(preferences.value.mapStyle == .satellite)
        #expect(session.state?.pending.isEmpty == true)
        try auth.signOut()
        try await eventually { session.identity == nil }
        await session.stopAndWait()
        try FileManager.default.removeItem(at: folder)
    }
    @Test func accountSwitchClearsPresentationBeforeDelayedReadAndPendingAStaysInA() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let auth = SyntheticAuth()
        let cloud = ControlledUserCloud()
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder, capabilities: .editableTest)
        session.setForeground(true)
        auth.select("a")
        try await eventually { session.profile != nil }
        try await session.trips?.store.seedPremium()
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
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder, capabilities: .editableTest)
        await cloud.hold("a")
        session.setForeground(true)
        session.connectivityChanged(true)
        auth.select("a")
        try await eventually { await cloud.isWaiting() }
        try await session.trips?.store.seedPremium()
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
        try await eventually { session.identity == nil && session.nativeTrips != nil }
        #expect(session.profile == nil && session.visits == nil && session.trips == nil)
        #expect(session.entitlement.access == nil && session.state == nil)
        #expect(try await session.nativeTrips?.repository.store.pendingTripIDs().isEmpty == true)
        await session.stopAndWait()
    }
    @Test func backgroundCancellationPreventsDelayedReadFromApplying() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let auth = SyntheticAuth()
        let cloud = ControlledUserCloud()
        let session = AccountSession(auth: auth, cloud: cloud, directory: folder, capabilities: .editableTest)
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
