import BarkDomain
import SwiftUI

/// Only an active trip gets a chip. Its menu switches trips; clear retains every saved trip.
struct MapTripFilterControls: View {
    let model: RouteDaySheetViewModel
    let showRoute: () -> Void
    let openTrip: (String) -> Void
    var body: some View {
        if let trip = model.draft?.trip {
            let title = trip.name.isEmpty ? "Untitled trip" : trip.name
            HStack(spacing: 0) {
                Menu {
                    Button("Show whole route", action: showRoute)
                    Button("Clear trip", action: model.clearMap)
                    Button("Retry road routes") { model.routes.retry() }
                    Section("Choose a trip") {
                        ForEach(model.choices) { choice in
                            Button {
                                openTrip(choice.id)
                            } label: {
                                if choice.id == trip.id {
                                    Label(choice.label, systemImage: "checkmark")
                                } else {
                                    Text(choice.label)
                                }
                            }.accessibilityLabel(choice.label)
                        }
                        if model.account.nativeTrips?.hasMore == true {
                            Button(model.account.nativeTrips?.loading == true ? "Loading trips…" : "Load more trips") {
                                model.account.nativeTrips?.loadMore()
                            }.disabled(model.account.nativeTrips?.loading == true)
                        }
                        if let message = model.account.nativeTrips?.message { Text(message) }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Text(title).lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                    }
                    .padding(.leading, 14).padding(.trailing, 6).frame(minHeight: 44)
                }
                .accessibilityLabel(title).accessibilityHint("Choose a trip or open trip actions")
                .accessibilityIdentifier("map-displayed-trip")
                Button(action: model.clearMap) {
                    Image(systemName: "xmark").font(.caption.bold()).frame(width: 44, height: 44)
                }.accessibilityLabel("Clear trip")
            }
            .disabled(model.account.nativeTrips == nil || model.isWorking)
            .font(.subheadline).foregroundStyle(Color.primary).buttonStyle(.plain)
            .background(.background, in: Capsule())
        }
    }
}
