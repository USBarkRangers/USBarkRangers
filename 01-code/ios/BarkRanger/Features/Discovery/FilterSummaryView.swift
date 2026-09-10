import BarkDomain
import SwiftUI

struct FilterSummaryView: View {
    let result: ParkFilter.Result
    let clear: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(result.matchingCount) of \(result.totalCount) parks").font(.headline).fixedSize(
                    horizontal: false, vertical: true
                )
                .accessibilityIdentifier("park-count")
                Spacer(minLength: 8)
                if !result.labels.isEmpty {
                    Button("Clear", action: clear).buttonStyle(.bordered).controlSize(.large)
                }
            }
            if !result.labels.isEmpty {
                Text(result.labels.joined(separator: " · ")).font(.subheadline).foregroundStyle(Color.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .contain)
    }
}
