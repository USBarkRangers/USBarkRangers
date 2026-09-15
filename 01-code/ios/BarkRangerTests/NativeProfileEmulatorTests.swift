import BarkDomain
import FirebaseAppCheck
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeProfileEmulatorTests {
    @Test func demoAppCheckUsesALocalNonCredentialAndNeverMatchesALiveRegistration() async throws {
        let (app, _, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        do {
            let appCheck = try #require(AppCheck.appCheck(app: app))
            let token = try await appCheck.token(forcingRefresh: true)
            #expect(token.token == "bark-native-emulator-only")
            #expect(token.expirationDate > Date())
            #expect(NativeDebugAppCheckFactory.isEmulator(app.options))
            // Change each part independently: a real project, app or key must not
            // select the emulator-only provider, even in a development build.
            for field in ["project", "app", "key"] {
                let options = FirebaseOptions(
                    googleAppID: field == "app"
                        ? "1:360077919845:ios:cd94b1ea6899f95da6e88c" : app.options.googleAppID,
                    gcmSenderID: "123456789")
                options.projectID = field == "project" ? "bark-ranger-ios" : app.options.projectID
                options.apiKey = field == "key" ? "not-the-demo-key" : app.options.apiKey
                #expect(!NativeDebugAppCheckFactory.isEmulator(options))
            }
        } catch {
            try await db.terminate()
            await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
            throw error
        }
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func durableBootstrapUsesRealNativeSDKAndRefusesStaleAccountScope() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let user = try await auth.createUser(
            withEmail: "\(UUID().uuidString)@native.invalid", password: UUID().uuidString
        ).user
        let cloud = try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: user.uid)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: user.uid)
        #expect(try await cloud.current().profile == nil)
        let operationID = try await store.stageProfileEdit(.bootstrap)
        let command = try #require(try await store.nextProfileSubmission())
        let accepted = try await cloud.submit(command)
        #expect(accepted.operationID == operationID)
        // Lost response: resend the same durable bytes before applying the first response.
        #expect(try await cloud.submit(command) == accepted)
        let canonical = try await cloud.current()
        let profile = try #require(canonical.profile)
        let entitlement = try #require(canonical.entitlement)
        try await store.acceptProfileOutcome(accepted, canonical: profile)
        try await store.acceptEntitlement(entitlement)
        #expect(try await store.profileView().pendingCount == 0)
        #expect(try await store.profileView().confirmed?.displayName == "Ranger")
        #expect(!entitlement.permitsEditing(at: Date()))
        await #expect(throws: (any Error).self) {
            try await store.stageProfileEdit(.displayName("No paid access"))
        }
        let sync = NativeProfileSync(store: store, cloud: cloud)
        async let firstRefresh = sync.synchronize()
        async let secondRefresh = sync.synchronize()
        #expect(try await firstRefresh == .current)
        #expect(try await secondRefresh == .current)
        // The account lifetime, not an SDK cache, decides whether callbacks may publish.
        try auth.signOut()
        await #expect(throws: NativeProfileCloud.Failure.accountChanged) { try await cloud.current() }
        await sync.stop()
        await #expect(throws: NativeProfileCloud.Failure.accountChanged) { try await sync.synchronize() }
        await store.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }
}
