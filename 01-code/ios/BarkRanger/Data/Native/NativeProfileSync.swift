import BarkDomain
import Foundation

/// Coalesces refreshes and drains only this entity's durable queue. Account lifecycle
/// owns this worker; a profile conflict must not stop other entity workers.
actor NativeProfileSync {
    enum Result: Equatable, Sendable {
        case current, needsDecision
        case retry(Date)
    }
    private let store: NativeStore
    private let cloud: NativeProfileCloud
    private let jobs = NativeSyncJobs<String, Result>()
    private var closed = false
    private var freshness = NativeRefreshCadence()
    #if DEBUG
        func recordedDocumentReadCount() async -> Int { await cloud.documentReadCount }
    #endif

    init(store: NativeStore, cloud: NativeProfileCloud) {
        self.store = store
        self.cloud = cloud
    }

    func synchronize(refresh: Bool = true) async throws -> Result {
        try check()
        do {
            return try await jobs.run("profile") { try await self.run(refresh: refresh) }
        } catch NativeSyncAdmission.closed { throw NativeProfileCloud.Failure.accountChanged }
    }

    func pause() async { await jobs.pause() }
    func resume() async throws {
        try check()
        try await jobs.resume()
    }

    /// Close admission and invalidate remote callbacks before the lifecycle drains/closes
    /// the shared local writer. Cancelling an uncertain request never discards its intent.
    func stop() async {
        closed = true
        await jobs.close()
        await cloud.close()
    }

    private func run(refresh: Bool) async throws -> Result {
        if refresh || freshness.isDue(at: Date()) {
            let remote = try await cloud.current()
            try check()
            if let profile = remote.profile, let entitlement = remote.entitlement {
                try await store.acceptProfile(profile)
                try check()
                try await store.acceptEntitlement(entitlement)
                try check()
                freshness.accepted(at: Date())
            } else {
                let local = try await store.profileView()
                guard remote.profile == nil, local.confirmed == nil else {
                    throw NativeProfileCloud.Failure.incomplete
                }
                if local.pendingCount == 0 { try await store.stageProfileEdit(.bootstrap) }
            }
        }
        // Bound one drain pass. The account lifecycle schedules the next pass/retry;
        // there is no polling timer, recursive retry or unbounded history scan here.
        for _ in 0..<128 {
            try check()
            guard let command = try await store.nextProfileSubmission() else {
                if try await store.profileView().conflict { return .needsDecision }
                if let date = try await store.profileRetryAt() { return .retry(date) }
                return .current
            }
            do {
                let outcome = try await cloud.submit(command)
                let canonical = try await cloud.current()
                try check()
                guard let profile = canonical.profile, let entitlement = canonical.entitlement else {
                    throw NativeProfileCloud.Failure.incomplete
                }
                try await store.acceptProfileOutcome(outcome, canonical: profile)
                try check()
                try await store.acceptEntitlement(entitlement)
                try check()
                freshness.accepted(at: Date())
            } catch let failure as NativeProfileCloud.SubmissionFailure {
                try check()
                let permanent = [
                    "invalid", "operation-reused", "unsupported-contract", "premium-required",
                    "account-deleting", "intent-expired", "forbidden",
                ]
                if permanent.contains(failure.reason) {
                    try await store.rejectProfileOperation(command.id, code: failure.reason)
                    return .needsDecision
                }
                guard ["unavailable", "rate-limited"].contains(failure.reason) else { throw failure }
                let serverDelay = Double(max(1000, min(failure.retryAfterMs ?? 0, 3_600_000))) / 1000
                return try await scheduleRetry(command, minimum: serverDelay)
            } catch {
                try check()
                let error = error as NSError
                // Unknown/corrupt replies require attention; only transport failures get backoff.
                guard error.domain == NSURLErrorDomain else { throw error }
                return try await scheduleRetry(command, minimum: 1)
            }
        }
        return .retry(Date())
    }

    private func scheduleRetry(_ command: NativeStore.Submission, minimum: Double) async throws -> Result {
        let backoff = min(300, pow(2, Double(min(command.attempts + 1, 9))))
        let date = Date().addingTimeInterval(max(minimum, backoff * Double.random(in: 0.8...1.2)))
        try await store.deferProfileSubmission(command.id, until: date)
        return .retry(date)
    }
    private func check() throws {
        try Task.checkCancellation()
        if closed { throw NativeProfileCloud.Failure.accountChanged }
    }
}
