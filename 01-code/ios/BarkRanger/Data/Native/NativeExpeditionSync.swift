import BarkDomain
import Foundation

/// One uncertain command at a time, with exact-byte replay. A settled conflict only
/// blocks commands sharing its activity/run/selection dependencies.
actor NativeExpeditionSync {
    struct Result: Equatable, Sendable {
        let pendingCount: Int
        let needsDecision: Bool
        let retryAt: Date?
        let requiresAccessRefresh: Bool
    }
    private let store: NativeStore
    private let cloud: NativeExpeditionCloud
    private let jobs = NativeSyncJobs<String, Result>()
    init(store: NativeStore, cloud: NativeExpeditionCloud) {
        self.store = store
        self.cloud = cloud
    }
    func synchronize() async throws -> Result {
        try await jobs.run("expedition") { try await self.run() }
    }
    func pause() async { await jobs.pause() }
    func resume() async throws { try await jobs.resume() }
    /// The scope assembly closes the transport after all its consumers have drained.
    func stop() async { await jobs.close() }

    private func run() async throws -> Result {
        for _ in 0..<128 {
            try Task.checkCancellation()
            guard let pending = try await store.nextExpeditionSubmission() else { return try await result() }
            let command = pending.submission
            do {
                let outcome = try await cloud.submit(command)
                let snapshot = try await cloud.current(
                    activityID: pending.operation.action.activityID, runID: pending.operation.selectedRunID)
                try Task.checkCancellation()
                try await store.acceptNativeExpeditionOutcome(outcome, snapshot: snapshot)
            } catch NativeStore.Failure.staleRead {
                try Task.checkCancellation()
                return try await result(notBefore: deferSubmission(command, minimum: 1))
            } catch let failure as NativeCallableTransport.ServerFailure {
                try Task.checkCancellation()
                if NativeStore.expeditionRejectionCodes.contains(failure.reason) {
                    try await store.rejectExpeditionOperation(command.id, code: failure.reason)
                    if ["premium-required", "account-deleting", "forbidden"].contains(failure.reason) {
                        return try await result(requiresAccessRefresh: true)
                    }
                    continue
                }
                guard ["unavailable", "rate-limited"].contains(failure.reason) else { throw failure }
                let retry = try await deferSubmission(
                    command,
                    minimum: Double(max(1000, min(failure.retryAfterMs ?? 0, 3_600_000))) / 1000)
                return try await result(notBefore: retry)
            } catch {
                try Task.checkCancellation()
                guard (error as NSError).domain == NSURLErrorDomain else { throw error }
                return try await result(notBefore: deferSubmission(command, minimum: 1))
            }
        }
        return try await result()
    }
    private func result(requiresAccessRefresh: Bool = false, notBefore: Date? = nil) async throws -> Result {
        let queue = try await store.expeditionQueue()
        var retry: Date?
        if let uncertain = queue.first(where: { $0.state == "sealed" }) {
            retry = uncertain.retryAt
        } else {
            var earlier: [NativeExpeditionOperation.Keys] = []
            for entry in queue {
                if !entry.needsDecision, !earlier.contains(where: { $0.conflicts(with: entry.keys) }) {
                    retry = min(retry ?? entry.retryAt, entry.retryAt)
                }
                earlier.append(entry.keys)
            }
        }
        return .init(
            pendingCount: queue.count, needsDecision: queue.contains(where: \.needsDecision),
            retryAt: requiresAccessRefresh ? nil : retry.map { max($0, notBefore ?? $0) },
            requiresAccessRefresh: requiresAccessRefresh)
    }
    private func deferSubmission(_ command: NativeStore.Submission, minimum: Double) async throws -> Date {
        let backoff = min(300, pow(2, Double(min(command.attempts + 1, 9))))
        let date = Date().addingTimeInterval(max(minimum, backoff * Double.random(in: 0.8...1.2)))
        try await store.deferExpeditionSubmission(command.id, until: date)
        return date
    }
}
