import BarkDomain
import SwiftUI

struct AccountView: View {
    let model: AccountModel
    @State private var name = ""
    var body: some View {
        Form {
            if model.session.auth?.isTest == true {
                Section {
                    Text("Local test accounts").font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(
                        model.session.nativeProfileConfiguration == nil
                            ? "Billing and recovery actions are simulated."
                            : "Connected to isolated native emulators. Purchases and account deletion are not enabled yet."
                    ).font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if model.session.auth != nil, model.capabilities.isReadOnly {
                Section {
                    Text("Existing account preview").font(.headline)
                    Text(
                        "Sign in to view your saved account. Account changes and purchases are not enabled yet."
                    )
                    .font(.footnote)
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
                    if !identity.verified, model.capabilities.authenticationChanges {
                        Button("Send verification email", action: model.verifyEmail)
                        Button("I verified my email", action: model.refreshIdentity)
                    }
                    if let savedName = savedName {
                        accountValue("Saved name", value: savedName)
                        if model.canEditData {
                            TextField("New display name", text: $name).textContentType(.nickname)
                            Button("Save display name") { model.saveName(name) }
                                .font(.body).fixedSize(horizontal: false, vertical: true).disabled(
                                    name.isEmpty)
                        }
                    } else {
                        Text(model.session.message ?? "Opening saved account…")
                        if model.session.message != nil, !model.session.requiresStorageRecovery {
                            Button("Retry opening saved account", action: model.session.retryStorage)
                        }
                    }
                } header: {
                    Text("Profile").foregroundStyle(Color.primary)
                }
                NativeAccountDetails(model: model).id(identity.uid)
                AccountSecurity(model: model).id(identity.uid)
            } else {
                AccountForms(model: model)
            }
            if let notice = model.notice {
                Section { Text(notice).accessibilityIdentifier("account.notice") }
            }
            if model.busy { Section { ProgressView("Working…") } }
        }
        // A UID transition starts fresh form controls, including signed-out credentials/create mode.
        .id(model.session.identity?.uid)
        .font(.body)
        .disabled(model.busy)
        .navigationTitle("Account")
        .onChange(of: model.session.identity?.uid) { _, _ in
            name = ""
            model.cancel()
        }
        .onDisappear { model.cancel() }
    }
    private var savedName: String? {
        model.session.profileState?.visible?.displayName
    }
}

/// Keep native adaptive label/value layout while avoiding faint secondary text for account facts.
func accountValue(_ title: LocalizedStringKey, value: String) -> some View {
    LabeledContent {
        Text(value).font(.body).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
    } label: {
        Text(title).font(.body).fixedSize(horizontal: false, vertical: true)
    }
}
