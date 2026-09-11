import BarkDomain
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

/// Explicit opt-in: ordinary unit/UI tests never initialize Firebase or need running emulators.
@MainActor struct NativeAccountEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"))
    func sdkSignInOfflineReopenSyncAndAccountIsolation() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let scope = UUID()
        let assembly = AccountAssembly.emulator(directory: folder, scope: scope)
        let auth = try #require(assembly.session.auth)
        let cloud = try #require(assembly.session.cloud)
        let first = assembly.session
        first.setForeground(true)
        first.connectivityChanged(true)
        try await auth.email("ranger-a@example.test", password: "BarkTest123!", create: false)
        try await eventually { first.state?.baseline.confirmedAt != nil }
        #expect(first.identity?.uid == "native-test-a")
        #expect(first.entitlement.access?.premium == true)
        #expect(first.state?.baseline.trips.first?.id == "stored-route-id")
        #expect(first.state?.baseline.visitCount == 2)
        first.connectivityChanged(false)
        let name = "Native \(String(UUID().uuidString.prefix(8)))"
        try await first.profile?.editDisplayName(name)
        try await eventually { first.state?.pending.count == 1 }
        let pending = try #require(first.state?.pending.first?.operation)
        await first.stopAndWait()
        let reopened = AccountSession(auth: auth, cloud: cloud, directory: folder)
        reopened.setForeground(true)
        try await eventually { reopened.state != nil }
        #expect(reopened.state?.visible.profile.displayName == name)
        #expect(reopened.state?.pending.first?.operation.id == pending.id)
        reopened.connectivityChanged(true)
        try await eventually { reopened.state?.pending.isEmpty == true }
        #expect(reopened.state?.visible.profile.displayName == name)
        try await auth.email("ranger-b@example.test", password: "BarkTest123!", create: false)
        try await eventually { reopened.state?.baseline.uid == "native-test-b" }
        #expect(reopened.state?.visible.profile.displayName != name)
        #expect(reopened.entitlement.access?.premium == false)
        await #expect(throws: (any Error).self) { _ = try await cloud.submit(pending) }
        await #expect(throws: (any Error).self) { try await auth.verifyEmail(uid: "native-test-a") }
        await #expect(throws: (any Error).self) { try await auth.unlink("password", uid: "native-test-a") }
        try auth.signOut()
        await reopened.stopAndWait()
        if let app = FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)") {
            try await Firestore.firestore(app: app).terminate()
            await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        }
    }
}
