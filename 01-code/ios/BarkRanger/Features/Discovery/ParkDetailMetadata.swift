import BarkDomain
import SwiftUI

/// Displays supplied metadata and tags without inferring activities or availability.
struct ParkDetailMetadata: View {
    let park: Park

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                tag(park.category.rawValue)
                if !park.sourceType.isEmpty,
                    park.sourceType.caseInsensitiveCompare(park.category.rawValue) != .orderedSame
                {
                    tag(park.sourceType)
                }
                if !park.state.isEmpty { tag(park.state) }
                tag(park.swag.rawValue)
                tag(park.swagCost.isEmpty ? "Cost not listed" : park.swagCost)
                    .accessibilityIdentifier("park-swag-cost")
                if park.isRetired { tag("Retired listing") }
            }
        }
        .accessibilityIdentifier("park-detail-metadata")
    }
    private func tag(_ text: String) -> some View {
        Text(text).font(.caption.weight(.semibold))
            .padding(.horizontal, 8).frame(minHeight: 26)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 6))
    }
}
