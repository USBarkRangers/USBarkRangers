import BarkDomain
import Foundation
import Observation

/// Account-owned current markers and confirmed progress, not an archive or identity owner.
/// History belongs to its on-demand screen; note/trip events never rebuild this projection.
@MainActor @Observable final class NativeVisitFeature {
    let scope: String
    let repository: NativeVisitRepository
    private(set) var overview: NativeStore.VisitOverview?
    private(set) var message: String?
    private var observation: Task<Void, Never>?
    private let worker: NativeVisitSync?
    private var scanRequested = false
    private var dailyRequested = false
    private var closed = false
    private(set) var sync: NativeFeatureSync?
    private let refreshAccess: @MainActor () -> Void

    init(
        scope: String, store: NativeStore, cloud: NativeVisitCloud?,
        refreshAccess: @escaping @MainActor () -> Void = {}
    ) {
        self.scope = scope
        repository = NativeVisitRepository(store: store, cloud: cloud)
        worker = cloud.map { NativeVisitSync(store: store, cloud: $0) }
        self.refreshAccess = refreshAccess
    }
    func start() async throws {
        overview = try await repository.store.nativeVisitOverview()
        let worker = worker
        sync = NativeFeatureSync(
            label: "Visits",
            work: { [weak self] refresh in
                try await self?.synchronize(refresh: refresh)
            }, pause: { await worker?.pause() })
        observation = Task { [weak self, store = repository.store] in
            do {
                for await _ in try await store.changes(matching: [.markers, .progress]) {
                    guard let self, !Task.isCancelled, !self.closed else { return }
                    let previous = self.overview?.pendingIDs ?? []
                    let value = try await store.nativeVisitOverview()
                    guard !Task.isCancelled, !self.closed else { return }
                    self.overview = value
                    if !Set(value.pendingIDs).subtracting(previous).isEmpty { self.sync?.request() }
                }
            } catch {
                guard let self, !Task.isCancelled, !self.closed else { return }
                self.message = "Visit data could not be read. Your original files are retained."
            }
        }
    }
    private func synchronize(refresh: Bool) async throws -> Date? {
        guard let worker, let cloud = repository.cloud else { return nil }
        try await worker.resume()
        let result = try await worker.synchronize()
        if result.requiresAccessRefresh { refreshAccess() }
        try Task.checkCancellation()
        if refresh {
            try await repository.store.acceptNativeProgress(cloud.progress())
            scanRequested = true
        }
        if dailyRequested {
            let today = AchievementPolicy.dayKey(Date(), timeZone: .current)
            if try await repository.store.nativeProgress()?.lastStreakDay != today {
                try await repository.store.acceptNativeProgress(
                    cloud.recordDay(today, timeZone: TimeZone.current.identifier))
            }
            dailyRequested = false
        }
        if scanRequested {
            // Four bounded pages per turn. Resuming uses the durable exact cursor,
            // not another history download or an always-on collection listener.
            for _ in 0..<4 {
                let query = try await repository.store.markerChangesQuery()
                let page = try await cloud.markers(query)
                try Task.checkCancellation()
                if try await repository.store.acceptMarkerChanges(page, requested: query), page.next == nil {
                    scanRequested = false
                    break
                }
            }
        }
        return scanRequested ? Date().addingTimeInterval(1) : result.retryAt
    }
    func recordActivity() {
        dailyRequested = true
        sync?.request()
    }
    func close() async {
        closed = true
        observation?.cancel()
        await sync?.close()
        await observation?.value
        await worker?.stop()
    }
}
