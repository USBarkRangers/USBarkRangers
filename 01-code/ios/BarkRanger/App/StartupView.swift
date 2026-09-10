import SwiftUI

/// Presentation only. Recovery gets a real retry action with fallible loading in phase 2.
struct StartupView: View {
    let model: StartupModel

    var body: some View {
        switch model.state {
        case .loading:
            ProgressView("Opening Bark Ranger…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .recovery:
            ContentUnavailableView(
                "Unable to open Bark Ranger",
                systemImage: "exclamationmark.triangle",
                description: Text("Please close the app and try opening it again.")
            )
        case .ready:
            EmptyView()
        }
    }
}

#Preview("Loading") {
    StartupView(model: StartupModel(diagnostics: Diagnostics(enabled: false)))
}

#Preview("Recovery presentation") {
    StartupView(model: StartupModel(diagnostics: Diagnostics(enabled: false), state: .recovery))
}
