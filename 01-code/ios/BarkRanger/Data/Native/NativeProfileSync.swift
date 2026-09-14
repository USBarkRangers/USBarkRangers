import BarkDomain
import Foundation

/// Profile bootstrap/confirmation policy. Other entities do not wait for profile conflicts.
actor NativeProfileSync {
    typealias Result = NativeMailroom.EntityResult
    private let store: NativeStore
    private let cloud: NativeProfileCloud
    private let jobs = NativeSyncJobs<String, Result>()
    private var freshness = NativeRefreshCadence()
    #if DEBUG
        func recordedDocumentReadCount() async -> Int { await cloud.documentReadCount }
    #endif
    init(store: NativeStore, cloud: NativeProfileCloud) {
        self.store = store
        self.cloud = cloud
    }
    func synchronize(refresh: Bool = true) async throws -> Result {
        do {
            return try await jobs.run("profile") {
                try await self.refreshIfNeeded(refresh)
                let stop = try await NativeMailroom.drain(
                    store: self.store, next: { try await self.next() },
                    reject: { try await self.store.rejectProfileOperation($0, code: $1) })
                switch stop {
                case .blocked: return .needsDecision
                case .retry(let date): return .retry(date)
                case .yielded: return .retry(Date())
                case .idle:
                    if try await self.store.profileView().conflict { return .needsDecision }
                    return try await self.store.profileRetryAt().map(Result.retry) ?? .current
                }
            }
        } catch NativeSyncAdmission.closed { throw NativeProfileCloud.Failure.accountChanged }
    }
    private func refreshIfNeeded(_ force: Bool) async throws {
        guard force || freshness.isDue(at: Date()) else { return }
        let remote = try await cloud.current()
        try Task.checkCancellation()
        if let profile = remote.profile, let entitlement = remote.entitlement {
            try await store.acceptProfile(profile)
            try await store.acceptEntitlement(entitlement)
            try Task.checkCancellation()
            freshness.accepted(at: Date())
        } else {
            let local = try await store.profileView()
            guard remote.profile == nil, local.confirmed == nil else {
                throw NativeProfileCloud.Failure.incomplete
            }
            if local.pendingCount == 0 { try await store.stageProfileEdit(.bootstrap) }
        }
    }
    private func next() async throws -> NativeMailroom.Delivery? {
        guard let command = try await store.nextProfileSubmission() else { return nil }
        return .init(command: command) { try await self.deliver(command) }
    }
    private func deliver(_ command: NativeStore.Submission) async throws {
        let outcome = try await cloud.submit(command)
        let canonical = try await cloud.current()
        try Task.checkCancellation()
        guard let profile = canonical.profile, let entitlement = canonical.entitlement else {
            throw NativeProfileCloud.Failure.incomplete
        }
        try await store.acceptProfileOutcome(outcome, canonical: profile)
        try await store.acceptEntitlement(entitlement)
        try Task.checkCancellation()
        freshness.accepted(at: Date())
    }
    func pause() async { await jobs.pause() }
    func resume() async throws {
        do { try await jobs.resume() } catch NativeSyncAdmission.closed {
            throw NativeProfileCloud.Failure.accountChanged
        }
    }
    func stop() async {
        await jobs.close()
        await cloud.close()
    }
}
