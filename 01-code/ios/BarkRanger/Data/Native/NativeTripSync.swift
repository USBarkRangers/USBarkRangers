import BarkDomain
import Foundation

/// The lifecycle schedules work; this worker owns no perpetual polling loop. An entity
/// conflict blocks that entity only. Cancellation never discards uncertain saved commands.
actor NativeTripSync {
    enum Result: Equatable, Sendable {
        case current, needsDecision
        case retry(Date)
    }
    private let store: NativeStore
    private let cloud: NativeTripCloud
    private let jobs = NativeSyncJobs<String, Result>()
    init(store: NativeStore, cloud: NativeTripCloud) {
        self.store = store
        self.cloud = cloud
    }

    func synchronize(_ id: String) async throws -> Result {
        try await jobs.run(id) { try await self.run(id) }
    }

    func pause() async { await jobs.pause() }
    func resume() async throws { try await jobs.resume() }

    func stop() async {
        await jobs.close()
        await cloud.transport.close()
    }

    private func run(_ id: String) async throws -> Result {
        // Intent already carries its exact revision/preimages. The server checks
        // them atomically; a preflight download cannot make the command safer.
        for _ in 0..<128 {
            try check()
            guard let command = try await store.nextTripSubmission(id: id) else {
                let state = try await store.tripQueueState(id)
                if state.needsDecision { return .needsDecision }
                if let retry = state.retryAt { return .retry(retry) }
                return .current
            }
            do {
                let outcome = try await cloud.submit(command)
                // Retain one canonical read: untouched notes may have changed on
                // another device. Never certify our projected preimage as server content.
                let confirmed = try await cloud.trip(id)
                try check()
                try await store.acceptTripOutcome(outcome, snapshot: confirmed)
            } catch let error as NativeCallableTransport.ServerFailure {
                try check()
                if [
                    "invalid", "operation-reused", "unsupported-contract", "premium-required",
                    "account-deleting", "intent-expired", "forbidden",
                ].contains(error.reason) {
                    try await store.rejectTripOperation(command.id, code: error.reason)
                    return .needsDecision
                }
                guard ["unavailable", "rate-limited"].contains(error.reason) else { throw error }
                return try await deferSubmission(
                    command, minimum: Double(max(1000, min(error.retryAfterMs ?? 0, 3_600_000))) / 1000)
            } catch {
                try check()
                guard NativeProfileCloud.isTransient(error) else { throw error }
                return try await deferSubmission(command, minimum: 1)
            }
        }
        return .retry(Date())
    }
    private func deferSubmission(_ command: NativeStore.Submission, minimum: Double) async throws -> Result {
        let backoff = min(300, pow(2, Double(min(command.attempts + 1, 9))))
        let date = Date().addingTimeInterval(max(minimum, backoff * Double.random(in: 0.8...1.2)))
        try await store.deferTripSubmission(command.id, until: date)
        return .retry(date)
    }
    private func check() throws {
        try Task.checkCancellation()
    }
}
