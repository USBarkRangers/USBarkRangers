import BarkDomain
import SwiftUI

/// Current trip title, presentation switch and quiet save status. The options menu owns its own modals.
struct TripEditorHeader: View {
    enum Section: String, CaseIterable {
        case planner = "Planner"
        case overview = "Overview"
    }
    let model: TripEditorModel
    @Binding var section: Section
    let draggingStop: Bool
    let switchTrip: () -> Void
    var search: (StopSearchRequest) -> Void = { _ in }
    @FocusState private var editingName: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                if model.canEdit {
                    TextField(
                        "Trip name",
                        text: Binding(get: { model.draft?.trip.name ?? "" }, set: { model.rename($0) })
                    )
                    .font(.title2.bold())
                    .focused($editingName).submitLabel(.done)
                    .onSubmit { editingName = false }
                    .accessibilityIdentifier("trip-name")
                } else {
                    Text(model.draft?.trip.name ?? "Trip").font(.title2.bold()).frame(
                        maxWidth: .infinity, alignment: .leading
                    ).accessibilityIdentifier("trip-name")
                }
                TripOptionsMenu(
                    model: model,
                    switchTrip: {
                        editingName = false
                        switchTrip()
                    }, rename: { editingName = true }, search: search
                )
                .disabled(model.isWorking || model.checkpointConflict || draggingStop)
            }
            Picker("Trip view", selection: $section) {
                ForEach(Section.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented).disabled(draggingStop)
            .accessibilityIdentifier("trip-view-picker")
            .onChange(of: section) { _, _ in editingName = false }
            if model.canEdit {
                HStack {
                    ZStack(alignment: .topLeading) {
                        Text("Draft saved on this iPhone\nAccount status").hidden().accessibilityHidden(true)
                        Text(
                            (model.notice == "Day updated" ? nil : model.notice)
                                ?? (model.checkpointNeedsRetry
                                    ? "Draft not saved"
                                    : model.checkpointPending
                                        ? "Saving draft…" : "Draft saved on this iPhone")
                        )
                        .lineLimit(2).accessibilityIdentifier("trip-save-status")
                    }.foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Button("Save to account", action: model.save)
                        .fontWeight(.semibold).disabled(!model.canUsePremium || model.isWorking)
                }.font(.caption)
            } else {
                Text(AccountDataAccess.readOnlyMessage).font(.caption).foregroundStyle(.secondary)
            }
            if model.checkpointConflict {
                Button("Load latest draft", action: model.reloadCheckpoint).font(.caption)
            } else if model.checkpointNeedsRetry {
                Button("Retry saving draft", action: model.requestCheckpoint).font(.caption)
            }
        }.padding(.horizontal, 6)
    }
}
