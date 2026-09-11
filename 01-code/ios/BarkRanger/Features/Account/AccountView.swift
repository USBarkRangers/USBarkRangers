import BarkDomain
import SwiftUI

struct AccountView: View {
    let model: AccountModel
    @Environment(\.openURL) private var openURL
    @State private var name = ""
    var body: some View {
        Form {
            if model.session.auth?.isTest == true {
                Section {
                    Text("Local test accounts").font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Billing and recovery actions are simulated.").font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if model.session.auth == nil {
                Section {
                    Text("Account sign-in is not configured for this build.")
                    Text(
                        "Park discovery works normally. Native Firebase registration or the local test emulators must be configured before account testing."
                    )
                }
            } else if let identity = model.session.identity {
                Section {
                    Text(identity.email ?? "Private email")
                        .accessibilityLabel("Email address")
                        .accessibilityValue(identity.email ?? "Private email")
                    if !identity.serverConfirmed {
                        Text("Remembered account · awaiting online confirmation").font(.footnote)
                    }
                    if !identity.verified {
                        Button("Send verification email", action: model.verifyEmail)
                        Button("I verified my email", action: model.refreshIdentity)
                    }
                    if let state = model.session.state {
                        accountValue("Saved name", value: state.visible.profile.displayName)
                        TextField("New display name", text: $name).textContentType(.nickname)
                        Button("Save display name") { model.saveName(name) }
                            .font(.body).fixedSize(horizontal: false, vertical: true).disabled(name.isEmpty)
                    } else {
                        Text(model.session.message ?? "Opening saved account…")
                        if model.session.message != nil {
                            Button("Retry opening saved account", action: model.session.retryStorage)
                        }
                    }
                } header: {
                    Text("Profile").foregroundStyle(Color.primary)
                }
                AccountMembership(model: model).id(identity.uid)
                AccountSecurity(model: model).id(identity.uid)
            } else {
                AccountForms(model: model)
            }
            if let notice = model.notice {
                Section { Text(notice).accessibilityIdentifier("account.notice") }
            }
            if model.busy { Section { ProgressView("Working…") } }
        }
        .font(.body)
        .disabled(model.busy)
        .navigationTitle("Account")
        .onChange(of: model.session.identity?.uid) { _, _ in
            name = ""
            model.cancel()
        }
        .onChange(of: model.billingURL) { _, url in
            if let url {
                openURL(url)
                model.clearBillingURL()
            }
        }
        .onDisappear { model.cancel() }
    }
}

/// Read-only record and membership summaries; adventure editing belongs to the later feature phases.
private struct AccountMembership: View {
    let model: AccountModel
    @State private var confirmsCancellation = false
    var body: some View {
        if let state = model.session.state {
            Section {
                accountValue(
                    "Access", value: model.session.entitlement.access?.premium == true ? "Premium" : "Free")
                accountValue("Status", value: model.session.entitlement.access?.status ?? "Unconfirmed")
                if let until = model.session.entitlement.access?.validUntil {
                    accountValue(
                        "Offline access valid until",
                        value: until.formatted(date: .abbreviated, time: .shortened))
                }
                Button("Recover existing membership") { model.existingAccess(.restore) }
                    .font(.body).fixedSize(horizontal: false, vertical: true)
                if model.session.entitlement.access?.isLemon == true {
                    Button("Manage existing subscription") { model.existingAccess(.billing) }
                    Button("Cancel existing subscription", role: .destructive) {
                        confirmsCancellation = true
                    }
                    .foregroundStyle(Color("DestructiveAction"))
                    .confirmationDialog("Cancel this subscription?", isPresented: $confirmsCancellation) {
                        Button("Cancel subscription", role: .destructive) { model.existingAccess(.cancel) }
                    }
                }
            } header: {
                Text("Membership").foregroundStyle(Color.primary)
            }
            Section {
                accountValue("Visits", value: String(state.baseline.visitCount))
                accountValue("Saved trips", value: String(state.baseline.trips.count))
                accountValue(
                    "Completed expeditions", value: String(state.baseline.completedExpeditionCount))
                accountValue("Achievement records", value: String(state.baseline.achievementCount))
                ForEach(Array(state.baseline.unresolved.enumerated()), id: \.offset) { _, detail in
                    Text(detail).font(.footnote)
                }
            } header: {
                Text("Saved account data").foregroundStyle(Color.primary)
            }
            Section {
                if model.session.isSyncing { ProgressView("Checking saved account…") }
                accountValue("Pending changes", value: String(state.pending.count))
                if let message = model.session.message { Text(message).font(.footnote) }
                Button("Sync now", action: model.session.requestSync)
                ForEach(state.pending.filter { $0.receipt != nil }) { pending in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(
                            pending.operation.kind == .profile
                                ? "Display name needs your review" : "Map appearance needs your review"
                        ).font(.headline)
                        Text(pending.receipt?.reason ?? "The server did not accept this change.").font(
                            .footnote)
                        Text("On this iPhone: \(pending.operation.value.string ?? "—")").font(.footnote)
                        let server = pending.operation.content(in: state.baseline.profile)
                        Text("On server: \(server.string ?? server.object?["displayName"]?.string ?? "—")")
                            .font(.footnote)
                        if pending.receipt?.outcome == .conflict {
                            Button("Keep my change") { model.resolve(pending, keepLocal: true) }
                        }
                        Button("Use server value") { model.resolve(pending, keepLocal: false) }
                    }
                }
            } header: {
                Text("Sync").foregroundStyle(Color.primary)
            }
        }
    }
}

/// Keep native adaptive label/value layout while avoiding faint secondary text for account facts.
private func accountValue(_ title: LocalizedStringKey, value: String) -> some View {
    LabeledContent {
        Text(value).font(.body).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
    } label: {
        Text(title).font(.body).fixedSize(horizontal: false, vertical: true)
    }
}
