import SwiftUI

struct StartupView: View {
    let model: StartupModel
    var body: some View {
        switch model.state {
        case .loading, .checkingUpdate:
            VStack(spacing: 20) {
                Image("BarkBadge").resizable().scaledToFit().frame(width: 130).accessibilityHidden(true)
                ProgressView(model.state == .loading ? "Opening saved parks…" : "Checking for park updates…")
                Text("Your saved parks stay available offline.").font(.subheadline).foregroundStyle(
                    .secondary)
            }
            .padding().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .recovery:
            ContentUnavailableView {
                Label("Unable to open park data", systemImage: "exclamationmark.triangle")
            } description: {
                Text("The saved catalog could not be read. Try again when a connection is available.")
            } actions: {
                Button("Try again", action: model.retry).buttonStyle(.borderedProminent)
            }
        case .ready: EmptyView()
        }
    }
}
