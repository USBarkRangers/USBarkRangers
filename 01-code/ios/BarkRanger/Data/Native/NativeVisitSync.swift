import BarkDomain
import Foundation

/// One coalesced drain. Ordered site overlaps are dependencies; a conflict at park A
/// cannot block an unrelated park B. The account lifecycle owns retries and cancellation.
actor NativeVisitSync {
    struct Result: Equatable, Sendable {
        let pendingCount: Int
        let needsDecision: Bool
        let retryAt: Date?
        let requiresAccessRefresh: Bool
    }
    private let store: NativeStore
    private let cloud: NativeVisitCloud
    private let jobs = NativeSyncJobs<String, Result>()
    init(store: NativeStore, cloud: NativeVisitCloud) {
        self.store = store
        self.cloud = cloud
    }
    func synchronize() async throws -> Result {
        try await jobs.run("visits") { try await self.run() }
    }
    func pause() async { await jobs.pause() }
    func resume() async throws { try await jobs.resume() }
    func stop() async {
        await jobs.close()
        await cloud.transport.close()
    }
    private func run() async throws -> Result {
        for _ in 0..<128 {
            try check()
            guard let pending = try await store.nextVisitSubmission() else { return try await result() }
            let command = pending.submission
            do {
                let references = pending.operation.changes.map {
                    NativeVisitReference(target: $0.intent.target)
                }
                if pending.operation.isBulk {
                    let outcome = try await cloud.submitBulk(command)
                    let selected = try await cloud.selection(references)
                    try check()
                    try await store.acceptNativeBulkVisitOutcome(outcome, selection: selected)
                } else {
                    let outcome = try await cloud.submit(command)
                    guard let reference = references.first else { throw NativeStore.Failure.corrupt }
                    let snapshot = try await cloud.visit(
                        id: reference.visitID, officialPlaceID: reference.officialPlaceID)
                    let selected = try NativeVisitSelection(snapshot: snapshot)
                    try check()
                    try await store.acceptNativeVisitOutcome(outcome, selection: selected)
                }
            } catch let failure as NativeCallableTransport.ServerFailure {
                try check()
                if [
                    "invalid", "operation-reused", "unsupported-contract", "premium-required",
                    "account-deleting",
                    "intent-expired", "forbidden",
                ].contains(failure.reason) {
                    try await store.rejectVisitOperation(command.id, code: failure.reason)
                    if ["premium-required", "account-deleting", "forbidden"].contains(failure.reason) {
                        return try await result(requiresAccessRefresh: true)
                    }
                    continue
                }
                guard ["unavailable", "rate-limited"].contains(failure.reason) else { throw failure }
                let retry = try await deferSubmission(
                    command, minimum: Double(max(1000, min(failure.retryAfterMs ?? 0, 3_600_000))) / 1000)
                // Temporary service/rate failures may be shared across sites. End this pass.
                return try await result(notBefore: retry)
            } catch {
                try check()
                guard (error as NSError).domain == NSURLErrorDomain else { throw error }
                let retry = try await deferSubmission(command, minimum: 1)
                return try await result(notBefore: retry)
            }
        }
        return try await result()
    }
    private func result(requiresAccessRefresh: Bool = false, notBefore: Date? = nil) async throws -> Result {
        let queue = try await store.visitQueue()
        var earlierSites = Set<String>()
        var retryAt: Date?
        for entry in queue {
            if !entry.needsDecision, earlierSites.isDisjoint(with: entry.keys.siteIDs), !requiresAccessRefresh
            {
                retryAt = min(retryAt ?? entry.retryAt, entry.retryAt)
            }
            earlierSites.formUnion(entry.keys.siteIDs)
        }
        return Result(
            pendingCount: queue.count, needsDecision: queue.contains(where: \.needsDecision),
            retryAt: retryAt.map { max($0, notBefore ?? $0) }, requiresAccessRefresh: requiresAccessRefresh)
    }
    private func deferSubmission(_ command: NativeStore.Submission, minimum: Double) async throws -> Date {
        let backoff = min(300, pow(2, Double(min(command.attempts + 1, 9))))
        let date = Date().addingTimeInterval(max(minimum, backoff * Double.random(in: 0.8...1.2)))
        try await store.deferVisitSubmission(command.id, until: date)
        return date
    }
    private func check() throws {
        try Task.checkCancellation()
    }
}
