import SwiftUI

/// Only actions implemented in this phase: native directions and expansion to the existing facts.
struct ParkDetailActions: View {
    @Environment(\.colorScheme) private var colorScheme
    let isOpeningMaps: Bool
    let directions: () -> Void
    let showInfo: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                Button(action: directions) {
                    Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        .foregroundStyle(colorScheme == .dark ? .black : .white)
                }
                .buttonStyle(.borderedProminent).disabled(isOpeningMaps)
                .accessibilityLabel("Directions in Apple Maps")
                Button(action: showInfo) { Label("Park Info", systemImage: "info.circle") }
                    .buttonStyle(.bordered).accessibilityHint("Expands the full park details")
            }
            .controlSize(.large).buttonBorderShape(.capsule)
            .font(.subheadline.weight(.semibold)).fixedSize(horizontal: true, vertical: false)
        }
    }
}
