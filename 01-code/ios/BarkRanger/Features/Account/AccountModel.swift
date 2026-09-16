import AuthenticationServices
import BarkDomain
import FirebaseAuth
import Foundation
import Observation

enum AppleAccountAction {
    case signIn, link, reauthenticate, deleteAccount
    var credentialUse: CredentialUse {
        switch self {
        case .signIn: .signIn
        case .link: .link
        case .reauthenticate, .deleteAccount: .reauthenticate
        }
    }
}

/// Account form intents. Session owns identity/data; repositories own durable changes; adapters own providers.
@MainActor @Observable final class AccountModel {
    let session: AccountSession
    var capabilities: AccountCapabilities { session.capabilities }
    var canEditData: Bool {
        capabilities.profileWrites && session.dataAccess.canEditAccount
            && session.nativeProfile != nil && session.profileState?.visible?.status == .active
    }
    private let apple: any AppleCredentialProviding
    private(set) var busy = false
    private(set) var notice: String?
    @ObservationIgnored private(set) var action: Task<Void, Never>?
    private var actionID = UUID()
    private var appleRequest: (id: UUID, uid: String?, intent: AppleAccountAction)?
    init(
        session: AccountSession,
        apple: any AppleCredentialProviding = AppleSignInAdapter()
    ) {
        self.session = session
        self.apple = apple
    }
    var providerButtonsAvailable: Bool { session.auth != nil && session.auth?.isTest == false }
    func email(_ email: String, password: String, create: Bool) {
        guard let auth = session.auth, !create || capabilities.authenticationChanges else { return }
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            !password.isEmpty, !create || password.count >= 8
        else {
            notice = "Enter your email and password. New passwords need at least 8 characters."
            return
        }
        perform {
            try await self.session.prepareTripIdentityChange?()
            try await auth.email(
                email.trimmingCharacters(in: .whitespacesAndNewlines), password: password, create: create)
        }
    }
    func resetPassword(_ email: String) {
        guard capabilities.authenticationChanges else { return }
        guard let auth = session.auth, !email.isEmpty else {
            notice = "Enter your email first."
            return
        }
        perform(success: "If an account uses that email, password reset instructions are available.") {
            try await auth.resetPassword(email: email)
        }
    }
    func verifyEmail() {
        guard capabilities.authenticationChanges else { return }
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
            self.session.requestSync(refresh: true)
        }
    }
    func signOut() {
        guard let auth = session.auth else { return }
        perform {
            try await self.session.prepareTripIdentityChange?()
            try auth.signOut()
        }
    }
    func saveName(_ name: String) {
        guard canEditData else {
            notice = AccountDataAccess.readOnlyMessage
            return
        }
        guard let native = session.nativeProfile else { return }
        perform(success: "Saved on this iPhone. Cloud sync will confirm the change when connected.") {
            try await native.saveName(name)
        }
    }
    func resolveNativeProfile(_ reviewed: NativeStore.ProfileView, keepLocal: Bool) {
        guard let native = session.nativeProfile, let confirmed = reviewed.confirmed,
            reviewed.conflict, !keepLocal || canEditData
        else { return }
        perform(success: "Resolution saved on this iPhone.") {
            try await native.store.resolveProfileConflict(
                keepingLocalEdits: keepLocal, confirmedRevision: confirmed.revision,
                expectedPendingIDs: reviewed.pendingIDs)
        }
    }
    func prepareApple(_ request: ASAuthorizationAppleIDRequest, intent: AppleAccountAction) -> UUID? {
        guard !busy, session.cleanupState == .ready,
            session.auth != nil, capabilities.allows(intent.credentialUse),
            intent != .deleteAccount || capabilities.accountManagement,
            (intent == .signIn) == (session.identity == nil)
        else { return nil }
        let id = UUID()
        do {
            try apple.prepare(request, id: id)
            appleRequest = (id, session.identity?.uid, intent)
            busy = true
            notice = nil
            return id
        } catch {
            notice = Self.message(error)
            return nil
        }
    }
    func finishApple(_ result: Result<ASAuthorization, any Error>, id: UUID?) {
        guard let request = appleRequest, request.id == id else { return }
        appleRequest = nil
        busy = false
        guard request.uid == session.identity?.uid, let auth = session.auth else {
            apple.cancel()
            return
        }
        do {
            let result = try apple.credential(result, id: request.id)
            if request.intent == .deleteAccount, result.authorizationCode?.isEmpty != false {
                throw AccountFailure.appleConfirmationRequired
            }
            perform(
                success: request.intent == .link
                    ? "Apple sign-in linked to this account."
                    : request.intent == .reauthenticate ? "Identity confirmed." : nil,
                id: request.id
            ) {
                if request.intent == .signIn { try await self.session.prepareTripIdentityChange?() }
                try Task.checkCancellation()
                guard self.session.identity?.uid == request.uid else { throw AccountFailure.accountChanged }
                try await auth.credential(
                    result.credential, use: request.intent.credentialUse, uid: request.uid)
                if request.intent == .deleteAccount, let uid = request.uid,
                    let code = result.authorizationCode
                {
                    // A fresh reauthentication/code belongs to this confirmed deletion only.
                    try Task.checkCancellation()
                    guard self.session.identity?.uid == uid else { throw AccountFailure.accountChanged }
                    try await auth.revokeApple(authorizationCode: code, uid: uid)
                    try Task.checkCancellation()
                    guard self.session.identity?.uid == uid else { throw AccountFailure.accountChanged }
                    try await self.session.deleteAccount()
                }
            }
        } catch {
            apple.cancel()
            if (error as NSError).domain != ASAuthorizationError.errorDomain
                || (error as NSError).code != ASAuthorizationError.canceled.rawValue
            {
                notice = Self.message(error)
            }
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
        guard capabilities.allows(use) else { return }
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
        guard capabilities.authenticationChanges else { return }
        guard let auth = session.auth, let uid = session.identity?.uid else { return }
        perform(success: "Sign-in method removed.") { try await auth.unlink(provider, uid: uid) }
    }
    func deleteAccount() {
        guard session.identity?.providers.contains("apple.com") != true else {
            notice = Self.message(AccountFailure.appleConfirmationRequired)
            return
        }
        perform { try await self.session.deleteAccount() }
    }
    func cancel() {
        actionID = UUID()
        action?.cancel()
        action = nil
        busy = false
        notice = nil
        appleRequest = nil
        apple.cancel()
    }
    private func perform(
        success: String? = nil, id: UUID = UUID(), _ work: @escaping @MainActor () async throws -> Void
    ) {
        guard action == nil, !busy, session.cleanupState == .ready else { return }
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
        let failure = error as NSError
        if failure.domain == AuthErrors.domain,
            failure.code == AuthErrorCode.missingOrInvalidNonce.rawValue
        {
            // Firebase's raw error includes one-use security values. Never put
            // those values in the UI, screenshots or support messages.
            return
                "Apple sign-in could not be verified. Please try again. If it keeps happening, contact support."
        }
        if (error as NSError).domain == ASAuthorizationError.errorDomain {
            return
                "Apple sign-in couldn’t finish. Check that you’re signed in to your Apple Account in Settings and connected to the internet, then try again."
        }
        return switch error {
        case let failure as NativeCallableTransport.ServerFailure
        where failure.reason == "recent-auth-required":
            "Confirm your password or sign-in provider, then try deleting the account again."
        case NativeProfileEdit.Failure.invalid:
            "Use a display name of 2–30 characters, without control characters or angle brackets."
        case NativeStore.Failure.unavailable:
            AccountDataAccess.readOnlyMessage
        case NativeStore.Failure.queueFull:
            "This iPhone has reached its pending-change limit. Connect and resolve pending changes before adding more. Your edits have not been removed."
        case NativeStore.Failure.closed, AccountFailure.accountChanged,
            NativeProfileCloud.Failure.accountChanged:
            "The account changed. Please try again."
        case AccountFailure.lastProvider: "Keep at least one sign-in method linked to your account."
        case AccountFailure.configuration: "This sign-in provider is not configured for this build."
        case AccountFailure.appleConfirmationRequired:
            "Confirm with Apple to revoke its authorization and delete this account. No data has been deleted."
        case NativeStore.Failure.invalidAcknowledgment:
            "The saved values changed while you were reviewing them. Review the current values and try again."
        default: (error as NSError).localizedDescription
        }
    }
}
