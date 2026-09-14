import BarkDomain
import SwiftUI

/// Summary presentation with explicit navigation intents; no progress or storage ownership.
struct PassportHeader: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let name: String
    let summary: AchievementPolicy.Summary?
    let streak: Int
    let openVisits: () -> Void
    let openStates: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Welcome!").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                Text(name).font(.title2.weight(.medium)).foregroundStyle(.secondary)
                    .accessibilityIdentifier("passport-name")
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                Button(action: openVisits) {
                    stat("Sites Visited", value: summary?.sites, symbol: "mappin.and.ellipse")
                }.buttonStyle(.plain).disabled(summary == nil)
                Button(action: openStates) {
                    stat("States", value: summary?.states.count, symbol: "map")
                }.buttonStyle(.plain).disabled(summary == nil)
                stat("Total Points", value: summary?.points, symbol: "star.fill")
                stat("Verified", value: summary?.verifiedSites, symbol: "checkmark.seal.fill")
            }
            if let summary {
                Divider()
                level(summary)
                Text("Daily streak · \(streak)").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
    }

    private func stat(_ title: String, value: Int?, symbol: String) -> some View {
        VStack(spacing: 4) {
            Text(value.map { $0.formatted() } ?? "—")
                .font(.largeTitle.bold()).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity).padding(.horizontal, 20)
                .overlay(alignment: .trailing) {
                    Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                }
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).padding(12)
        .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(value.map { $0.formatted() } ?? "Not available")
        .accessibilityIdentifier("passport-stat-\(title)")
    }

    private func level(_ summary: AchievementPolicy.Summary) -> some View {
        let level = summary.level
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        return VStack(alignment: .leading, spacing: 12) {
            layout {
                Text("Level \(level.number)").font(.title3.bold()).foregroundStyle(Color.accentColor)
                Text(level.title).font(.headline)
            }
            if let next = level.nextPoints {
                ProgressView(
                    value: Double(summary.points - level.minimumPoints),
                    total: Double(next - level.minimumPoints)
                )
                .tint(Color.accentColor).scaleEffect(x: 1, y: 2).frame(height: 8)
                .accessibilityLabel("Progress to Level \(level.number + 1)")
                Text("\(next - summary.points) points to Level \(level.number + 1)")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("passport-level")
    }
}
