import BarkDomain
import Foundation

/// Trip ordering and canonical confirmation; delivery/retry mechanics are shared.
actor NativeTripSync {
    typealias Result = NativeMailroom.EntityResult
    private let store: NativeStore
    private let cloud: NativeTripCloud
    private let jobs = NativeSyncJobs<String, Result>()
    init(store: NativeStore, cloud: NativeTripCloud) {
        self.store = store
        self.cloud = cloud
    }
    func synchronize(_ id: String) async throws -> Result {
        try await jobs.run(id) {
            let stop = try await NativeMailroom.drain(
                store: self.store,
                next: { try await self.next(id) },
                reject: { try await self.store.rejectTripOperation($0, code: $1) },
                retryable: { NativeProfileCloud.isTransient($0) })
            switch stop {
            case .blocked: return .needsDecision
            case .retry(let date): return .retry(date)
            case .yielded: return .retry(Date())
            case .idle:
                let state = try await self.store.tripQueueState(id)
                if state.needsDecision { return .needsDecision }
                return state.retryAt.map(Result.retry) ?? .current
            }
        }
    }
    private func next(_ id: String) async throws -> NativeMailroom.Delivery? {
        guard let command = try await store.nextTripSubmission(id: id) else { return nil }
        return .init(command: command) { [cloud, store] in
            let outcome = try await cloud.submit(command)
            // Untouched notes may have changed elsewhere. Confirm canonical content.
            let confirmed = try await cloud.trip(id)
            try Task.checkCancellation()
            try await store.acceptTripOutcome(outcome, snapshot: confirmed)
        }
    }
    func pause() async { await jobs.pause() }
    func resume() async throws { try await jobs.resume() }
    func stop() async {
        await jobs.close()
        await cloud.transport.close()
    }
}
