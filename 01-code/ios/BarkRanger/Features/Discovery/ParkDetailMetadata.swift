import BarkDomain
import SwiftUI

/// Displays supplied metadata and tags without inferring activities or availability.
struct ParkDetailMetadata: View {
    let park: Park

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text([park.sourceType, park.state].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.subheadline).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    tag(park.category.rawValue)
                    tag(park.swag.rawValue)
                    if park.isRetired { tag("Retired listing") }
                }
            }
        }
        .accessibilityIdentifier("park-detail-metadata")
    }
    private func tag(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold))
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Color(uiColor: .secondarySystemBackground), in: Capsule())
    }
}
