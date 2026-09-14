import BarkDomain
import SwiftUI

/// Presents selected values and removes only the tapped value, using the existing filter action.
struct FilterChipsView: View {
    @Environment(\.expeditionOverlay) private var expeditionOverlay
    let query: ParkFilter.Query
    let update: (ParkFilter.Query) -> Void
    var trip: RouteDaySheetViewModel? = nil
    var showRoute: () -> Void = {}
    var openTrip: (String) -> Void = { _ in }
    var emptySpaceTapped: () -> Void = {}
    @State private var viewportWidth: CGFloat = 0
    @State private var chipSize: CGSize = .zero

    var body: some View {
        if query.isActive || trip?.draft != nil || expeditionOverlay?.visible == true {
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    chips.onGeometryChange(for: CGSize.self) {
                        $0.size
                    } action: {
                        chipSize = $0
                    }
                    Color.clear
                        .frame(width: max(0, viewportWidth - chipSize.width), height: chipSize.height)
                        .contentShape(Rectangle())
                        .onTapGesture(perform: emptySpaceTapped)
                        .accessibilityHidden(true)
                }
            }
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                viewportWidth = $0
            }
            .scrollIndicators(.hidden).scrollDismissesKeyboard(.never)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("active-filters")
        }
    }
    private var chips: some View {
        HStack(spacing: 8) {
            if let expeditionOverlay, expeditionOverlay.visible {
                Button(action: expeditionOverlay.hide) { Label("Trail", systemImage: "xmark") }
                    .barkActionStyle().accessibilityLabel("Hide expedition trail")
            }
            if let trip { MapTripFilterControls(model: trip, showRoute: showRoute, openTrip: openTrip) }
            if query.personal != .all {
                chip(
                    query.personal == .trip ? "In active trip" : query.personal.rawValue.capitalized,
                    label: "Remove personal filter"
                ) { $0.personal = .all }
            }
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
