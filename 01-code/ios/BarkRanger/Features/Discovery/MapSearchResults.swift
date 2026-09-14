import BarkDomain
import SwiftUI

/// An accessible dropdown over the map. It renders the same ordered parks as the map's annotations.
struct MapSearchResults: View {
    let parks: [Park]
    var places: MapPlaceSearchModel? = nil
    var selectPlace: (MapSearchClient.Suggestion) -> Void = { _ in }
    let maximumHeight: CGFloat
    let select: (ParkID) -> Void
    let clear: () -> Void
    @ScaledMetric(relativeTo: .body) private var rowHeight = 88

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Text("BARK parks").font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(12)
                if parks.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No matching parks").font(.headline)
                        Text("Try another search or remove a filter.").font(.subheadline)
                        Button("Clear filters", action: clear).frame(minHeight: 44)
                    }.padding(16)
                } else {
                    ForEach(Array(parks.prefix(12))) { park in
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
                if let places {
                    Divider()
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Places from Apple Maps").font(.caption.weight(.semibold)).foregroundStyle(
                            .secondary)
                        if places.isSearching || places.isResolving {
                            ProgressView(places.isResolving ? "Opening place…" : "Searching places…")
                        }
                        if let notice = places.notice {
                            Text(notice).font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(places.suggestions) { place in
                            Button {
                                selectPlace(place)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(place.title).font(.body.weight(.medium))
                                    Text(place.subtitle).font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(
                                    Rectangle())
                            }.buttonStyle(.plain).disabled(places.isResolving)
                                .accessibilityIdentifier("place-result-" + place.id)
                        }
                    }.padding(16)
                }
            }
        }
        .scrollDismissesKeyboard(.never)
        .frame(
            maxHeight: min(
                maximumHeight,
                rowHeight * CGFloat(min(5, max(2, parks.count + (places?.suggestions.count ?? 0) + 1))))
        )
        .foregroundStyle(Color.primary)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
        .accessibilityIdentifier("park-results")
    }
}
