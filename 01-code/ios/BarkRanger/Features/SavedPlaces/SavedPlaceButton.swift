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
                if model.canEdit {
                    Menu {
                        Button("Remove", role: .destructive) { model.remove(saved, completed: removed) }
                    } label: {
                        Label(model.selectedPending ? "Saved on iPhone" : "Saved", systemImage: "star.fill")
                    }
                    .accessibilityIdentifier("saved-place-menu")
                } else {
                    Label(model.selectedPending ? "Saved on iPhone" : "Saved", systemImage: "star.fill")
                        .accessibilityIdentifier("saved-place-read-only")
                        .accessibilityHint("Read only. Premium is required to change saved places.")
                }
            } else if model.canEdit {
                Button {
                    model.save(place)
                } label: {
                    Label("Save", systemImage: "star")
                }
                .accessibilityIdentifier("save-place")
            }
            if !model.canEdit { UpgradeToPremiumButton(title: "Save places with Premium") }
        }
        .barkActionStyle(prominent: true).disabled(model.isWorking || !model.isSelectedPlaceReady(place.stop))
        .task(id: place.stop.placeIdentity) { model.select(place.stop) }
        .accessibilityHint(
            model.selectedPending
                ? "Waiting for server confirmation. View Pending Changes in Account."
                : "Saved separately from your trip"
        )
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
