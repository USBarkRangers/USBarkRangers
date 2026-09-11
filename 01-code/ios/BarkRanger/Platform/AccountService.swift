@preconcurrency import FirebaseAuth
import Foundation

nonisolated struct AccountIdentity: Equatable, Sendable {
    let uid: String
    let email: String?
    let displayName: String?
    let verified: Bool
    let providers: [String]
    let serverConfirmed: Bool
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
    func unlink(_ provider: String, uid: String) async throws
    func revokeApple(authorizationCode: String) async throws
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
                    providers: $0.providerData.map(\.providerID), serverConfirmed: confirmed)
            })
    }
    func email(_ email: String, password: String, create: Bool) async throws {
        if create {
            _ = try await auth.createUser(withEmail: email, password: password)
        } else {
            _ = try await auth.signIn(withEmail: email, password: password)
        }
    }
    func credential(_ credential: AuthCredential, use: CredentialUse, uid: String?) async throws {
        if use != .signIn {
            guard let uid, auth.currentUser?.uid == uid else { throw AccountFailure.accountChanged }
        }
        switch use {
        case .signIn: _ = try await auth.signIn(with: credential)
        case .link:
            guard let user = auth.currentUser else { throw AccountFailure.signInRequired }
            _ = try await user.link(with: credential)
            guard auth.currentUser?.uid == user.uid else { throw AccountFailure.accountChanged }
        case .reauthenticate:
            guard let user = auth.currentUser else { throw AccountFailure.signInRequired }
            _ = try await user.reauthenticate(with: credential)
            guard auth.currentUser?.uid == user.uid else { throw AccountFailure.accountChanged }
        }
        try await reload()
    }
    func password(_ email: String, password: String, use: CredentialUse, uid: String?) async throws {
        let value = EmailAuthProvider.credential(withEmail: email, password: password)
        try await credential(value, use: use, uid: uid)
    }
    func signOut() throws { try auth.signOut() }
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
    func unlink(_ provider: String, uid: String) async throws {
        guard let user = auth.currentUser, user.uid == uid else { throw AccountFailure.accountChanged }
        guard user.providerData.count > 1 else {
            throw AccountFailure.lastProvider
        }
        _ = try await user.unlink(fromProvider: provider)
        guard auth.currentUser?.uid == uid else { throw AccountFailure.accountChanged }
        try await reload()
    }
    func revokeApple(authorizationCode: String) async throws {
        try await auth.revokeToken(withAuthorizationCode: authorizationCode)
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

enum AccountFailure: Error { case signInRequired, accountChanged, lastProvider, configuration, cancelled }
