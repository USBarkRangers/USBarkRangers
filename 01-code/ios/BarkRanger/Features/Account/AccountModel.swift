import AuthenticationServices
import BarkDomain
import Foundation
import Observation

/// Account form intents. Session owns identity/data; repositories own durable changes; adapters own providers.
@MainActor @Observable final class AccountModel {
    let session: AccountSession
    let google: GoogleSignInAdapter?
    let apple = AppleSignInAdapter()
    private(set) var busy = false
    private(set) var notice: String?
    private(set) var billingURL: URL?
    @ObservationIgnored private var action: Task<Void, Never>?
    private var actionID = UUID()
    private var appleRequestUID: String?
    init(session: AccountSession, google: GoogleSignInAdapter? = nil) {
        self.session = session
        self.google = google
    }
    var providerButtonsAvailable: Bool { session.auth != nil && session.auth?.isTest == false }
    func email(_ email: String, password: String, create: Bool) {
        guard let auth = session.auth else { return }
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            !password.isEmpty, !create || password.count >= 8
        else {
            notice = "Enter your email and password. New passwords need at least 8 characters."
            return
        }
        perform {
            try await auth.email(
                email.trimmingCharacters(in: .whitespacesAndNewlines), password: password, create: create)
        }
    }
    func resetPassword(_ email: String) {
        guard let auth = session.auth, !email.isEmpty else {
            notice = "Enter your email first."
            return
        }
        perform(success: "If an account uses that email, password reset instructions are available.") {
            try await auth.resetPassword(email: email)
        }
    }
    func verifyEmail() {
        guard let auth = session.auth, let uid = session.identity?.uid else { return }
        perform(
            success: auth.isTest
                ? "Verification link is in the local Auth emulator log." : "Verification email requested."
        ) {
            try await auth.verifyEmail(uid: uid)
        }
    }
    func refreshIdentity() {
        guard let auth = session.auth else { return }
        perform {
            try await auth.reload()
            self.session.requestSync()
        }
    }
    func signOut() {
        guard let auth = session.auth else { return }
        perform { try auth.signOut() }
    }
    func saveName(_ name: String) {
        guard let profile = session.profile else { return }
        perform(success: "Saved on this iPhone. Cloud sync will confirm the change when connected.") {
            try await profile.editDisplayName(name)
        }
    }
    func resolve(_ item: PendingMutation, keepLocal: Bool) {
        guard let profile = session.profile else { return }
        perform(success: "Resolution saved on this iPhone.") {
            try await profile.resolve(item.id, keepLocal: keepLocal)
        }
    }
    func prepareApple(_ request: ASAuthorizationAppleIDRequest) {
        appleRequestUID = session.identity?.uid
        do { try apple.prepare(request) } catch { notice = Self.message(error) }
    }
    func finishApple(_ result: Result<ASAuthorization, any Error>, use: CredentialUse) {
        guard appleRequestUID == session.identity?.uid else {
            apple.cancel()
            return
        }
        guard let auth = session.auth else { return }
        do {
            let uid = appleRequestUID
            let credential = try apple.credential(result)
            perform { try await auth.credential(credential, use: use, uid: uid) }
        } catch { notice = Self.message(error) }
    }
    func useGoogle(_ use: CredentialUse) {
        guard let auth = session.auth, let google else { return }
        let uid = session.identity?.uid
        perform {
            let credential = try await google.credential()
            guard self.session.identity?.uid == uid else { throw AccountFailure.accountChanged }
            try await auth.credential(credential, use: use, uid: uid)
        }
    }
    func linkEmail(_ email: String, password: String) {
        guard password.count >= 8 else {
            notice = "Use at least 8 characters for the password."
            return
        }
        usePassword(email, password: password, use: .link)
    }
    func reauthenticate(password: String) {
        guard let email = session.identity?.email else { return }
        usePassword(email, password: password, use: .reauthenticate)
    }
    private func usePassword(_ email: String, password: String, use: CredentialUse) {
        guard let auth = session.auth else { return }
        let uid = session.identity?.uid
        perform(
            success: use == .reauthenticate
                ? "Identity confirmed. You can now delete this account." : "Sign-in method linked."
        ) {
            try await auth.password(email, password: password, use: use, uid: uid)
        }
    }
    func unlink(_ provider: String) {
        guard let auth = session.auth, let uid = session.identity?.uid else { return }
        perform(success: "Sign-in method removed.") { try await auth.unlink(provider, uid: uid) }
    }
    func existingAccess(_ operation: ExistingAccountAction) {
        guard operation != .delete, let cloud = session.cloud, let uid = session.identity?.uid else { return }
        perform(
            success: session.auth?.isTest == true
                ? "Test provider action completed; no external provider was contacted."
                : "Account request completed."
        ) {
            let url = try await cloud.accountAction(operation, uid: uid)
            guard self.session.identity?.uid == uid, !Task.isCancelled else { return }
            self.billingURL = url
            self.session.requestSync()
        }
    }
    func deleteAccount(confirmation: String) {
        guard confirmation == "DELETE", let cloud = session.cloud, let auth = session.auth,
            let uid = session.identity?.uid
        else {
            notice = "Type DELETE to confirm."
            return
        }
        let requiresApple = session.identity?.providers.contains("apple.com") == true
        let appleCode = apple.authorizationCode
        if requiresApple && appleCode == nil {
            notice = "Confirm with Apple again before deleting this linked account."
            return
        }
        perform {
            if let appleCode { try await auth.revokeApple(authorizationCode: appleCode) }
            try Task.checkCancellation()
            guard self.session.identity?.uid == uid else { throw AccountFailure.accountChanged }
            _ = try await cloud.accountAction(.delete, uid: uid)
            guard self.session.identity?.uid == uid else { return }
            try auth.signOut()
            try await self.session.eraseDeletedAccount(uid: uid)
        }
    }
    func clearBillingURL() { billingURL = nil }
    func cancel() {
        actionID = UUID()
        action?.cancel()
        action = nil
        busy = false
        notice = nil
        billingURL = nil
        apple.cancel()
    }
    private func perform(success: String? = nil, _ work: @escaping @MainActor () async throws -> Void) {
        guard action == nil else { return }
        let id = UUID()
        actionID = id
        busy = true
        notice = nil
        let uid = session.identity?.uid
        action = Task { [weak self] in
            do {
                guard self?.session.identity?.uid == uid else { throw AccountFailure.accountChanged }
                try Task.checkCancellation()
                try await work()
                try Task.checkCancellation()
                if self?.actionID == id, self?.session.identity?.uid == uid { self?.notice = success }
            } catch {
                if !Task.isCancelled, self?.actionID == id, self?.session.identity?.uid == uid {
                    self?.notice = Self.message(error)
                }
            }
            if self?.actionID == id {
                self?.busy = false
                self?.action = nil
            }
        }
    }
    static func message(_ error: any Error) -> String {
        switch error {
        case LocalStore.Failure.invalidChange:
            "Use a display name of 2–30 characters, without control characters or angle brackets."
        case LocalStore.Failure.unavailableAccess:
            "Current Premium access is required to save this preference to your account."
        case LocalStore.Failure.closed, AccountFailure.accountChanged:
            "The account changed. Please try again."
        case AccountFailure.lastProvider: "Keep at least one sign-in method linked to your account."
        case AccountFailure.configuration: "This sign-in provider is not configured for this build."
        default: (error as NSError).localizedDescription
        }
    }
}
