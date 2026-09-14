import BarkDomain
import SwiftUI

/// A second presentation of the same ordered state badges, not another progress calculation.
struct StateProgressView: View {
    let model: PassportModel
    var body: some View {
        List {
            if model.nearby.loading { ProgressView("Finding nearby states…") }
            if let notice = model.nearby.notice { Text(notice).font(.footnote).foregroundStyle(.secondary) }
            if let content = model.content {
                ForEach(content.badges.filter { $0.definition.category == "states" }) { badge in
                    if let state = badge.definition.state {
                        let visited = content.summary.states[state] ?? 0
                        let total = content.summary.stateTotals[state] ?? 0
                        VStack(alignment: .leading, spacing: 8) {
                            LabeledContent(badge.definition.name, value: "\(visited) / \(total)")
                            if total > 0 {
                                ProgressView(value: Double(min(visited, total)), total: Double(total))
                                    .accessibilityLabel("\(badge.definition.name) progress")
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("State progress")
        .toolbar(.visible, for: .navigationBar)
        .onAppear { model.nearby.load() }
    }
}
