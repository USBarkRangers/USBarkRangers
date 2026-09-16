@preconcurrency import FirebaseAuth
import Foundation

/// Build capabilities are explicit composition choices, separate from identity and paid access.
nonisolated struct AccountCapabilities: Equatable, Sendable {
    var profileWrites = false
    var authenticationChanges = false
    var accountManagement = false
    var isReadOnly: Bool { !profileWrites && !authenticationChanges && !accountManagement }
    func allows(_ use: CredentialUse) -> Bool {
        switch use {
        case .signIn: true
        case .link: authenticationChanges
        case .reauthenticate: authenticationChanges || accountManagement
        }
    }
}

nonisolated struct AccountIdentity: Equatable, Sendable {
    let uid: String
    let email: String?
    let displayName: String?
    let verified: Bool
    let providers: [String]
    let serverConfirmed: Bool
    var passwordEmail: String? = nil
}

@MainActor protocol AccountAuthenticating: AnyObject {
    var isTest: Bool { get }
    func changes() -> AsyncStream<AccountIdentity?>
    func email(_ email: String, password: String, create: Bool) async throws
    func credential(_ credential: AuthCredential, use: CredentialUse, uid: String?) async throws
    func password(_ email: String, password: String, use: CredentialUse, uid: String?) async throws
    func signOut() throws
    func resetPassword(email: String) async throws
    func verifyEmail(uid: String) async throws
    func reload() async throws
    func unlink(_ provider: String, uid: String, confirmingWith credential: AuthCredential) async throws
    func revokeApple(authorizationCode: String, uid: String) async throws
}
enum CredentialUse { case signIn, link, reauthenticate }

/// Firebase owns credentials and the remembered UID in Keychain; there is no second identity cache.
@MainActor final class AccountService: AccountAuthenticating {
    private let auth: Auth
    let isTest: Bool
    private var listener: AuthStateDidChangeListenerHandle?
    private var continuation: AsyncStream<AccountIdentity?>.Continuation?
    private var confirmation: Task<Void, Never>?
    private var generation = UUID()
    private var changingIdentity = false
    init(auth: Auth, isTest: Bool) {
        self.auth = auth
        self.isTest = isTest
    }

    func changes() -> AsyncStream<AccountIdentity?> {
        stop()
        let (stream, continuation) = AsyncStream<AccountIdentity?>.makeStream(
            bufferingPolicy: .bufferingNewest(1))
        self.continuation = continuation
        let generation = generation
        listener = auth.addStateDidChangeListener { [weak self] _, user in
            let callbackUID = user?.uid
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, self.auth.currentUser?.uid == callbackUID
                else { return }
                self.publish(self.auth.currentUser, confirmed: false)
                self.confirmation?.cancel()
                self.confirmation = Task { [weak self] in
                    guard let self, let user = self.auth.currentUser, user.uid == callbackUID else { return }
                    do {
                        _ = try await user.getIDTokenResult(forcingRefresh: true)
                        guard !Task.isCancelled, self.auth.currentUser?.uid == user.uid else { return }
                        self.publish(user, confirmed: true)
                    } catch {
                        let code = (error as NSError).code
                        if [
                            AuthErrorCode.userDisabled.rawValue, AuthErrorCode.userNotFound.rawValue,
                            AuthErrorCode.invalidUserToken.rawValue, AuthErrorCode.userTokenExpired.rawValue,
                        ].contains(code),
                            self.auth.currentUser?.uid == user.uid, !Task.isCancelled
                        {
                            try? self.auth.signOut()
                        }
                        // A network failure retains the remembered account without claiming confirmation.
                    }
                }
            }
        }
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor [weak self] in
                if self?.generation == generation { self?.stop() }
            }
        }
        return stream
    }
    private func publish(_ user: User?, confirmed: Bool) {
        continuation?.yield(
            user.map {
                AccountIdentity(
                    uid: $0.uid, email: $0.email,
                    displayName: $0.displayName, verified: $0.isEmailVerified,
                    providers: $0.providerData.map(\.providerID), serverConfirmed: confirmed,
                    passwordEmail: $0.providerData.first { $0.providerID == "password" }?.email)
            })
    }
    func email(_ email: String, password: String, create: Bool) async throws {
        try beginIdentityChange()
        defer { changingIdentity = false }
        try Task.checkCancellation()
        guard auth.currentUser == nil else { throw AccountFailure.accountChanged }
        if create {
            _ = try await auth.createUser(withEmail: email, password: password)
        } else {
            _ = try await auth.signIn(withEmail: email, password: password)
        }
    }
    func credential(_ credential: AuthCredential, use: CredentialUse, uid: String?) async throws {
        try beginIdentityChange()
        defer { changingIdentity = false }
        try Task.checkCancellation()
        guard auth.currentUser?.uid == uid, use == .signIn || uid != nil else {
            throw AccountFailure.accountChanged
        }
        switch use {
        case .signIn: _ = try await auth.signIn(with: credential)
        case .link:
            guard let user = auth.currentUser else { throw AccountFailure.signInRequired }
            _ = try await user.link(with: credential)
            guard auth.currentUser?.uid == user.uid else { throw AccountFailure.accountChanged }
        case .reauthenticate:
            guard let user = auth.currentUser else { throw AccountFailure.signInRequired }
            try await confirmIdentity(credential, user: user)
            guard auth.currentUser?.uid == user.uid else { throw AccountFailure.accountChanged }
        }
        try await reload()
    }
    func password(_ email: String, password: String, use: CredentialUse, uid: String?) async throws {
        let value = EmailAuthProvider.credential(withEmail: email, password: password)
        try await credential(value, use: use, uid: uid)
    }
    func signOut() throws {
        guard !changingIdentity else { throw AccountFailure.authenticationInProgress }
        try auth.signOut()
    }
    func resetPassword(email: String) async throws { try await auth.sendPasswordReset(withEmail: email) }
    func verifyEmail(uid: String) async throws {
        guard let user = auth.currentUser, user.uid == uid else { throw AccountFailure.accountChanged }
        try await user.sendEmailVerification()
    }
    func reload() async throws {
        guard let user = auth.currentUser else { return }
        try await user.reload()
        _ = try await user.getIDTokenResult(forcingRefresh: true)
        guard auth.currentUser?.uid == user.uid else { throw AccountFailure.accountChanged }
        publish(user, confirmed: true)
    }
    /// Confirm the remaining method in this same operation; no reusable "confirmed" flag.
    /// Firebase owns the provider list. Never duplicate it in Firestore or move account data.
    func unlink(_ provider: String, uid: String, confirmingWith credential: AuthCredential) async throws {
        try beginIdentityChange()
        defer { changingIdentity = false }
        let user = try currentUser(uid)
        try await user.reload()
        try requireRemoval(provider, from: try currentUser(uid), confirmation: credential)
        try await confirmIdentity(credential, user: user)
        try await user.reload()
        try requireRemoval(provider, from: try currentUser(uid), confirmation: credential)
        _ = try await user.unlink(fromProvider: provider)
        _ = try currentUser(uid)
        try await reload()
    }
    private func currentUser(_ uid: String) throws -> User {
        try Task.checkCancellation()
        guard let user = auth.currentUser, user.uid == uid else { throw AccountFailure.accountChanged }
        return user
    }
    private func confirmIdentity(_ credential: AuthCredential, user: User) async throws {
        let uid = user.uid
        // Firebase 12.19.1's async bridge checks result BEFORE error. Its callback
        // can supply both on userMismatch, so do not use that bridge for a security
        // confirmation. Honor errors first and verify the returned UID explicitly.
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            user.reauthenticate(with: credential) { result, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if result?.user.uid == uid {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: AccountFailure.accountChanged)
                }
            }
        }
        _ = try currentUser(uid)
    }
    /// Canceling a screen cannot cancel an already-sent Firebase request. Keep
    /// identity writes serialized until the SDK finishes, including after cancellation.
    private func beginIdentityChange() throws {
        try Task.checkCancellation()
        guard !changingIdentity else { throw AccountFailure.authenticationInProgress }
        changingIdentity = true
    }
    private func requireRemoval(_ provider: String, from user: User, confirmation: AuthCredential) throws {
        let remaining = provider == "apple.com" ? "password" : "apple.com"
        guard ["apple.com", "password"].contains(provider),
            user.providerData.contains(where: { $0.providerID == provider }),
            user.providerData.contains(where: { $0.providerID == remaining })
        else { throw AccountFailure.lastProvider }
        guard confirmation.provider == remaining else { throw AccountFailure.remainingMethodRequired }
        if remaining == "password" {
            let email = user.providerData.first { $0.providerID == "password" }?.email
            guard user.isEmailVerified, let email,
                user.email?.caseInsensitiveCompare(email) == .orderedSame
            else { throw AccountFailure.verifiedPasswordRequired }
        }
    }
    func revokeApple(authorizationCode: String, uid: String) async throws {
        try beginIdentityChange()
        defer { changingIdentity = false }
        try Task.checkCancellation()
        guard auth.currentUser?.uid == uid else { throw AccountFailure.accountChanged }
        guard !authorizationCode.isEmpty else { throw AccountFailure.appleConfirmationRequired }
        try await auth.revokeToken(withAuthorizationCode: authorizationCode)
        guard auth.currentUser?.uid == uid else { throw AccountFailure.accountChanged }
    }
    private func stop() {
        generation = UUID()
        confirmation?.cancel()
        confirmation = nil
        if let listener { auth.removeStateDidChangeListener(listener) }
        listener = nil
        continuation?.finish()
        continuation = nil
    }
}

enum AccountFailure: Error {
    case signInRequired, accountChanged, lastProvider, configuration, cancelled, appleConfirmationRequired
    case remainingMethodRequired, verifiedPasswordRequired
    case authenticationInProgress
}
