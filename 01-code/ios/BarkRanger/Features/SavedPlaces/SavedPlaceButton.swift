import BarkDomain
import SwiftUI

/// The searched-place action only. Future note/management controls belong here, not in park actions.
struct SavedPlaceButton: View {
    let model: SavedPlacesModel
    let place: SavedPlace
    let removed: () -> Void

    var body: some View {
        Group {
            if let saved = model.selected, saved.stop.placeIdentity == place.stop.placeIdentity {
                Menu {
                    Button("Remove", role: .destructive) { model.remove(saved, completed: removed) }
                } label: {
                    Label("Saved", systemImage: "star.fill")
                }
                .accessibilityIdentifier("saved-place-menu")
            } else {
                Button {
                    model.save(place)
                } label: {
                    Label("Save", systemImage: "star")
                }
                .accessibilityIdentifier("save-place")
            }
        }
        .barkActionStyle(prominent: true).disabled(model.isWorking || !model.isSelectedPlaceReady(place.stop))
        .task(id: place.stop.placeIdentity) { model.select(place.stop) }
        .accessibilityHint("Saved on this device, separately from your trip")
        .alert(
            "Saved places",
            isPresented: Binding(
                get: { model.message != nil }, set: { if !$0 { model.dismissMessage() } })
        ) {
            Button("OK", role: .cancel) { model.dismissMessage() }
        } message: {
            Text(model.message ?? "")
        }
    }
}
