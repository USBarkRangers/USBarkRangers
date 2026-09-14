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
    func credential(_ credential: AuthCredential, use: CredentialUse, uid: String?) async throws {
        credentialUses.append(use)
    }
    func password(_ email: String, password: String, use: CredentialUse, uid: String?) async throws {}
    func resetPassword(email: String) async throws { passwordResets += 1 }
    func verifyEmail(uid: String) async throws {}
    func reload() async throws { if let current { select(current.uid) } }
    func unlink(_ provider: String, uid: String) async throws {}
    func revokeApple(authorizationCode: String) async throws {}
}

actor ControlledUserCloud: CloudUserTransport {
    private let clock = CloudUserEventClock()
    private var streams: [String: AsyncThrowingStream<CloudUserEvent, Error>.Continuation] = [:]
    private(set) var observationStarts = 0
    private(set) var reconciliations = 0
    func changes(uid: String, previous: PersonalSnapshot) async throws -> AsyncThrowingStream<
        CloudUserEvent, Error
    > {
        observationStarts += 1
        let initial = try await fetch(uid: uid, previous: previous)
        let (stream, continuation) = AsyncThrowingStream<CloudUserEvent, Error>.makeStream()
        streams[uid] = continuation
        continuation.yield(CloudUserEvent(change: .initial(initial), revision: clock.next()))
        return stream
    }
    func emit(_ change: CloudUserChange, uid: String) {
        streams[uid]?.yield(CloudUserEvent(change: change, revision: clock.next()))
    }
    func endObservation(uid: String) { streams[uid]?.finish(throwing: URLError(.networkConnectionLost)) }
    func reconcile(uid: String, operations: [UserMutation]) async throws -> [CloudUserEvent] {
        reconciliations += 1
        if let readFailure { throw readFailure }
        return [
            CloudUserEvent(
                change: .profile(profiles[uid] ?? UserProfile(), confirmedAt: Date()), revision: clock.next())
        ]
    }
    private var readFailure: (any Error)?
    func failReads(with error: any Error) { readFailure = error }
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
        emit(.profile(profiles[uid] ?? UserProfile(), confirmedAt: Date()), uid: uid)
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
        if let readFailure { throw readFailure }
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

extension AccountCapabilities {
    static var editableTest: Self {
        .init(profileWrites: true, authenticationChanges: true, accountManagement: true)
    }
}

extension LocalStore {
    func seedPremium() throws {
        var snapshot = try readSnapshot().baseline
        snapshot.profile.fields["entitlement"] = .object([
            "premium": .bool(true), "status": .string("active"),
        ])
        snapshot.confirmedAt = Date()
        try applyServerSnapshot(snapshot, sequence: beginRead())
    }
}
