import BarkDomain
import Foundation

/// One uncertain command at a time; settled conflicts block only overlapping dependencies.
actor NativeExpeditionSync {
    typealias Result = NativeMailroom.QueueResult
    private let store: NativeStore
    private let cloud: NativeExpeditionCloud
    private let jobs = NativeSyncJobs<String, Result>()
    init(store: NativeStore, cloud: NativeExpeditionCloud) {
        self.store = store
        self.cloud = cloud
    }
    func synchronize() async throws -> Result {
        try await jobs.run("expedition") {
            let stop = try await NativeMailroom.drain(
                store: self.store, next: { try await self.next() },
                reject: { try await self.store.rejectExpeditionOperation($0, code: $1) },
                continueAfterRejection: true, rejectionCodes: NativeStore.expeditionRejectionCodes,
                retryable: { error in
                    if case NativeStore.Failure.staleRead = error { return true }
                    return (error as NSError).domain == NSURLErrorDomain
                })
            return try await self.result(stop)
        }
    }
    private func next() async throws -> NativeMailroom.Delivery? {
        guard let pending = try await store.nextExpeditionSubmission() else { return nil }
        return .init(command: pending.submission) { [cloud, store] in
            let outcome = try await cloud.submit(pending.submission)
            let snapshot = try await cloud.current(
                activityID: pending.operation.action.activityID, runID: pending.operation.selectedRunID)
            try Task.checkCancellation()
            try await store.acceptNativeExpeditionOutcome(outcome, snapshot: snapshot)
        }
    }
    private func result(_ stop: NativeMailroom.Stop) async throws -> Result {
        let queue = try await store.expeditionQueue()
        let access: Bool
        if case .blocked(let value) = stop { access = value } else { access = false }
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
        if case .retry(let date) = stop { retry = retry.map { max($0, date) } }
        return .init(
            pendingCount: queue.count, needsDecision: queue.contains(where: \.needsDecision),
            retryAt: access ? nil : retry, requiresAccessRefresh: access)
    }
    func pause() async { await jobs.pause() }
    func resume() async throws { try await jobs.resume() }
    /// The scope assembly closes the shared transport after all consumers drain.
    func stop() async { await jobs.close() }
}
