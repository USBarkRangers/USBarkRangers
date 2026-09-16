import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AccountIsolationTests {
    @Test func accountSwitchClearsPresentationAndPendingAStaysInA() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let a = try #require(f.session.nativeProfile)
        try await a.saveName("Pending A")
        try await eventually { f.session.profileState?.pendingCount == 1 }
        let ids = try #require(f.session.profileState?.pendingIDs)
        f.auth.select("b")
        try await eventually {
            f.session.identity?.uid == "b" && f.session.nativeProfile?.uid == "b"
                && f.session.profileState != nil
        }
        #expect(f.session.profileState?.visible?.displayName != "Pending A")
        #expect(f.session.profileState?.pendingCount == 0)
        #expect(f.session.entitlement.access?.premium != true)
        await #expect(throws: (any Error).self) { try await a.saveName("Late old edit") }
        f.auth.select("a")
        try await eventually {
            f.session.nativeProfile?.uid == "a" && f.session.profileState?.pendingCount == 1
        }
        #expect(f.session.profileState?.visible?.displayName == "Pending A")
        #expect(f.session.profileState?.pendingIDs == ids)
        try await f.close()
    }

    @Test func repeatedLifecycleAndConfirmedAuthEventsDoNotReplaceTheOfflineWriter() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = try #require(f.session.nativeProfile?.store)
        try await store.saveProfileEdit(.displayName("Durable"))
        let ids = try await store.profileView().pendingIDs
        for _ in 0..<10 {
            f.session.setForeground(true)
            f.auth.select("a")
            f.session.requestSync()
        }
        await f.session.waitForSync()
        #expect(f.session.nativeProfile?.store === store)
        #expect(try await store.profileView().pendingIDs == ids)
        f.session.setForeground(false)
        f.session.setForeground(true)
        #expect(f.session.nativeProfile?.store === store)
        try await f.close()
    }

    @Test func readOnlyAccountCannotQueueEditsAndSignOutFailureKeepsItsScope() async throws {
        let f = try await NativeOfflineAccountFixture.make(capabilities: .init())
        let model = AccountModel(session: f.session)
        model.saveName("Blocked")
        model.email("other", password: "SyntheticOnly", create: true)
        #expect(f.session.profileState?.visible?.displayName == "Ranger a")
        #expect(f.session.profileState?.pendingCount == 0)
        #expect(!model.capabilities.allows(.link))
        f.auth.signOutFails = true
        #expect(throws: (any Error).self) { try f.auth.signOut() }
        #expect(f.session.identity?.uid == "a" && f.session.nativeProfile?.uid == "a")
        f.auth.signOutFails = false
        try f.auth.signOut()
        try await eventually { f.session.identity == nil && f.session.nativeTrips != nil }
        #expect(f.session.nativeProfile == nil && f.session.nativeVisits == nil)
        #expect(f.session.entitlement.access == nil && f.session.profileState == nil)
        #expect(try await f.session.nativeTrips?.repository.store.pendingTripIDs().isEmpty == true)
        try await f.close()
    }
}
