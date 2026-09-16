import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

/// Real Firebase SDK + isolated Auth emulator. Unsigned Apple fixtures exercise
/// linking semantics, NOT Apple's cryptographic verification or consent sheet.
@MainActor
@Suite(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
struct NativeAuthLifecycleEmulatorTests {
    @Test func overlappingSignInsCannotReplaceTheFirstSuccessfulIdentity() async throws {
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let service = AccountService(auth: auth, isTest: true)
        let attempts = (0..<4).map { _ in
            Task { @MainActor in
                do {
                    try await service.email(
                        "overlap-\(UUID().uuidString.lowercased())@native.invalid",
                        password: "NativeOnly123!", create: true)
                    return auth.currentUser?.uid
                } catch { return nil as String? }
            }
        }
        var successful: [String] = []
        for attempt in attempts { if let uid = await attempt.value { successful.append(uid) } }
        #expect(successful.count == 1 && successful.first == auth.currentUser?.uid)
        try await db.terminate()
        await withCheckedContinuation { c in app.delete { _ in c.resume() } }
    }

    @Test func collisionsAndConfirmedUnlinkPreserveTheOriginalAccount() async throws {
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let service = AccountService(auth: auth, isTest: true)
        let address = "link-\(UUID().uuidString.lowercased())@native.invalid"
        let password = "NativeOnly123!"
        try await service.email(address, password: password, create: true)
        let original = try #require(auth.currentUser?.uid)
        let apple = try appleCredential(subject: UUID().uuidString, email: address)
        try await service.credential(apple, use: .link, uid: original)
        #expect(auth.currentUser?.uid == original)
        #expect(Set(auth.currentUser?.providerData.map(\.providerID) ?? []) == ["password", "apple.com"])
        let keptPassword = EmailAuthProvider.credential(withEmail: address, password: password)
        // Explicitly mark unverified to prove an Apple assertion cannot skip the
        // remaining-password mailbox check. This endpoint is emulator-only.
        try await updateEmulatorUser(original, verified: false)
        await #expect(throws: AccountFailure.verifiedPasswordRequired) {
            try await service.unlink("apple.com", uid: original, confirmingWith: keptPassword)
        }
        try await service.verifyEmail(uid: original)
        try await auth.applyActionCode(try await actionCode(email: address, type: "VERIFY_EMAIL"))
        let wrong = EmailAuthProvider.credential(withEmail: address, password: "WrongPassword!")
        await #expect(throws: (any Error).self) {
            try await service.unlink("apple.com", uid: original, confirmingWith: wrong)
        }
        #expect(auth.currentUser?.providerData.contains { $0.providerID == "apple.com" } == true)
        try service.signOut()
        try await service.email(
            "other-\(UUID().uuidString.lowercased())@native.invalid", password: password, create: true)
        let other = try #require(auth.currentUser?.uid)
        await #expect(throws: (any Error).self) {
            try await service.credential(apple, use: .link, uid: other)
        }
        #expect(auth.currentUser?.uid == other && other != original)
        try service.signOut()
        try await service.email(address, password: password, create: false)
        try await service.unlink("apple.com", uid: original, confirmingWith: keptPassword)
        #expect(auth.currentUser?.uid == original)
        #expect(auth.currentUser?.providerData.map(\.providerID) == ["password"])
        await #expect(throws: AccountFailure.lastProvider) {
            try await service.unlink("password", uid: original, confirmingWith: keptPassword)
        }
        try await db.terminate()
        await withCheckedContinuation { c in app.delete { _ in c.resume() } }
    }

    @Test func appleFirstCanAddPasswordResetItAndRemoveOnlyAfterAppleConfirmation() async throws {
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let service = AccountService(auth: auth, isTest: true)
        let apple = try appleCredential(
            subject: UUID().uuidString, email: "\(UUID().uuidString.lowercased())@privaterelay.appleid.com")
        try await service.credential(apple, use: .signIn, uid: nil)
        let uid = try #require(auth.currentUser?.uid)
        let email = "password-\(UUID().uuidString.lowercased())@native.invalid"
        try await service.password(email, password: "NativeOnly123!", use: .link, uid: uid)
        #expect(auth.currentUser?.uid == uid)
        #expect(auth.currentUser?.providerData.first { $0.providerID == "password" }?.email == email)
        try await service.resetPassword(email: email)
        let code = try await actionCode(email: email, type: "PASSWORD_RESET")
        try await auth.confirmPasswordReset(withCode: code, newPassword: "Replacement123!")
        try service.signOut()
        await #expect(throws: (any Error).self) {
            try await service.email(email, password: "NativeOnly123!", create: false)
        }
        try await service.email(email, password: "Replacement123!", create: false)
        #expect(auth.currentUser?.uid == uid)
        // The pinned Auth emulator's resetPassword implementation removes federated
        // methods. Reload and honor that authoritative list, never pretend Apple
        // survived or auto-relink it from a retained credential in the app.
        #expect(auth.currentUser?.providerData.map(\.providerID) == ["password"])
        await #expect(throws: AccountFailure.lastProvider) {
            try await service.unlink("password", uid: uid, confirmingWith: apple)
        }
        // The user explicitly reconnects Apple before asking to remove password.
        try await service.credential(apple, use: .link, uid: uid)
        let wrongApple = try appleCredential(subject: UUID().uuidString, email: "wrong@native.invalid")
        await #expect(throws: (any Error).self) {
            try await service.credential(wrongApple, use: .reauthenticate, uid: uid)
        }
        #expect(auth.currentUser?.uid == uid)
        await #expect(throws: (any Error).self) {
            try await service.unlink("password", uid: uid, confirmingWith: wrongApple)
        }
        #expect(auth.currentUser?.providerData.contains { $0.providerID == "password" } == true)
        try await service.unlink("password", uid: uid, confirmingWith: apple)
        #expect(
            auth.currentUser?.uid == uid && auth.currentUser?.providerData.map(\.providerID) == ["apple.com"])
        try await db.terminate()
        await withCheckedContinuation { c in app.delete { _ in c.resume() } }
    }

    @Test(arguments: [false, true])
    func sameEmailAppleSignInUsesFirebaseIdentityRulesWithoutCreatingASecondUID(_ verified: Bool) async throws
    {
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let service = AccountService(auth: auth, isTest: true)
        let email = "same-email-\(UUID().uuidString.lowercased())@native.invalid"
        try await service.email(email, password: "NativeOnly123!", create: true)
        let uid = try #require(auth.currentUser?.uid)
        try await updateEmulatorUser(uid, verified: verified)
        try service.signOut()
        let apple = try appleCredential(subject: UUID().uuidString, email: email)
        try await service.credential(apple, use: .signIn, uid: nil)
        #expect(auth.currentUser?.uid == uid)
        #expect(auth.currentUser?.providerData.contains { $0.providerID == "apple.com" } == true)
        // No app-written email lookup/merge. Provider retention is Firebase-owned.
        try await db.terminate()
        await withCheckedContinuation { c in app.delete { _ in c.resume() } }
    }

    private func appleCredential(subject: String, email: String) throws -> AuthCredential {
        func segment(_ value: [String: Any]) throws -> String {
            try JSONSerialization.data(withJSONObject: value).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        let token =
            try segment(["alg": "none"]) + "."
            + segment([
                "sub": subject, "email": email, "email_verified": true, "iss": "https://appleid.apple.com",
                "aud": "swarm.USBARKRANGERS", "iat": Int(Date().timeIntervalSince1970),
                "exp": Int(Date().timeIntervalSince1970) + 3600,
            ]) + "."
        return OAuthProvider.appleCredential(withIDToken: token, rawNonce: "emulator-only", fullName: nil)
    }
    private func actionCode(email: String, type: String) async throws -> String {
        let url = URL(string: "http://127.0.0.1:9198/emulator/v1/projects/demo-bark-native/oobCodes")!
        let (data, _) = try await URLSession.shared.data(from: url)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let codes = try #require(body["oobCodes"] as? [[String: Any]])
        return try #require(
            codes.last { $0["email"] as? String == email && $0["requestType"] as? String == type }?["oobCode"]
                as? String)
    }
    private func updateEmulatorUser(_ uid: String, verified: Bool) async throws {
        let url = URL(
            string:
                "http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/projects/demo-bark-native/accounts:update"
        )!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "localId": uid, "emailVerified": verified,
        ])
        let (_, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
    }
}
