import BarkDomain
import FirebaseAuth
import Foundation

@testable import BarkRanger

@MainActor final class SyntheticAuth: AccountAuthenticating {
    let isTest = true
    private var continuation: AsyncStream<AccountIdentity?>.Continuation?
    var signOutFails = false
    private var current: AccountIdentity?
    func changes() -> AsyncStream<AccountIdentity?> {
        let (stream, continuation) = AsyncStream<AccountIdentity?>.makeStream(
            bufferingPolicy: .bufferingNewest(1))
        self.continuation = continuation
        continuation.yield(current)
        return stream
    }
    func select(_ uid: String?, confirmed: Bool = true) {
        current = uid.map {
            AccountIdentity(
                uid: $0, email: "\($0)@example.test", displayName: $0,
                verified: true, providers: ["password"], serverConfirmed: confirmed)
        }
        continuation?.yield(current)
    }
    func signOut() throws {
        if signOutFails { throw AccountFailure.configuration }
        select(nil)
    }
    func email(_ email: String, password: String, create: Bool) async throws { select(email) }
    func credential(_ credential: AuthCredential, use: CredentialUse, uid: String?) async throws {}
    func password(_ email: String, password: String, use: CredentialUse, uid: String?) async throws {}
    func resetPassword(email: String) async throws {}
    func verifyEmail(uid: String) async throws {}
    func reload() async throws { if let current { select(current.uid) } }
    func unlink(_ provider: String, uid: String) async throws {}
    func revokeApple(authorizationCode: String) async throws {}
}

actor ControlledUserCloud: CloudUserTransport {
    private var heldUID: String?
    private var waiting: CheckedContinuation<Void, Never>?
    private(set) var submissions: [UserMutation] = []
    private(set) var reads = 0
    var loseFirstResponse = false
    private var rejection = false
    func rejectChanges() { rejection = true }
    private var receipts: [String: MutationReceipt] = [:]
    private var profiles: [String: UserProfile] = [:]
    func setServerName(_ name: String, uid: String) {
        profiles[uid] = UserProfile(fields: ["displayName": .string(name), "username": .string(name)])
    }
    func loseResponse() { loseFirstResponse = true }
    func hold(_ uid: String) { heldUID = uid }
    func isWaiting() -> Bool { waiting != nil }
    func release() {
        heldUID = nil
        waiting?.resume()
        waiting = nil
    }
    func fetch(uid: String, previous: PersonalSnapshot) async throws -> PersonalSnapshot {
        reads += 1
        if heldUID == uid { await withCheckedContinuation { waiting = $0 } }
        return PersonalSnapshot(
            uid: uid,
            profile: profiles[uid] ?? .init(fields: ["displayName": .string(uid), "username": .string(uid)]),
            confirmedAt: Date())
    }
    func submit(_ operation: UserMutation) async throws -> MutationReceipt {
        submissions.append(operation)
        if rejection { throw MutationSubmissionFailure(reason: "rejected-test") }
        if receipts[operation.id] == nil {
            receipts[operation.id] = .init(
                operation: operation, outcome: .accepted, current: operation.expected)
            profiles[operation.uid] = operation.applying(to: profiles[operation.uid] ?? UserProfile())
        }
        if loseFirstResponse {
            loseFirstResponse = false
            throw URLError(.networkConnectionLost)
        }
        return receipts[operation.id] ?? .init(operation: operation, outcome: .rejected, current: .null)
    }
    func accountAction(_ action: ExistingAccountAction, uid: String) async throws -> URL? { nil }
}
