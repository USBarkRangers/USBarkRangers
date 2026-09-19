import BarkDomain
import Foundation

/// Delivery mechanics only. Feature adapters select eligible work and accept typed
/// acknowledgments; the sole local writer seals bytes before this owner sends them.
nonisolated enum NativeMailroom {
    enum EntityResult: Equatable, Sendable {
        case current, needsDecision
        case retry(Date)
    }
    struct QueueResult: Equatable, Sendable {
        let pendingCount: Int
        let needsDecision: Bool
        let retryAt: Date?
        let requiresAccessRefresh: Bool
    }
    struct Delivery: Sendable {
        let command: NativeStore.Submission
        let send: @Sendable () async throws -> Void
    }
    enum Stop: Sendable {
        case idle, yielded, blocked(requiresAccessRefresh: Bool), retry(Date)
    }
    /// The one definition of the refusals every command can receive (envelope, access,
    /// receipt). Feature stores check against this same set before persisting a code, so a
    /// code added here is accepted everywhere; feature-only codes are a union with it.
    static let rejectionCodes: Set<String> = [
        "invalid", "operation-reused", "unsupported-contract", "premium-required",
        "account-deleting", "intent-expired", "forbidden",
    ]

    /// True only when the remote request completed enough to give a definitive bad response
    /// for this one independent operation or read, and continuing unrelated work cannot cause
    /// incorrect state to be accepted. The failed step committed nothing: acceptors roll back
    /// and a cursor moves only with its accepted page.
    ///
    /// Never add network or service unavailability, cancellation, an account change, local
    /// corruption or a storage failure here; those must end the pass. `DecodingError` and
    /// BarkDomain's validation failure are deliberately absent because local rows raise them
    /// too; the remote boundary must report a bad reply as `invalidReply` instead. Unknown
    /// errors are not isolatable.
    static func isIsolatableRemoteResponseFailure(_ error: any Error) -> Bool {
        if let server = error as? NativeCallableTransport.ServerFailure {
            return !["unavailable", "rate-limited"].contains(server.reason)
        }
        switch error {
        // invalidAcknowledgment: the reply contradicts what the store holds. staleRead: the
        // reply answers a request the store has since moved past. Both were refused whole.
        case NativeCallableTransport.Failure.invalidReply, NativeProfileCloud.Failure.invalidReply,
            NativeStore.Failure.invalidAcknowledgment, NativeStore.Failure.staleRead:
            return true
        default: return false
        }
    }

    static func drain(
        store: NativeStore,
        next: @Sendable () async throws -> Delivery?,
        reject: @Sendable (UUID, String) async throws -> Void,
        continueAfterRejection: Bool = false,
        rejectionCodes: Set<String> = rejectionCodes,
        retryable: @Sendable (any Error) -> Bool = { ($0 as NSError).domain == NSURLErrorDomain }
    ) async throws -> Stop {
        // A pass is bounded independently of storage capacity. Yielding schedules
        // another pass; it never limits how much offline work can be retained.
        for _ in 0..<NativeSyncPolicy.deliveryBatch {
            try Task.checkCancellation()
            try await store.resumeAuthorizedSubmissions()
            guard let delivery = try await next() else { return .idle }
            await store.publish([.pending])
            do {
                try await delivery.send()
                try Task.checkCancellation()
            } catch {
                try Task.checkCancellation()
                var minimum = 1.0
                if let failure = error as? NativeCallableTransport.ServerFailure {
                    if rejectionCodes.contains(failure.reason) {
                        try await reject(delivery.command.id, failure.reason)
                        let access = ["premium-required", "account-deleting", "forbidden"].contains(
                            failure.reason)
                        if !continueAfterRejection || access {
                            return .blocked(requiresAccessRefresh: access)
                        }
                        continue
                    }
                    guard ["unavailable", "rate-limited"].contains(failure.reason) else { throw error }
                    minimum = Double(max(1000, min(failure.retryAfterMs ?? 0, 3_600_000))) / 1000
                } else {
                    // A malformed response is not a reason for endless cloud reads.
                    guard retryable(error) else { throw error }
                }
                let backoff = min(300, pow(2, Double(min(delivery.command.attempts + 1, 9))))
                let date = Date().addingTimeInterval(max(minimum, backoff * Double.random(in: 0.8...1.2)))
                try await store.deferSubmission(delivery.command.id, until: date)
                return .retry(date)
            }
        }
        return .yielded
    }
}
