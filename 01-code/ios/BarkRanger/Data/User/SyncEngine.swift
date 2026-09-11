import BarkDomain
import Foundation

/// A substitutable network boundary; every request carries UID, even when the SDK supplies its token.
nonisolated protocol CloudUserTransport: Sendable {
    func fetch(uid: String, previous: PersonalSnapshot) async throws -> PersonalSnapshot
    func submit(_ operation: UserMutation) async throws -> MutationReceipt
    func accountAction(_ action: ExistingAccountAction, uid: String) async throws -> URL?
}
nonisolated enum ExistingAccountAction: String, Sendable {
    case restore = "restoreNativeAccess"
    case billing = "getNativeBillingURL"
    case cancel = "cancelNativeSubscription"
    case delete = "deleteNativeAccount"
}

/// One cancellable worker per account. No Firestore write queue or parallel read/write reconciliation.
actor SyncEngine {
    private let store: LocalStore
    private let cloud: any CloudUserTransport
    private let uid: String
    private var worker: Task<Bool, Never>?
    private var generation = UUID()
    private var stopped = false
    init(store: LocalStore, cloud: any CloudUserTransport, uid: String) {
        self.store = store
        self.cloud = cloud
        self.uid = uid
    }
    func flush() async -> Bool {
        guard !stopped else { return false }
        if let worker { return await worker.value }
        let generation = generation
        let task = Task { await self.run() }
        worker = task
        let success = await task.value
        if self.generation == generation { worker = nil }
        return success
    }
    private func run() async -> Bool {
        var succeeded = true
        do {
            try Task.checkCancellation()
            let pending = try await store.readSnapshot().pending
            var blocked = Set<UserMutation.Kind>()
            for item in pending {
                try Task.checkCancellation()
                guard !stopped else { return false }
                if item.receipt != nil || item.retryAt.map({ $0 > Date() }) == true {
                    blocked.insert(item.operation.kind)
                    continue
                }
                guard !blocked.contains(item.operation.kind) else { continue }
                do {
                    let receipt = try await cloud.submit(item.operation)
                    try Task.checkCancellation()
                    guard !stopped else { return false }
                    try await store.acknowledge(receipt)
                    if receipt.outcome != .accepted { blocked.insert(item.operation.kind) }
                } catch let failure as MutationSubmissionFailure {
                    try Task.checkCancellation()
                    let receipt = MutationReceipt(
                        operation: item.operation, outcome: .rejected,
                        current: item.operation.content(in: try await store.readSnapshot().baseline.profile),
                        reason: failure.reason)
                    try await store.acknowledge(receipt)
                    blocked.insert(item.operation.kind)
                } catch {
                    succeeded = false
                    try Task.checkCancellation()
                    try await store.recordRetry(id: item.id, now: Date())
                    blocked.insert(item.operation.kind)
                }
            }
            // Reconcile receipts first, then read current state. A retried old receipt cannot overwrite
            // a newer web edit that the following authoritative read already contains.
            let sequence = try await store.beginRead()
            let previous = try await store.readSnapshot().baseline
            let remote = try await cloud.fetch(uid: uid, previous: previous)
            try Task.checkCancellation()
            guard !stopped else { return false }
            try await store.applyServerSnapshot(remote, sequence: sequence)
        } catch {
            return false  // The saved baseline and durable intents remain intact.
        }
        return succeeded
    }
    /// Retry only the first unresolved intent for each field. Idle accounts refresh at most every five minutes.
    func nextDelay(now: Date = Date()) async -> Duration {
        guard let state = try? await store.readSnapshot() else { return .seconds(300) }
        var seen = Set<UserMutation.Kind>()
        let delays = state.pending.compactMap { item -> Double? in
            guard seen.insert(item.operation.kind).inserted, item.receipt == nil else { return nil }
            return max(1, item.retryAt?.timeIntervalSince(now) ?? 5)
        }
        return .seconds(min(300, delays.min() ?? 300))
    }
    func stop() async {
        stopped = true
        await pause()
    }
    func pause() async {
        generation = UUID()
        let task = worker
        worker = nil
        task?.cancel()
        _ = await task?.value
    }
}

/// Only definitive callable validation failures become visible rejections; transport failures retry.
nonisolated struct MutationSubmissionFailure: Error { let reason: String }
