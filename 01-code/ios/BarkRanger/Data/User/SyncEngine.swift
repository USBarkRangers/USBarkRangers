import BarkDomain
import Foundation

/// A substitutable network boundary; every request carries UID, even when the SDK supplies its token.
nonisolated protocol CloudUserTransport: Sendable {
    func changes(uid: String, previous: PersonalSnapshot) async throws -> AsyncThrowingStream<
        CloudUserEvent, Error
    >
    func reconcile(uid: String, operations: [UserMutation]) async throws -> [CloudUserEvent]
    func submit(_ operation: UserMutation) async throws -> MutationReceipt
    func accountAction(_ action: ExistingAccountAction, uid: String) async throws -> URL?
    func selectActiveTrip(uid: String, id: String?) async throws
    func loadMoreTrips(uid: String) async throws -> CloudUserEvent?
    func acceptTripPage(uid: String, id: UUID) async throws
    func mutationReadBarrier(uid: String) async throws -> UInt64?
}
extension CloudUserTransport {
    func selectActiveTrip(uid: String, id: String?) async throws {}
    func loadMoreTrips(uid: String) async throws -> CloudUserEvent? { throw CloudUserClient.Failure.incomplete }
    func acceptTripPage(uid: String, id: UUID) async throws {}
    func mutationReadBarrier(uid: String) async throws -> UInt64? { nil }
}
nonisolated enum ExistingAccountAction: String, Sendable {
    case restore = "restoreNativeAccess"
    case billing = "getNativeBillingURL"
    case cancel = "cancelNativeSubscription"
    case delete = "deleteNativeAccount"
}

/// One live reader and one serial receipt worker per account; LocalStore remains the sole state writer.
actor SyncEngine {
    private let store: LocalStore
    private let cloud: any CloudUserTransport
    private let uid: String
    private let allowsMutations: Bool
    private let diagnostics: Diagnostics
    private var worker: Task<Bool, Never>?
    private var observation: Task<Void, Never>?
    private var page: Task<Void, Error>?
    private let observationFailed: @Sendable (Duration) -> Void
    private var readFailures = 0
    private var reconciliation: [UserMutation] = []
    private var generation = UUID()
    private var stopped = false
    init(
        store: LocalStore, cloud: any CloudUserTransport, uid: String,
        allowsMutations: Bool = true, diagnostics: Diagnostics = Diagnostics(),
        observationFailed: @escaping @Sendable (Duration) -> Void = { _ in }
    ) {
        self.allowsMutations = allowsMutations
        self.diagnostics = diagnostics
        self.store = store
        self.cloud = cloud
        self.uid = uid
        self.observationFailed = observationFailed
    }
    func flush(refresh: Bool = false) async -> Bool {
        guard !stopped else { return false }
        if let worker { return await worker.value }
        let generation = generation
        let task = Task { await self.run(refresh: refresh) }
        worker = task
        let success = await task.value
        if self.generation == generation { worker = nil }
        return success
    }
    private func run(refresh: Bool) async -> Bool {
        var succeeded = true
        var stage = Diagnostics.AccountStage.readStore
        do {
            try Task.checkCancellation()
            if observation == nil || refresh {
                // Preserve the existing local-write preflight before spending reads on a new baseline.
                _ = try await store.beginRead()
            }
            stage = .readCloud
            if refresh, let reader = observation {
                page?.cancel()
                _ = try? await page?.value
                page = nil
                observation = nil
                reader.cancel()
                await reader.value
            }
            try Task.checkCancellation()
            try await observeIfNeeded()
            stage = .readStore
            let pending = try await store.readSnapshot().pending
            var blocked = Set<String>()
            for item in allowsMutations ? pending : [] {
                try Task.checkCancellation()
                guard !stopped else { return false }
                if item.receipt != nil || item.retryAt.map({ $0 > Date() }) == true {
                    blocked.formUnion(item.operation.entityKeys)
                    continue
                }
                guard blocked.isDisjoint(with: item.operation.entityKeys) else {
                    blocked.formUnion(item.operation.entityKeys)
                    continue
                }
                do {
                    stage = .submit
                    if !reconciliation.contains(where: { $0.id == item.id }) {
                        reconciliation.append(item.operation)
                    }
                    let receipt = try await cloud.submit(item.operation)
                    try Task.checkCancellation()
                    guard !stopped else { return false }
                    stage = .acknowledge
                    try await store.acknowledge(receipt, cloudRevision: cloud.mutationReadBarrier(uid: uid))
                    if receipt.outcome != .accepted { blocked.formUnion(item.operation.entityKeys) }
                } catch let failure as MutationSubmissionFailure {
                    try Task.checkCancellation()
                    diagnostics.accountFailure(failure, at: .submit)
                    let receipt = MutationReceipt(
                        operation: item.operation, outcome: .rejected,
                        current: item.operation.content(in: try await store.readSnapshot().baseline),
                        reason: failure.reason)
                    stage = .acknowledge
                    try await store.acknowledge(receipt, cloudRevision: cloud.mutationReadBarrier(uid: uid))
                    blocked.formUnion(item.operation.entityKeys)
                } catch {
                    succeeded = false
                    try Task.checkCancellation()
                    diagnostics.accountFailure(error, at: stage)
                    stage = .readStore
                    try await store.recordRetry(
                        id: item.id, now: Date(), notBefore: (error as? MutationRetryFailure)?.retryAt)
                    blocked.formUnion(item.operation.entityKeys)
                }
            }
            if !reconciliation.isEmpty {
                stage = .readCloud
                let changes = try await cloud.reconcile(uid: uid, operations: reconciliation)
                try Task.checkCancellation()
                guard !stopped else { return false }
                stage = .saveSnapshot
                for change in changes { try await store.applyCloudEvent(change) }
                reconciliation.removeAll()
            }
        } catch {
            if !Task.isCancelled { readFailures += 1 }
            let failedStage: Diagnostics.AccountStage =
                stage == .readCloud && Diagnostics.accountReason(error) == .storage ? .saveSnapshot : stage
            diagnostics.accountFailure(error, at: failedStage)
            return false  // The saved baseline and durable intents remain intact.
        }
        if observation != nil { readFailures = 0 }
        return succeeded
    }
    /// Idle accounts need no timer: subscriptions carry remote changes. Only failed work retries.
    func nextDelay(now: Date = Date()) async -> Duration? {
        guard observation != nil, reconciliation.isEmpty else { return readRetryDelay }
        guard allowsMutations, let state = try? await store.readSnapshot() else { return nil }
        var seen = Set<String>()
        let delays = state.pending.compactMap { item -> Double? in
            let unblocked = seen.isDisjoint(with: item.operation.entityKeys)
            seen.formUnion(item.operation.entityKeys)
            guard unblocked, item.receipt == nil else { return nil }
            return max(1, item.retryAt?.timeIntervalSince(now) ?? 5)
        }
        return delays.min().map { .seconds($0) }
    }
    private func observeIfNeeded() async throws {
        guard observation == nil else { return }
        let generation = generation
        let state = try await store.readSnapshot()
        let previous = state.baseline
        try await cloud.selectActiveTrip(uid: uid, id: state.selectedTripID)
        let stream = try await cloud.changes(uid: uid, previous: previous)
        var iterator = stream.makeAsyncIterator()
        guard let initial = try await iterator.next() else { throw CloudUserClient.Failure.incomplete }
        try Task.checkCancellation()
        guard !stopped, self.generation == generation else { throw CancellationError() }
        guard initial.change.isInitial else { throw CloudUserClient.Failure.incomplete }
        try await store.applyCloudEvent(initial)
        try Task.checkCancellation()
        guard !stopped, self.generation == generation else { throw CancellationError() }
        observation = Task {
            do {
                // The bootstrap iterator has consumed exactly one event. This reader alone consumes the rest.
                for try await change in stream {
                    try Task.checkCancellation()
                    guard !self.stopped, self.generation == generation else { return }
                    try await self.store.applyCloudEvent(change)
                }
                if !Task.isCancelled { throw CloudUserClient.Failure.incomplete }
            } catch {
                guard !Task.isCancelled, self.generation == generation else { return }
                self.diagnostics.accountFailure(
                    error, at: Diagnostics.accountReason(error) == .storage ? .saveSnapshot : .readCloud)
                self.observation = nil
                self.page?.cancel()
                self.readFailures += 1
                self.observationFailed(self.readRetryDelay)
            }
        }
    }
    private var readRetryDelay: Duration {
        .seconds(min(300, 5 * pow(2, Double(min(6, max(0, readFailures - 1))))))
    }
    func selectActiveTrip(_ id: String?) async throws {
        guard !stopped, observation != nil else { return }
        try await cloud.selectActiveTrip(uid: uid, id: id)
    }
    func loadMoreTrips() async throws {
        guard !stopped, observation != nil else { throw CloudUserClient.Failure.incomplete }
        if let page { return try await page.value }
        let generation = generation
        let task = Task {
            guard let event = try await cloud.loadMoreTrips(uid: uid) else { return }
            try Task.checkCancellation()
            guard !stopped, self.generation == generation else { throw CancellationError() }
            try await store.applyCloudEvent(event)
            if case .tripPage(let value) = event.change { try await cloud.acceptTripPage(uid: uid, id: value.id) }
        }
        page = task
        defer { if self.generation == generation { page = nil } }
        try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
    }
    func stop() async {
        stopped = true
        await pause()
    }
    func pause() async {
        generation = UUID()
        let task = worker
        let reader = observation
        let page = page
        worker = nil
        observation = nil
        self.page = nil
        task?.cancel()
        reader?.cancel()
        page?.cancel()
        _ = await task?.value
        _ = await reader?.value
        _ = try? await page?.value
    }
}

/// Only definitive callable validation failures become visible rejections; transport failures retry.
nonisolated struct MutationSubmissionFailure: Error { let reason: String }
