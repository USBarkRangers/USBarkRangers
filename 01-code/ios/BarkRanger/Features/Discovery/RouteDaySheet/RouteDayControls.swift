import BarkDomain
import SwiftUI

/// An optimization proposal appears only after the user requests it from the day menu.
struct RouteDayControls: View {
    let model: RouteDaySheetViewModel
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let proposal = model.editor.optimization, let day = model.day {
                Text("Suggested order").font(.headline)
                Text(
                    proposal.order.compactMap { id in day.stops.first { $0.id == id }?.name }
                        .joined(separator: " → ")
                ).font(.footnote)
                Text("Based on geographic distance. Driving totals update after you apply it.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Apply order", action: model.applyOptimization)
                    Button("Keep current order", action: model.editor.dismissOptimization)
                }.barkActionStyle().disabled(model.isWorking)
            }
        }
    }
}
