import Observation

/// Describes actual launch readiness. Catalog loading joins this owner in phase 2.
@MainActor @Observable
final class StartupModel {
    enum State: Equatable {
        case loading
        case ready
        case recovery
    }

    private(set) var state: State
    private let diagnostics: Diagnostics

    init(diagnostics: Diagnostics, state: State = .loading) {
        self.diagnostics = diagnostics
        self.state = state
    }

    @discardableResult
    func start() -> Bool {
        guard state == .loading else { return false }
        // The shell has no fallible I/O. No timer, network request or fake progress.
        diagnostics.measure(.shellStartup) {
            state = .ready
        }
        return true
    }
}
