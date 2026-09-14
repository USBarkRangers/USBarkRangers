import BarkDomain
import Foundation
import Observation

/// Account-owned current walk state and durable outbox. A stored history cursor is
/// recovery state, never permission to fetch an archive while its screen is closed.
@MainActor @Observable final class NativeExpeditionFeature {
    let scope: String
    let repository: NativeExpeditionRepository
    private(set) var overview: NativeStore.ExpeditionOverview?
    private(set) var completed: [NativeCompletedTrails.Item] = []
    private var completionsConfirmed = false
    var completedCount: Int? {
        completionsConfirmed || !completed.isEmpty ? completed.count : nil
    }
    private(set) var sync: NativeFeatureSync?
    private(set) var message: String?
    private var observation: Task<Void, Never>?
    private let worker: NativeExpeditionSync?
    private var scanRequested = false
    private var historyReaders: Set<UUID> = []
    private var completionFreshness = NativeRefreshCadence()
    private var closed = false
    private let refreshAccess: @MainActor () -> Void

    init(
        scope: String, store: NativeStore, cloud: NativeExpeditionCloud?,
        refreshAccess: @escaping @MainActor () -> Void = {}
    ) {
        self.scope = scope
        repository = .init(store: store, cloud: cloud)
        worker = cloud.map { NativeExpeditionSync(store: store, cloud: $0) }
        self.refreshAccess = refreshAccess
    }
    func start() async throws {
        overview = try await repository.store.nativeExpeditionOverview()
        completed = try await repository.store.nativeCompletedTrails()
        let worker = worker
        sync = NativeFeatureSync(
            label: "Walks",
            work: { [weak self] refresh in
                try await self?.synchronize(refresh: refresh)
            }, pause: { await worker?.pause() })
        observation = Task { [weak self, store = repository.store] in
            do {
                for await changes in try await store.changes(matching: [
                    .expedition, .completedTrails, .completionClaimed,
                ]) {
                    guard let self, !Task.isCancelled, !self.closed else { return }
                    let previous = self.overview?.pendingIDs ?? []
                    let value = try await store.nativeExpeditionOverview()
                    let completed = try await store.nativeCompletedTrails()
                    guard !Task.isCancelled, !self.closed else { return }
                    self.overview = value
                    self.completed = completed
                    if changes.contains(.completedTrails) { self.completionsConfirmed = true }
                    if !Set(value.pendingIDs).subtracting(previous).isEmpty { self.sync?.request() }
                    if changes.contains(.completionClaimed) {
                        self.refreshCompletions = true
                        self.sync?.request()
                    }
                }
            } catch {
                guard let self, !Task.isCancelled, !self.closed else { return }
                self.message = "Walk data could not be read. Your original files are retained."
            }
        }
    }
    private var refreshCompletions = false
    private func synchronize(refresh: Bool) async throws -> Date? {
        guard let worker, let cloud = repository.cloud else { return nil }
        try await worker.resume()
        let result = try await worker.synchronize()
        if result.requiresAccessRefresh { refreshAccess() }
        try Task.checkCancellation()
        if refresh {
            try await repository.store.acceptNativeExpedition(cloud.current())
            scanRequested = !historyReaders.isEmpty
        }
        if !historyReaders.isEmpty, completionFreshness.isDue(at: Date()) { refreshCompletions = true }
        if refreshCompletions {
            refreshCompletions = false
            do {
                try await repository.store.acceptNativeCompletedTrails(cloud.completedTrails())
                try Task.checkCancellation()
                completionFreshness.accepted(at: Date())
            } catch {
                refreshCompletions = true
                throw error
            }
        }
        if scanRequested {
            for _ in 0..<4 {
                guard !historyReaders.isEmpty else {
                    scanRequested = false
                    break
                }
                guard let query = try await repository.store.activityChangesQuery() else {
                    scanRequested = false
                    break
                }
                let page = try await cloud.changes(query)
                try Task.checkCancellation()
                if page.needsBootstrap {
                    guard !historyReaders.isEmpty else {
                        scanRequested = false
                        break
                    }
                    let initial = try await cloud.history()
                    if try await repository.store.acceptNativeActivityHistory(
                        initial, after: nil, bootstrap: true)
                    {
                        scanRequested = false
                        break
                    }
                } else if try await repository.store.acceptNativeActivityChanges(page, requested: query),
                    page.next == nil
                {
                    scanRequested = false
                    break
                }
            }
        }
        return scanRequested ? Date().addingTimeInterval(1) : result.retryAt
    }

    /// Explicit account refresh may revalidate completions; ordinary outbox wakes do not.
    func requestSync(refresh: Bool = false) {
        if refresh { refreshCompletions = true }
        sync?.request(refresh: refresh)
    }

    func requestCompletedTrails() {
        if completionFreshness.isDue(at: Date()) { refreshCompletions = true }
        sync?.request()
    }

    /// Leases prevent a cancelled old view task from closing a newer view's demand.
    /// Closing stops further pages; an already-issued response may still be accepted.
    func beginHistory() -> UUID {
        let token = UUID()
        historyReaders.insert(token)
        scanRequested = true
        requestCompletedTrails()
        return token
    }
    func endHistory(_ token: UUID) {
        historyReaders.remove(token)
        if historyReaders.isEmpty { scanRequested = false }
    }
    func close() async {
        closed = true
        observation?.cancel()
        await sync?.close()
        await observation?.value
        await worker?.stop()
        await repository.cloud?.transport.close()
    }
}
