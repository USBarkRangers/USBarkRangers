import Foundation
import Observation

/// Open validated local records first. A separate decision task bounds the cover even if a server stalls.
@MainActor @Observable
final class StartupModel {
    enum State: Equatable { case loading, checkingUpdate, ready, recovery }
    private(set) var state: State
    private(set) var localReadyMilliseconds: Double?
    private(set) var dismissalMilliseconds: Double?
    private let catalog: CatalogRepository
    private let network: NetworkMonitor
    private let diagnostics: Diagnostics
    private let decisionBudget: Duration
    private var work: Task<Void, Never>?
    private var decision: Task<Void, Never>?
    private var began = ContinuousClock.now

    init(
        catalog: CatalogRepository, network: NetworkMonitor, diagnostics: Diagnostics,
        state: State = .loading, decisionBudget: Duration = .seconds(3)
    ) {
        self.catalog = catalog
        self.network = network
        self.diagnostics = diagnostics
        self.state = state
        self.decisionBudget = decisionBudget
    }
    @discardableResult
    func start() -> Bool {
        guard work == nil, state != .ready else { return false }
        began = .now
        state = .loading
        work = Task {
            let local = await catalog.loadLocal()
            guard !Task.isCancelled else { return }
            localReadyMilliseconds = millisecondsSinceStart()
            diagnostics.duration(.catalogLocalReady, milliseconds: localReadyMilliseconds ?? 0)
            if local.snapshot == nil {
                state = .recovery
            } else if network.isConnected == false || local.status == .notConfigured {
                revealWhenReady(hasCatalog: true)
                work = nil
                return
            } else {
                state = .checkingUpdate
            }
            decision = Task {
                try? await ContinuousClock().sleep(until: began.advanced(by: decisionBudget))
                guard !Task.isCancelled else { return }
                let current = await catalog.current()
                revealWhenReady(hasCatalog: current.snapshot != nil)
            }
            if network.isConnected != false { await catalog.refresh(reason: .startup) }
            let current = await catalog.current()
            guard !Task.isCancelled else { return }
            revealWhenReady(hasCatalog: current.snapshot != nil)
            work = nil
        }
        return true
    }
    func retry() {
        stop()
        _ = start()
    }
    func stop() {
        work?.cancel()
        work = nil
        decision?.cancel()
        decision = nil
    }
    private func revealWhenReady(hasCatalog: Bool) {
        guard state != .ready else { return }
        state = hasCatalog ? .ready : .recovery
        if hasCatalog {
            dismissalMilliseconds = millisecondsSinceStart()
            diagnostics.duration(.catalogLoaderDismissed, milliseconds: dismissalMilliseconds ?? 0)
            decision?.cancel()
            decision = nil
        }
    }
    private func millisecondsSinceStart() -> Double {
        let value = began.duration(to: .now).components
        return Double(value.seconds) * 1000 + Double(value.attoseconds) / 1e15
    }
}
