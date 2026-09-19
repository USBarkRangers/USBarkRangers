import BarkDomain
@preconcurrency import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFunctions
import Foundation

/// The callable transport owns SDK values and account-lifetime checks, not feature state.
actor NativeCallableTransport {
    enum Failure: Error, Equatable { case wrongScope, accountChanged, invalidReply }
    struct ServerFailure: Error {
        let reason: String
        let retryAfterMs: Int?
    }
    private let uid: String
    private let auth: Auth
    private let functions: Functions
    private var closed = false
    #if DEBUG
        // Test instrumentation records operation names only, never account data or payloads.
        private var callKinds: [String] = []
        private var recordsCalls = false
        private var tripReplyBarrier: (@Sendable () async -> Void)?
        /// Emulator regression hook: hold a real SDK reply while metadata publications arrive.
        func setTripReplyBarrier(_ barrier: (@Sendable () async -> Void)?) {
            tripReplyBarrier = barrier
        }
        func recordedCallKinds(reset: Bool = false) -> [String] {
            recordsCalls = true
            let result = callKinds
            if reset { callKinds = [] }
            return result
        }
    #endif

    init(uid: String, auth: Auth) throws {
        guard !uid.isEmpty, !uid.contains("/"),
            let app = auth.app, ["bark-ranger-ios", "demo-bark-native"].contains(app.options.projectID ?? "")
        else { throw Failure.wrongScope }
        self.uid = uid
        self.auth = auth
        // Derive the destination from the verified app; never inject functions from another project.
        functions = Functions.functions(app: app, region: "us-east1")
    }
    func call<Input: Encodable & Sendable, Output: Decodable & Sendable>(
        _ endpoint: String,
        input: Input, as type: Output.Type
    ) async throws -> Output {
        try await callBytes(endpoint, bytes: JSONEncoder().encode(input), as: type)
    }
    func callBytes<Output: Decodable & Sendable>(_ endpoint: String, bytes: Data, as type: Output.Type)
        async throws -> Output
    {
        try check()
        guard ["nativeCommand", "nativeRead", "nativeDeleteAccount", "nativePurchase"].contains(endpoint),
            bytes.count <= 400_000
        else {
            throw Failure.invalidReply
        }
        let callable = functions.httpsCallable(endpoint)
        callable.timeoutInterval = endpoint == "nativePurchase" ? 60 : 30
        do {
            #if DEBUG
                if recordsCalls, let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                    let kind = object["kind"] as? String
                {
                    callKinds.append(kind)
                }
            #endif
            let reply = try await callable.call(JSONSerialization.jsonObject(with: bytes))
            #if DEBUG
                if let tripReplyBarrier,
                    let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                    object["kind"] as? String == "trip"
                {
                    await tripReplyBarrier()
                }
            #endif
            try check()
            return try Self.decodeReply(type, from: reply.data)
        } catch {
            try check()
            if let failure = Self.serverFailure(error) { throw failure }
            throw error
        }
    }
    /// A reply that does not have the expected shape is the server's invalid reply. It must
    /// not leave here as DecodingError, which the rest of the app reads as damaged local storage.
    nonisolated static func decodeReply<Output: Decodable>(_ type: Output.Type, from object: Any) throws
        -> Output
    {
        guard JSONSerialization.isValidJSONObject(object) else { throw Failure.invalidReply }
        do {
            return try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: object))
        } catch is DecodingError {
            throw Failure.invalidReply
        }
    }
    /// A freshly decoded reply that breaks its own contract is the server's invalid reply.
    /// Only for a value that just arrived from the server. Never for a local row or request
    /// input: bad local data must stay a storage error and end the pass.
    nonisolated static func validateReply(_ check: () throws -> Void) throws {
        do { try check() } catch { throw Failure.invalidReply }
    }
    nonisolated static func serverFailure(_ error: any Error) -> ServerFailure? {
        let failure = error as NSError
        guard failure.domain == FunctionsErrorDomain else { return nil }
        if let details = failure.userInfo[FunctionsErrorDetailsKey] as? [String: Any],
            details["contractVersion"] as? Int == 1, let reason = details["reason"] as? String
        {
            return ServerFailure(reason: reason, retryAfterMs: details["retryAfterMs"] as? Int)
        }
        // The SDK maps URL timeouts to deadlineExceeded and HTTP 503/429 to these
        // codes before a versioned application response exists. Their outcome is unknown.
        switch FunctionsErrorCode(rawValue: failure.code) {
        case .deadlineExceeded, .unavailable, .cancelled:
            return ServerFailure(reason: "unavailable", retryAfterMs: nil)
        case .resourceExhausted:
            return ServerFailure(reason: "rate-limited", retryAfterMs: 60_000)
        default: return nil  // Authentication, malformed responses and programming errors need attention.
        }
    }
    func close() { closed = true }
    private func check() throws {
        try Task.checkCancellation()
        guard !closed, auth.currentUser?.uid == uid else { throw Failure.accountChanged }
    }
}
