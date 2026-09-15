import BarkDomain
import SwiftUI

/// Passport progress, confirmed history and explicit pending status, without separate visit storage.
struct PassportView: View {
    let model: PassportModel
    let openWalks: () -> Void
    var share: (() -> Void)? = nil
    @State private var destination: Destination?
    private enum Destination: Hashable { case visits, states, watermark }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PassportHeader(
                    name: model.displayName, summary: model.content?.summary, streak: model.streak,
                    openVisits: { destination = .visits }, openStates: { destination = .states })
                Button(action: openWalks) {
                    Label("Walks & expeditions", systemImage: "figure.walk")
                        .font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .barkActionStyle()
                .controlSize(.large)
                if model.account.identity == nil {
                    ContentUnavailableView {
                        Label("Your next chapter starts here", systemImage: "book.closed")
                    } description: {
                        Text("Sign in from Account to record visits and build your passport.")
                            .foregroundStyle(.primary)
                    }
                    watermarkLink
                } else if let content = model.content {
                    AchievementVaultView(
                        badges: content.badges, summary: content.summary,
                        showNearbyStates: model.nearby.load
                    )
                    .id(model.account.identity?.uid)
                    leaderboardLink
                    watermarkLink
                    if let share { Button("Share passport & export visits", action: share).barkActionStyle() }
                    if model.pendingCount > 0 {
                        Label(
                            "\(model.pendingCount) visit changes awaiting cloud confirmation",
                            systemImage: "icloud.and.arrow.up"
                        ).font(.footnote).foregroundStyle(.secondary)
                    }
                    if !model.conflicts.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Visit changes needing attention").font(.headline)
                            ForEach(model.conflicts, id: \.self) { conflict in
                                VisitConflictView(model: model, id: conflict)
                            }
                        }
                        .padding(16)
                        .background(
                            Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24)
                        )
                    }
                } else {
                    ProgressView("Opening your passport…")
                }
                if let notice = model.notice { Text(notice).font(.footnote) }
                if model.account.identity != nil, !model.canEdit { UpgradeToPremiumButton() }
                if let message = model.account.nativeVisits?.message
                    ?? model.account.nativeVisits?.sync?.message
                {
                    Text(message).font(.footnote)
                }
            }.padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Passport")
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(item: $destination) { destination in
            switch destination {
            case .visits: VisitHistoryView(model: model)
            case .states: StateProgressView(model: model)
            case .watermark: PhotoWatermarkView()
            }
        }
        .onAppear { model.recordActivity() }
        .onChange(of: model.canEdit) { _, canEdit in if canEdit { model.recordActivity() } }
        .onChange(of: model.account.identity?.uid) { _, _ in destination = nil }
    }

    private var leaderboardLink: some View {
        NavigationLink(destination: LeaderboardView(model: model.leaderboard)) {
            HStack {
                Label("Leaderboard", systemImage: "list.number").font(.headline)
                Spacer()
                Image(systemName: "chevron.right").font(.caption.bold())
            }
            .frame(minHeight: 44).padding(16)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
        }
        .buttonStyle(.plain)
    }

    private var watermarkLink: some View {
        Button {
            destination = .watermark
        } label: {
            HStack {
                Label("Photo watermark", systemImage: "photo").font(.headline)
                Spacer()
                Image(systemName: "chevron.right").font(.caption.bold())
            }
            .frame(minHeight: 44).padding(16)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("passport-watermark")
    }
}
