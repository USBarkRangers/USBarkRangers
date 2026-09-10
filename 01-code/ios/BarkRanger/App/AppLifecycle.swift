import SwiftUI

/// Owns scene transitions. Phase 1 has no asynchronous work to cancel.
@MainActor
final class AppLifecycle {
    private let startup: StartupModel
    private let diagnostics: Diagnostics
    private(set) var phase: ScenePhase?

    init(startup: StartupModel, diagnostics: Diagnostics) {
        self.startup = startup
        self.diagnostics = diagnostics
    }

    func sceneChanged(_ newPhase: ScenePhase) {
        guard phase != newPhase else { return }
        if newPhase == .background {
            stop()
            return
        }
        phase = newPhase
        if newPhase == .active {
            diagnostics.record(.enteredForeground)
            startup.start()
        }
    }

    /// The future foreground refresh task will be cancelled here, not in a view.
    func stop() {
        guard phase != .background else { return }
        phase = .background
        diagnostics.record(.enteredBackground)
    }
}
