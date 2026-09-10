import Foundation

/// Constructs the shell once; screens receive their dependencies directly.
@MainActor
struct AppComposition {
    let router: AppRouter
    let startup: StartupModel
    let lifecycle: AppLifecycle

    static func makeLive() -> AppComposition {
        assemble(diagnostics: Diagnostics(), state: .loading)
    }

    static func makePreview() -> AppComposition {
        assemble(diagnostics: Diagnostics(enabled: false), state: .ready)
    }

    private static func assemble(
        diagnostics: Diagnostics, state: StartupModel.State
    ) -> AppComposition {
        let startup = StartupModel(diagnostics: diagnostics, state: state)
        return AppComposition(
            router: AppRouter(diagnostics: diagnostics),
            startup: startup,
            lifecycle: AppLifecycle(startup: startup, diagnostics: diagnostics)
        )
    }
}
