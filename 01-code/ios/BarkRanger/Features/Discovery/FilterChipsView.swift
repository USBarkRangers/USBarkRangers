import BarkDomain
import SwiftUI

/// Presents selected values and removes only the tapped value, using the existing filter action.
struct FilterChipsView: View {
    let query: ParkFilter.Query
    let update: (ParkFilter.Query) -> Void

    var body: some View {
        if query.isActive {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    if !query.search.isEmpty {
                        chip(query.search, label: "Remove search filter") { $0.search = "" }
                    }
                    ForEach(ParkCategory.allCases.filter { query.categories.contains($0) }, id: \.self) {
                        category in
                        chip(category.rawValue, label: "Remove \(category.rawValue) category filter") {
                            $0.categories.remove(category)
                        }
                    }
                    ForEach(Swag.allCases.filter { query.swag.contains($0) }, id: \.self) { swag in
                        chip(swag.rawValue, label: "Remove \(swag.rawValue) swag filter") {
                            $0.swag.remove(swag)
                        }
                    }
                }
            }
            .scrollIndicators(.hidden).scrollDismissesKeyboard(.never)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("active-filters")
        }
    }

    private func chip(_ title: String, label: String, remove: @escaping (inout ParkFilter.Query) -> Void)
        -> some View
    {
        Button {
            var next = query
            remove(&next)
            update(next)
        } label: {
            HStack(spacing: 8) {
                Text(title).lineLimit(1)
                Image(systemName: "xmark").font(.caption.bold())
            }
            .font(.subheadline).padding(.horizontal, 14).frame(minHeight: 44)
            .foregroundStyle(Color.primary).background(.background, in: Capsule())
        }
        .buttonStyle(.plain).accessibilityLabel(label).accessibilityValue(title)
    }
}
