import BarkDomain
import SwiftUI

/// The current editor is the tab root. This view owns only whether the trip switcher is presented.
struct TripsView: View {
    @Bindable var model: TripEditorModel
    let units: AppSettings.Units
    let previewDay: (TripDayID) -> Void
    var search: (StopSearchRequest) -> Void = { _ in }
    @State private var showingTrips = false

    var body: some View {
        Group {
            if let draft = model.draft {
                TripEditorView(
                    model: model, units: units, previewDay: previewDay,
                    switchTrip: { showingTrips = true }, search: search
                ).id(draft.id)
            } else if model.account.nativeTrips == nil {
                if let failure = model.account.tripLibraryMessage ?? model.account.message {
                    ContentUnavailableView {
                        Label("Trips unavailable", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(failure)
                    } actions: {
                        Button("Retry", action: model.account.retryStorage)
                    }
                } else {
                    ProgressView("Loading trips…")
                }
            } else {
                ContentUnavailableView {
                    Label(
                        "Plan your next trip",
                        systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                } description: {
                    Text(
                        model.notice
                            ?? (model.canEdit
                                ? "Choose parks and organize your days. Drafts stay on this iPhone."
                                : AccountDataAccess.readOnlyMessage)
                    )
                    .foregroundStyle(.primary)
                } actions: {
                    if !model.canUsePremium { UpgradeToPremiumButton() }
                    if model.canEdit {
                        Button("New trip", systemImage: "plus") { model.newTrip() }
                            .barkActionStyle(prominent: true).disabled(!model.canChangeTrip)
                    }
                    if model.availableTripID != nil {
                        Button("Switch trip") { showingTrips = true }
                    }
                }
            }
        }
        .sheet(isPresented: $showingTrips) { TripLibraryView(model: model) }
        // Observed values, not another selection. Restore when account data arrives or a trip is deleted.
        .task(id: [model.account.tripScope, model.availableTripID, model.draft?.id]) {
            await model.resumeActive()
        }
        .onChange(of: model.account.identity?.uid) { _, _ in showingTrips = false }
    }
}
