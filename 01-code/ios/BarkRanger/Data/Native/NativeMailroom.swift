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
        isolatingRemoteResponseFailures: Bool = false,
        rejectionCodes: Set<String> = rejectionCodes,
        retryable: @Sendable (any Error) -> Bool = { ($0 as NSError).domain == NSURLErrorDomain }
    ) async throws -> Stop {
        // Only for a lane whose selector already skips a deferred operation without blocking
        // unrelated entities (visits by site, saved pins by pin). There, one operation's bad
        // reply defers that operation and the lane goes on. Its outcome is unknown, so it
        // stays sealed with the same bytes and is never marked rejected. A lane-wide stop
        // (access refused, service unreachable) is reported as before; otherwise the first
        // such failure is thrown once the lane has nothing more to send. Chains (trips,
        // profile) and the one-uncertain-walk rule never pass this.
        var isolated: (any Error)?
        // A pass is bounded independently of storage capacity. Yielding schedules
        // another pass; it never limits how much offline work can be retained.
        for _ in 0..<NativeSyncPolicy.deliveryBatch {
            try Task.checkCancellation()
            try await store.resumeAuthorizedSubmissions()
            guard let delivery = try await next() else {
                if let isolated { throw isolated }
                return .idle
            }
            await store.publish([.pending])
            do {
                try await delivery.send()
                try Task.checkCancellation()
            } catch {
                try Task.checkCancellation()
                var minimum = 1.0
                // A failure the lane already retries as transient keeps that treatment.
                let isolate =
                    isolatingRemoteResponseFailures && !retryable(error)
                    && isIsolatableRemoteResponseFailure(error)
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
                    if ["unavailable", "rate-limited"].contains(failure.reason) {
                        minimum = Double(max(1000, min(failure.retryAfterMs ?? 0, 3_600_000))) / 1000
                    } else if !isolate {
                        throw error
                    }
                } else {
                    // A malformed response is not a reason for endless cloud reads.
                    guard retryable(error) || isolate else { throw error }
                }
                let backoff = min(300, pow(2, Double(min(delivery.command.attempts + 1, 9))))
                let date = Date().addingTimeInterval(max(minimum, backoff * Double.random(in: 0.8...1.2)))
                try await store.deferSubmission(delivery.command.id, until: date)
                // Transient failures are never isolatable, so this is the bad-reply path only.
                guard isolate else { return .retry(date) }
                if isolated == nil { isolated = error }
            }
        }
        if let isolated { throw isolated }
        return .yielded
    }
}
