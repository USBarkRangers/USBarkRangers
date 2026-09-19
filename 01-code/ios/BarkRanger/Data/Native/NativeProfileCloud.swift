import BarkDomain
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
import Foundation

/// One account lifetime, exact small document reads and one typed command endpoint.
/// No user dictionary, SDK snapshot, or account-wide archive leaves this adapter.
actor NativeProfileCloud {
    enum Failure: Error, Equatable { case wrongScope, accountChanged, incomplete, invalidReply }
    struct Snapshot: Sendable {
        let profile: NativeProfile?
        let entitlement: NativeEntitlement?
    }
    typealias SubmissionFailure = NativeCallableTransport.ServerFailure
    private let uid: String
    private let auth: Auth
    private let db: Firestore
    private let transport: NativeCallableTransport
    private var closed = false
    #if DEBUG
        // Bounded request-count evidence; no document contents or identities recorded.
        private(set) var documentReadCount = 0
    #endif

    init(uid: String, auth: Auth, db: Firestore) throws {
        guard !uid.isEmpty, !uid.contains("/"),
            let project = auth.app?.options.projectID,
            ["bark-ranger-ios", "demo-bark-native"].contains(project),
            db.app.options.projectID == project
        else { throw Failure.wrongScope }
        self.uid = uid
        self.auth = auth
        self.db = db
        transport = try NativeCallableTransport(uid: uid, auth: auth)
    }

    func current() async throws -> Snapshot {
        try check()
        let user = db.collection("users").document(uid)
        #if DEBUG
            documentReadCount += 1
        #endif
        let profileDocument = try await user.getDocument(source: .server)
        try check()
        guard !profileDocument.metadata.isFromCache else { throw Failure.incomplete }
        guard profileDocument.exists else { return Snapshot(profile: nil, entitlement: nil) }
        // These documents just arrived from the server. One of the wrong shape, or one that
        // breaks its own contract, is an invalid reply and never damaged local storage.
        let profile: NativeProfile
        do {
            profile = try profileDocument.data(as: NativeProfile.self)
            try profile.validate()
        } catch {
            throw Failure.invalidReply
        }
        #if DEBUG
            documentReadCount += 1
        #endif
        let entitlementDocument = try await user.collection("state").document("entitlement").getDocument(
            source: .server)
        try check()
        guard entitlementDocument.exists, !entitlementDocument.metadata.isFromCache else {
            throw Failure.incomplete
        }
        let entitlement: NativeEntitlement
        do {
            entitlement = try entitlementDocument.data(as: EntitlementDocument.self).projection()
        } catch {
            throw Failure.invalidReply
        }
        return Snapshot(profile: profile, entitlement: entitlement)
    }

    func submit(_ submission: NativeStore.Submission) async throws -> NativeProfileOutcome {
        try check()
        try NativeCallableTransport.checkRequest(endpoint: "nativeCommand", bytes: submission.bytes)
        let outcome = try await transport.callBytes(
            "nativeCommand", bytes: submission.bytes, as: NativeProfileOutcome.self)
        try check()
        guard outcome.version == 1, outcome.operationID == submission.id,
            (1...9_007_199_254_740_991).contains(outcome.revisions.profile)
        else { throw Failure.invalidReply }
        return outcome
    }

    /// The ordered account lifecycle closes this before opening another account's projections.
    func close() async {
        closed = true
        await transport.close()
    }
    /// Retry only known network/service failures. A corrupt response, permission
    /// denial or unsupported schema must not become an automatic read loop.
    nonisolated static func isTransient(_ error: any Error) -> Bool {
        let failure = error as NSError
        if failure.domain == NSURLErrorDomain {
            return [
                .timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost,
                .dnsLookupFailed, .notConnectedToInternet,
            ].contains(URLError.Code(rawValue: failure.code))
        }
        if failure.domain == FirestoreErrorDomain {
            return [FirestoreErrorCode.deadlineExceeded, .unavailable, .aborted, .resourceExhausted]
                .map(\.rawValue).contains(failure.code)
        }
        if failure.domain == AuthErrors.domain {
            return failure.code == AuthErrorCode.networkError.rawValue
        }
        if let server = error as? SubmissionFailure {
            return ["unavailable", "rate-limited"].contains(server.reason)
        }
        return false
    }
    private func check() throws {
        try Task.checkCancellation()
        guard !closed, auth.currentUser?.uid == uid else { throw Failure.accountChanged }
    }
}

nonisolated private struct EntitlementDocument: Decodable {
    let schemaVersion: Int
    let revision: Int64
    let premium: Bool
    let source: NativeEntitlement.Source
    let validUntil: Date?

    func projection() throws -> NativeEntitlement {
        let milliseconds = validUntil.map { $0.timeIntervalSince1970 * 1000 }
        guard milliseconds.map({ $0.isFinite && (0...9_007_199_254_740_991).contains($0) }) ?? true else {
            throw NativeProfileCloud.Failure.invalidReply
        }
        let value = NativeEntitlement(
            revision: revision, premium: premium, source: source,
            validUntilMs: milliseconds.map(Int64.init), schemaVersion: schemaVersion)
        try value.validate()
        return value
    }
}
