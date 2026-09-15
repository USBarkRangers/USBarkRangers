import BarkDomain
import SwiftUI

/// Whole-trip planning presentation. Suggestions remain explicit and reversible until applied.
struct TripPlanningCard: View {
    let model: TripEditorModel
    let preview: () -> Void
    @State private var hours = 4.0
    @State private var visitMinutes = 30.0
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Plan trip").font(.headline)
            if !model.canUsePremium { UpgradeToPremiumButton() }
            Stepper(
                hours == 1 ? "Driving goal: 1 hour per day" : "Driving goal: \(Int(hours)) hours per day",
                value: $hours, in: 1...16)
            Stepper(
                "Visit time: \(Int(visitMinutes)) minutes per stop",
                value: $visitMinutes, in: 0...480, step: 15)
            Button {
                model.proposeOptimization(partition: true, hours: hours, visitMinutes: visitMinutes)
            } label: {
                Text("Propose days").frame(maxWidth: .infinity, minHeight: 32)
            }.barkActionStyle(prominent: true).disabled(!model.canUsePremium || model.saving)
            Text("Suggestions use geographic distance and visit time.")
                .font(.caption).foregroundStyle(.secondary)
            if let proposal = model.proposal {
                Text("Suggested itinerary").font(.headline)
                ForEach(Array(proposal.days.enumerated()), id: \.element.id) { index, day in
                    Text("Day \(index + 1): \(day.stops.map(\.name).joined(separator: " → "))")
                        .font(.footnote)
                }
                HStack {
                    Button("Apply proposal", action: model.acceptOptimization)
                    Button("Keep current order", action: model.discardOptimization)
                }.barkActionStyle().disabled(model.saving)
            }
            Divider()
            Button(action: preview) {
                Label(
                    model.proposal == nil ? "View on map" : "View current trip on map", systemImage: "map"
                )
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .disabled(!model.canUsePremium || model.saving || model.checkpointConflict)
            .accessibilityIdentifier("planner-preview-map")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("planner-plan-trip-card")
    }
}
