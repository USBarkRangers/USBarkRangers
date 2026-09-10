import BarkDomain
import SwiftUI

/// An accessible dropdown over the map. It renders the same ordered parks as the map's annotations.
struct MapSearchResults: View {
    let parks: [Park]
    let maximumHeight: CGFloat
    let select: (ParkID) -> Void
    let clear: () -> Void
    @ScaledMetric(relativeTo: .body) private var rowHeight = 88

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if parks.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No matching parks").font(.headline)
                        Text("Try another search or remove a filter.").font(.subheadline)
                        Button("Clear filters", action: clear).frame(minHeight: 44)
                    }.padding(16)
                } else {
                    ForEach(parks) { park in
                        Button {
                            select(park.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(park.name).font(.body.weight(.medium))
                                Text("\(park.state) · \(park.swag.rawValue)").font(.subheadline)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("park-result-\(park.id.rawValue)")
                        if park.id != parks.last?.id { Divider().padding(.horizontal, 16) }
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.never)
        .frame(
            maxHeight: min(
                maximumHeight, parks.isEmpty ? rowHeight * 2 : rowHeight * CGFloat(min(parks.count, 4)))
        )
        .foregroundStyle(Color.primary)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
        .accessibilityIdentifier("park-results")
    }
}
