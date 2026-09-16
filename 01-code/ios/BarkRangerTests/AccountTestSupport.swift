import BarkDomain
import FirebaseAuth
import Foundation

@testable import BarkRanger

@MainActor final class SyntheticAuth: AccountAuthenticating {
    // View contracts may expose provider controls without invoking a real provider.
    var isTest = true
    private var continuation: AsyncStream<AccountIdentity?>.Continuation?
    var signOutFails = false
    private(set) var credentialUses: [CredentialUse] = []
    private(set) var passwordResets = 0
    private(set) var resetAddresses: [String] = []
    private(set) var passwordInputs: [(email: String, password: String)] = []
    private(set) var removals: [(provider: String, uid: String, confirmation: String)] = []
    var removalWork: (@MainActor () async throws -> Void)?
    var credentialWork: (@MainActor () async throws -> Void)?
    var revocationWork: (@MainActor () async throws -> Void)?
    private(set) var revokedAppleUIDs: [String] = []
    private var current: AccountIdentity?
    func changes() -> AsyncStream<AccountIdentity?> {
        let (stream, continuation) = AsyncStream<AccountIdentity?>.makeStream(
            bufferingPolicy: .bufferingNewest(1))
        self.continuation = continuation
        continuation.yield(current)
        return stream
    }
    func select(
        _ uid: String?, confirmed: Bool = true, providers: [String] = ["password"], verified: Bool = true
    ) {
        current = uid.map {
            AccountIdentity(
                uid: $0, email: "\($0)@example.test", displayName: $0,
                verified: verified, providers: providers, serverConfirmed: confirmed,
                passwordEmail: providers.contains("password") ? "\($0)@example.test" : nil)
        }
        continuation?.yield(current)
    }
    func signOut() throws {
        if signOutFails { throw AccountFailure.configuration }
        select(nil)
    }
    func email(_ email: String, password: String, create: Bool) async throws { select(email) }
    func credential(_ credential: AuthCredential, use: CredentialUse, uid: String?) async throws {
        credentialUses.append(use)
        try await credentialWork?()
    }
    func password(_ email: String, password: String, use: CredentialUse, uid: String?) async throws {
        passwordInputs.append((email, password))
        try await credentialWork?()
    }
    func resetPassword(email: String) async throws {
        passwordResets += 1
        resetAddresses.append(email)
    }
    func verifyEmail(uid: String) async throws {}
    func reload() async throws { if let current { select(current.uid, providers: current.providers) } }
    func unlink(_ provider: String, uid: String, confirmingWith credential: AuthCredential) async throws {
        try await removalWork?()
        guard current?.uid == uid else { throw AccountFailure.accountChanged }
        removals.append((provider, uid, credential.provider))
    }
    func revokeApple(authorizationCode: String, uid: String) async throws {
        guard current?.uid == uid else { throw AccountFailure.accountChanged }
        try await revocationWork?()
        guard current?.uid == uid else { throw AccountFailure.accountChanged }
        revokedAppleUIDs.append(uid)
    }
}

extension AccountCapabilities {
    static var editableTest: Self {
        .init(profileWrites: true, authenticationChanges: true, accountManagement: true)
    }
}
