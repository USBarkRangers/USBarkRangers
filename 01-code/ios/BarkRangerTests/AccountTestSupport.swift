import BarkDomain
import FirebaseAuth
import Foundation

@testable import BarkRanger

@MainActor final class SyntheticAuth: AccountAuthenticating {
    let isTest = true
    private var continuation: AsyncStream<AccountIdentity?>.Continuation?
    var signOutFails = false
    private(set) var credentialUses: [CredentialUse] = []
    private(set) var passwordResets = 0
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
    func select(_ uid: String?, confirmed: Bool = true, providers: [String] = ["password"]) {
        current = uid.map {
            AccountIdentity(
                uid: $0, email: "\($0)@example.test", displayName: $0,
                verified: true, providers: providers, serverConfirmed: confirmed)
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
    func password(_ email: String, password: String, use: CredentialUse, uid: String?) async throws {}
    func resetPassword(email: String) async throws { passwordResets += 1 }
    func verifyEmail(uid: String) async throws {}
    func reload() async throws { if let current { select(current.uid, providers: current.providers) } }
    func unlink(_ provider: String, uid: String) async throws {}
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
