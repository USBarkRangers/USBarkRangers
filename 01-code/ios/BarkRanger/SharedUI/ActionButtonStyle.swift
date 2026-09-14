import SwiftUI

extension View {
    /// Keeps native button behavior, with neutral action surfaces in dark mode.
    func barkActionStyle(prominent: Bool = false) -> some View {
        modifier(ActionButtonStyle(prominent: prominent))
    }
}

private struct ActionButtonStyle: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let prominent: Bool

    func body(content: Content) -> some View {
        if colorScheme == .dark {
            content
                .buttonStyle(.borderedProminent)
                .tint(Color(uiColor: .tertiarySystemBackground))
                .foregroundStyle(Color("AccentColor"))
        } else if prominent {
            content.buttonStyle(.borderedProminent)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}
