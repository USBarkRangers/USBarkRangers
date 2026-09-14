import Foundation
import Observation

/// Foreground scheduling shared by visits and walks. Feature work owns its queries
/// and conflict rules; this owner only coalesces requests, pauses, drains and retries.
@MainActor @Observable final class NativeFeatureSync {
    private(set) var message: String?
    private(set) var running = false
    private var permitted = false
    private var closed = false
    private var requested = false
    private var refreshRequested = false
    private var flight: Task<Void, Never>?
    private var retry: Task<Void, Never>?
    private var drain: Task<Void, Never>?
    private let label: String
    private let work: @MainActor (Bool) async throws -> Date?
    private let pauseWork: @Sendable () async -> Void
    private var freshness = NativeRefreshCadence()
    private let now: @MainActor () -> Date

    init(
        label: String, work: @escaping @MainActor (Bool) async throws -> Date?,
        pause: @escaping @Sendable () async -> Void,
        now: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.label = label
        self.work = work
        pauseWork = pause
        self.now = now
    }
    func setAllowed(_ allowed: Bool) {
        guard !closed, permitted != allowed else { return }
        permitted = allowed
        if allowed { request() } else { pause() }
    }
    func request(refresh: Bool = false) {
        guard permitted, !closed else { return }
        requested = true
        refreshRequested = refreshRequested || refresh
        guard flight == nil else { return }
        retry?.cancel()
        let previous = drain
        flight = Task {
            await previous?.value
            guard !Task.isCancelled, !closed else { return }
            running = true
            var next: Date?
            var attemptedRefresh = false
            do {
                repeat {
                    requested = false
                    let refresh = refreshRequested
                    refreshRequested = false
                    let shouldRefresh = refresh || freshness.isDue(at: now())
                    attemptedRefresh = shouldRefresh
                    if let date = try await work(shouldRefresh) { next = min(next ?? date, date) }
                    try Task.checkCancellation()
                    if shouldRefresh { freshness.accepted(at: now()) }
                    message = nil
                } while requested
            } catch {
                guard !Task.isCancelled, !closed else { return }
                refreshRequested = refreshRequested || attemptedRefresh
                message = "\(label) could not finish syncing. Your saved changes are retained."
                if NativeProfileCloud.isTransient(error) { next = Date().addingTimeInterval(30) }
            }
            guard !Task.isCancelled, !closed else { return }
            running = false
            flight = nil
            if let next {
                retry = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(max(1, next.timeIntervalSinceNow))) } catch {
                        return
                    }
                    self?.request()
                }
            }
        }
    }
    private func pause() {
        let previous = drain
        let task = flight
        task?.cancel()
        flight = nil
        retry?.cancel()
        requested = false
        running = false
        let pauseWork = pauseWork
        drain = Task {
            await previous?.value
            await pauseWork()
            await task?.value
        }
    }
    func close() async {
        closed = true
        permitted = false
        pause()
        await drain?.value
    }
    func wait() async {
        await drain?.value
        await flight?.value
    }
}
