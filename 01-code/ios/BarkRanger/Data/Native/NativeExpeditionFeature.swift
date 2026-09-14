import BarkDomain
import Foundation
import Observation

/// Account-owned current walk state. Full history is not loaded on account startup;
/// its incremental cursor is activated only after someone opens history.
@MainActor @Observable final class NativeExpeditionFeature {
    let scope: String
    let repository: NativeExpeditionRepository
    private(set) var overview: NativeStore.ExpeditionOverview?
    private(set) var completed: [NativeCompletedTrails.Item] = []
    private(set) var sync: NativeFeatureSync?
    private(set) var message: String?
    private var observation: Task<Void, Never>?
    private let worker: NativeExpeditionSync?
    private var scanRequested = false
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
            scanRequested = try await repository.store.activityChangesQuery() != nil
        }
        if refresh || refreshCompletions {
            refreshCompletions = false
            do { try await repository.store.acceptNativeCompletedTrails(cloud.completedTrails()) } catch {
                refreshCompletions = true
                throw error
            }
        }
        if scanRequested {
            for _ in 0..<4 {
                guard let query = try await repository.store.activityChangesQuery() else {
                    scanRequested = false
                    break
                }
                let page = try await cloud.changes(query)
                try Task.checkCancellation()
                if page.needsBootstrap {
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
    func close() async {
        closed = true
        observation?.cancel()
        await sync?.close()
        await observation?.value
        await worker?.stop()
        await repository.cloud?.transport.close()
    }
}
