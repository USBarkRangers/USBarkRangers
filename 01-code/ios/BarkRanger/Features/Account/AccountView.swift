import SwiftUI

/// Account landing page: cached projections and navigation only. Feature owners
/// still perform authentication, entitlement checks and durable offline saves.
struct AccountView: View {
    let model: AccountModel
    let openSettings: () -> Void
    let openSupport: () -> Void
    @Environment(\.showPremium) private var showPremium

    var body: some View {
        Group {
            if model.session.identity != nil { dashboard } else { signedOut }
        }
        .navigationTitle("Account")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Settings", systemImage: "gearshape", action: openSettings)
                    .accessibilityIdentifier("account.settings")
            }
        }
        .onChange(of: model.session.identity?.uid) { _, _ in model.cancel() }
        .onDisappear { model.cancel() }
    }

    private var dashboard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Your profile and settings")
                    .font(.subheadline).foregroundStyle(.secondary).padding(.horizontal, 4)
                AccountProfileCard(model: model)
                AccountMembershipCard(access: model.session.entitlement.access)
                VStack(spacing: 0) {
                    NavigationLink {
                        PendingChangesView(model: model)
                    } label: {
                        AccountMenuRow("Sync", icon: "icloud", detail: syncDetail)
                    }
                    .accessibilityIdentifier("account.sync")
                    menuDivider
                    NavigationLink {
                        AccountSecurityPage(model: model)
                    } label: {
                        AccountMenuRow(
                            "Sign-in & Security", icon: "lock",
                            detail: model.session.identity?.verified == false ? "Verify email" : nil)
                    }
                    .accessibilityIdentifier("account.security")
                    menuDivider
                    Button(action: showPremium) {
                        AccountMenuRow("Manage Subscription", icon: "creditcard")
                    }
                    .accessibilityIdentifier("account.subscription")
                    menuDivider
                    NavigationLink {
                        AccountPrivacyPage(model: model)
                    } label: {
                        AccountMenuRow("Data & Privacy", icon: "hand.raised")
                    }
                    .accessibilityIdentifier("account.privacy")
                    menuDivider
                    Button(action: openSupport) {
                        AccountMenuRow("Help & Support", icon: "questionmark.circle")
                    }
                    .accessibilityIdentifier("account.support")
                }
                .buttonStyle(.plain).accountCard(padding: 0)
                if let message = model.session.message {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(message).font(.subheadline)
                        if model.session.profileState?.visible == nil, !model.session.requiresStorageRecovery
                        {
                            Button("Retry opening saved account", action: model.session.retryStorage)
                        }
                    }.accountCard()
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 24)
        }
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private var syncDetail: String {
        if model.session.profileState?.conflict == true { return "Review needed" }
        if model.session.isSyncing { return "Syncing…" }
        guard let profile = model.session.profileState else { return "Opening…" }
        return "\(profile.totalPendingCount) pending"
    }
    private var menuDivider: some View { Divider().padding(.leading, 58) }

    private var signedOut: some View {
        AccountFormPage(model: model) {
            Section {
                Text("Your next adventure starts here").font(.title3.bold())
                Text("Sign in to keep your places, trips and park memories together.").font(.subheadline)
            }
            if model.session.auth == nil {
                Section {
                    Text("Account sign-in is not configured for this build.")
                    Text("Park discovery is still available.").font(.subheadline)
                }
            } else {
                AccountForms(model: model)
            }
        }
    }
}

/// Native adaptive label/value layout for the detailed forms.
func accountValue(_ title: LocalizedStringKey, value: String) -> some View {
    LabeledContent {
        Text(value).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
    } label: {
        Text(title).fixedSize(horizontal: false, vertical: true)
    }
}
