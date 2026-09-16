import BarkDomain
import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AccountScopeLifecycleTests {
    @Test func signOutAndDifferentUIDCloseEveryResourceOnceInDrainOrder() async throws {
        let f = try await AccountScopeFixture.make()
        let storeA = try #require(f.session.nativeProfile?.store)
        var events: [String] = []
        f.session.lifecycleObserver = { events.append($0) }
        f.session.closeTripEditing = { Task {} }
        try f.auth.signOut()
        try await eventually { f.session.identity == nil && f.session.nativeTrips != nil }
        #expect(
            events == [
                "previousTask", "scheduler", "observation", "editor", "trips", "visits",
                "expeditions", "leaderboard", "savedPins", "profile",
            ])
        #expect(await storeA.closed)
        let guest = try #require(f.session.nativeTrips?.repository.store)
        events = []
        f.auth.select("b")
        try await f.ready("b")
        #expect(events == ["previousTask", "editor", "trips", "guestStore"])
        #expect(await guest.closed)
        let storeB = try #require(f.session.nativeProfile?.store)
        #expect(storeA !== storeB)
        events = []
        await f.session.stopAndWait()
        #expect(
            events == [
                "previousTask", "scheduler", "observation", "editor", "trips", "visits",
                "expeditions", "leaderboard", "savedPins", "profile",
            ])
        #expect(await storeB.closed)
        try await f.close()
    }

    @Test func outgoingPresentationClearsBeforeEditorDrainAndNextWriterWaits() async throws {
        let f = try await AccountScopeFixture.make()
        let store = try #require(f.session.nativeProfile?.store)
        let gate = ScopeDrainGate()
        f.session.closeTripEditing = { Task { await gate.wait() } }
        f.auth.select("b")
        try await eventually { f.session.identity?.uid == "b" }
        #expect(f.session.nativeProfile == nil && f.session.nativeTrips == nil)
        #expect(f.session.nativeVisits == nil && f.session.nativeExpeditions == nil)
        #expect(f.session.nativeSavedPins == nil && f.session.nativeLeaderboard == nil)
        #expect(f.session.profileState == nil && f.session.entitlement.access == nil)
        #expect(f.session.tripLibraryMessage == nil && f.session.message == nil)
        #expect(!f.session.requiresStorageRecovery && !f.session.isSyncing)
        #expect(await store.closed == false, "The editor must drain before its writer closes")
        await gate.release()
        try await f.ready("b")
        #expect(await store.closed)
        f.session.closeTripEditing = nil
        try await f.close()
    }

    @Test func retryStorageReopensTheSameUIDScope() async throws {
        let f = try await AccountScopeFixture.make()
        let oldStore = try #require(f.session.nativeProfile?.store)
        let oldTrips = try #require(f.session.nativeTrips)
        try await oldStore.saveProfileEdit(.displayName("Retained edit"))
        f.session.retryStorage()
        #expect(f.session.identity?.uid == "a")
        #expect(f.session.nativeProfile == nil && f.session.nativeTrips == nil)
        try await f.ready("a")
        #expect(f.session.nativeProfile?.store !== oldStore)
        #expect(f.session.nativeTrips !== oldTrips)
        #expect(await oldStore.closed)
        #expect(f.session.profileState?.visible?.displayName == "Retained edit")
        try await f.close()
    }

    @Test(arguments: [false, true])
    func stopAndWaitLeavesNoStartedScopeOrOpenFeature(_ preservingForeground: Bool) async throws {
        let f = try await AccountScopeFixture.make()
        let store = try #require(f.session.nativeProfile?.store)
        await f.session.stopAndWait(preservingForeground: preservingForeground)
        #expect(!f.session.scopeStartedForTesting)
        #expect(f.session.identity == nil && f.session.nativeProfile == nil)
        #expect(f.session.nativeTrips == nil && f.session.nativeVisits == nil)
        #expect(f.session.nativeExpeditions == nil && f.session.nativeLeaderboard == nil)
        #expect(f.session.nativeSavedPins == nil && f.session.profileState == nil)
        #expect(!f.session.isSyncing && f.session.entitlement.access == nil)
        #expect(await store.closed)
        // A later start must open a fresh scope, including when foreground was retained.
        f.session.start()
        try await f.ready("a")
        #expect(f.session.nativeProfile?.store !== store)
        try await f.close()
    }

    @Test func guestUsesSeparateStoreAndNoAccountFeatures() async throws {
        let f = try await AccountScopeFixture.make(signIn: false)
        let trips = try #require(f.session.nativeTrips)
        #expect(trips.scope == "demo-bark-native:guest-drafts")
        #expect(await trips.repository.store.isGuest)
        #expect(f.session.nativeProfile == nil && f.session.nativeVisits == nil)
        #expect(f.session.nativeExpeditions == nil && f.session.nativeLeaderboard == nil)
        #expect(f.session.nativeSavedPins == nil && f.session.profileState == nil)
        #expect(!f.session.isSyncing && f.session.entitlement.access == nil)
        await f.session.stopAndWait()
        #expect(await trips.repository.store.closed)
        try await f.close()
    }

    @Test func tripStartFailureKeepsWorkingProfileAndExactMessage() async throws {
        let f = try await AccountScopeFixture.make(signIn: false)
        f.session.beforeFeatureStart = { stage, _ in
            if stage == "trips" { throw NativeStore.Failure.unavailable }
        }
        f.auth.select("a")
        try await eventually { f.session.tripLibraryMessage != nil && f.session.profileState != nil }
        #expect(
            f.session.tripLibraryMessage
                == "Trip storage could not be opened. Your saved files are retained; keep the app installed and retry."
        )
        #expect(f.session.nativeTrips == nil && f.session.nativeSavedPins != nil)
        let profile = try #require(f.session.nativeProfile)
        #expect(await profile.store.closed == false)
        try await profile.saveName("Still editable")
        try await eventually { f.session.profileState?.visible?.displayName == "Still editable" }
        #expect(!f.session.requiresStorageRecovery)
        try await f.close()
    }
}

@MainActor private struct AccountScopeFixture {
    let directory: URL
    let app: FirebaseApp
    let db: Firestore
    let auth: SyntheticAuth
    let session: AccountSession
    static func make(signIn: Bool = true) async throws -> Self {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        for uid in ["a", "b"] {
            let store = try await NativeStore.open(
                directory: directory, project: "demo-bark-native", uid: uid)
            try await store.acceptProfile(.init(revision: 1, displayName: "Ranger \(uid)"))
            try await store.seedPremium()
            await store.close()
        }
        let (app, sdkAuth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let configuration = NativeProfileConfiguration(
            project: "demo-bark-native",
            connect: { try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: $0) },
            connectLeaderboard: {
                NativeLeaderboardRepository(
                    transport: try NativeCallableTransport(uid: $0, auth: sdkAuth), uid: $0)
            })
        let auth = SyntheticAuth()
        let session = AccountSession(
            auth: auth, directory: directory, capabilities: .editableTest,
            nativeProfileConfiguration: configuration)
        let f = Self(directory: directory, app: app, db: db, auth: auth, session: session)
        session.setForeground(true)
        if signIn {
            auth.select("a")
            try await f.ready("a")
        } else {
            try await eventually { session.identity == nil && session.nativeTrips != nil }
        }
        return f
    }
    func ready(_ uid: String) async throws {
        try await eventually {
            session.identity?.uid == uid && session.nativeProfile?.uid == uid
                && session.profileState != nil && session.nativeTrips != nil && session.nativeVisits != nil
                && session.nativeExpeditions != nil && session.nativeLeaderboard != nil
                && session.nativeSavedPins != nil
        }
    }
    func close() async throws {
        session.beforeFeatureStart = nil
        session.lifecycleObserver = nil
        session.closeTripEditing = nil
        await session.stopAndWait()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        try FileManager.default.removeItem(at: directory)
    }
}

private actor ScopeDrainGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var released = false
    func wait() async {
        if !released { await withCheckedContinuation { continuation = $0 } }
    }
    func release() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}
