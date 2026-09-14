import SwiftUI

/// Five published leaders, with a separate personal row only when the user is outside the top five.
struct LeaderboardView: View {
    let model: LeaderboardModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        Image(systemName: "trophy.fill").font(.title2).foregroundStyle(Color.accentColor)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Leading the pack").font(.title2.bold())
                            Text("Top 5 Rangers").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    if model.entries.isEmpty {
                        if model.loading {
                            ProgressView("Loading standings…")
                        } else if model.loaded, model.notice == nil {
                            Text("No standings yet. Your saved progress is still available.")
                                .foregroundStyle(.secondary)
                        }
                    }
                    ForEach(Array(model.entries.enumerated()), id: \.element.id) { index, entry in
                        if index > 0 { Divider() }
                        LeaderboardRow(
                            entry: entry, rank: index + 1, isYou: entry.id == model.currentUserID)
                    }
                }.barkSectionCard()

                if model.currentUserID != nil, !model.isInTopFive, model.loaded || !model.entries.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Your standing").font(.headline).foregroundStyle(Color.accentColor)
                        if let personal = model.personal {
                            LeaderboardRow(entry: personal.entry, rank: personal.rank, isYou: true)
                        } else {
                            Text(model.currentUserName).font(.headline)
                            if model.loading {
                                ProgressView("Finding your standing…")
                            } else {
                                Text(model.personalUnavailable ? "Standing unavailable" : "Not ranked yet")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .barkSectionCard()
                    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.accentColor.opacity(0.4)))
                }
                if let notice = model.notice {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(notice).font(.footnote).foregroundStyle(.secondary)
                        Button("Try again", action: model.refresh).barkActionStyle().disabled(model.loading)
                    }
                }
                Text("Published BARK Ranger standings. Your rank may take up to a minute to refresh.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(20)
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Leaderboard").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .onAppear { model.loadIfNeeded() }
        .onDisappear { model.cancel() }
        .toolbar {
            Button("Refresh", systemImage: "arrow.clockwise", action: model.refresh)
                .disabled(model.loading)
        }
    }
}

/// Shared row keeps leader and personal typography identical; the rank is never the row's screen slot.
private struct LeaderboardRow: View {
    let entry: LeaderboardEntry
    let rank: Int
    let isYou: Bool
    private var medal: Color {
        switch rank {
        case 1: .yellow
        case 2: .gray
        case 3: .orange
        default: .secondary
        }
    }
    var body: some View {
        HStack(spacing: 14) {
            Text("\(rank)").font(.headline.bold()).monospacedDigit()
                .foregroundStyle(isYou ? Color.accentColor : medal)
                .frame(minWidth: 38, minHeight: 38)
                .background(
                    (isYou ? Color.accentColor : medal).opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                if isYou { Text("You").font(.caption.bold()).foregroundStyle(Color.accentColor) }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(entry.points.formatted()).font(.title3.bold()).monospacedDigit()
                Text("points").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rank \(rank), \(entry.name)\(isYou ? ", You" : ""), \(entry.points) points")
        .accessibilityIdentifier("leaderboard-row-\(entry.id)")
    }
}
