import BarkDomain
import SwiftUI

/// Three browsable shelves of the same evaluated badges. Selection changes presentation, never awards.
struct AchievementVaultView: View {
    let badges: [AchievementPolicy.Badge]
    let summary: AchievementPolicy.Summary
    let showNearbyStates: () -> Void
    @State private var category = Category.rareFeats

    private enum Category: String, CaseIterable, Identifiable {
        case rareFeats, paws, states
        var id: Self { self }
        var title: String {
            switch self {
            case .rareFeats: "Rare Feats"
            case .paws: "Paws"
            case .states: "States"
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Achievement Vault").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Picker("Achievement category", selection: $category) {
                ForEach(Category.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("achievement-categories")
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(badges.filter { $0.definition.category == category.rawValue }) { badge in
                        // Size against the shelf itself so the next card peeks in on every supported width.
                        card(badge).containerRelativeFrame(.horizontal) { width, _ in width * 0.82 }
                    }
                }.scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
            .accessibilityIdentifier("achievement-shelf-\(category.rawValue)")
            .id(category)
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
        .onChange(of: category) { _, category in
            if category == .states { showNearbyStates() }
        }
    }

    private func card(_ badge: AchievementPolicy.Badge) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: badge.earned ? "pawprint.fill" : "lock")
                .font(.title).foregroundStyle(badge.earned ? Color.accentColor : .secondary)
                .accessibilityHidden(true)
            Text(badge.definition.classified && !badge.earned ? "Classified" : badge.definition.name)
                .font(.headline)
            if !badge.definition.classified || badge.earned {
                Text(badge.definition.criteria).font(.caption).foregroundStyle(.secondary)
            }
            if let state = badge.definition.state, let total = summary.stateTotals[state], total > 0 {
                let count = summary.states[state] ?? 0
                ProgressView(value: Double(min(count, total)), total: Double(total))
                    .accessibilityLabel("State progress")
                Text("\(count) / \(total) sites visited").font(.caption).foregroundStyle(.secondary)
            }
            if badge.earned {
                Label(badge.verified ? "Proximity tier" : "Manual tier", systemImage: "checkmark")
                    .font(.caption.bold()).foregroundStyle(Color.accentColor)
                if let date = badge.date {
                    Text(date, style: .date).font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Awaiting confirmation").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text("Locked").font(.caption).foregroundStyle(.secondary)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .topLeading).padding(16)
        .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("achievement-\(badge.id)")
    }
}
