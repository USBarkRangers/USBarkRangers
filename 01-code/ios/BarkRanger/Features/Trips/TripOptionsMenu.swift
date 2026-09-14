import BarkDomain
import SwiftUI

/// Trip management and its temporary confirmations/pickers. No trip buffer or save worker lives here.
struct TripOptionsMenu: View {
    let model: TripEditorModel
    let switchTrip: () -> Void
    let rename: () -> Void
    var search: (StopSearchRequest) -> Void = { _ in }
    var body: some View {
        Menu {
            Button("Switch trip", systemImage: "arrow.left.arrow.right", action: switchTrip)
            if model.canEdit {
                Button("New trip", systemImage: "plus") { model.newTrip() }.disabled(!model.canChangeTrip)
                Button("Rename trip", systemImage: "pencil", action: rename)
                Button("Duplicate trip", systemImage: "doc.on.doc", action: model.duplicateTrip)
                    .disabled(!model.canChangeTrip)
                if let trip = model.draft?.trip {
                    Divider()
                    Button(trip.start == nil ? "Choose Trip Start" : "Edit Trip Start") {
                        model.searchOnMap(destination: .start, open: search)
                    }
                    if trip.start != nil {
                        Button("Remove Trip Start", role: .destructive) { model.clearBookend(true) }
                    }
                    Button(trip.end == nil ? "Choose Trip Finish" : "Edit Trip Finish") {
                        model.searchOnMap(destination: .end, open: search)
                    }
                    if trip.end != nil {
                        Button("Remove Trip Finish", role: .destructive) { model.clearBookend(false) }
                    }
                    Divider()
                }
                Button("Save to account", action: model.save).disabled(!model.canUsePremium || model.saving)
            }
            Divider()
            Button("Clear trip", systemImage: "xmark.circle", action: model.clearTrip)
                .disabled(model.saving || model.activeTrip.isWorking)
        } label: {
            Image(systemName: "ellipsis").font(.title3.weight(.semibold))
                .foregroundStyle(.primary).frame(width: 44, height: 44)
                .background(.quaternary, in: Circle())
        }
        .accessibilityLabel("Trip options")
    }
}
