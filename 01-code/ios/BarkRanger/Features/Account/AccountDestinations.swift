import BarkDomain
import SwiftUI

struct AccountProfileEditor: View {
    let model: AccountModel
    @State private var name = ""

    var body: some View {
        AccountFormPage(model: model) {
            Section("Profile") {
                accountValue("Saved name", value: model.session.profileState?.visible?.displayName ?? "—")
                if model.canEditData {
                    TextField("New display name", text: $name).textContentType(.nickname)
                    Button("Save display name") { model.saveName(name) }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } else {
                    Text(AccountDataAccess.readOnlyMessage).font(.subheadline)
                    UpgradeToPremiumButton()
                }
            }
        }
        .navigationTitle("Edit Profile").navigationBarTitleDisplayMode(.inline)
    }
}

struct AccountSecurityPage: View {
    let model: AccountModel

    var body: some View {
        AccountFormPage(model: model) {
            if let identity = model.session.identity {
                Section("Email address") {
                    Text(identity.email ?? "Private email").textSelection(.enabled)
                    if !identity.serverConfirmed {
                        Text("Remembered account · awaiting online confirmation").font(.footnote)
                    }
                    if !identity.verified, model.capabilities.authenticationChanges {
                        Button("Send verification email", action: model.verifyEmail)
                        Button("I verified my email", action: model.refreshIdentity)
                    }
                }
                AccountSecurity(model: model)
            }
        }
        .navigationTitle("Sign-in & Security").navigationBarTitleDisplayMode(.inline)
    }
}

struct AccountPrivacyPage: View {
    let model: AccountModel

    var body: some View {
        AccountFormPage(model: model) {
            Section("Your information") {
                Text(
                    "Your saved information remains readable if Premium ends. Unsynced changes stay on this iPhone until they reach your account."
                )
                .font(.subheadline)
                ForEach(SettingsModel.Document.allCases) { document in
                    NavigationLink(document.rawValue) { AccountDocumentView(document: document) }
                }
            }
            AccountDeletionSection(model: model)
        }
        .navigationTitle("Data & Privacy").navigationBarTitleDisplayMode(.inline)
    }
}

private struct AccountDocumentView: View {
    let document: SettingsModel.Document
    private var text: String {
        Bundle.main.url(forResource: document.resource, withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            ?? "This document could not be opened."
    }
    var body: some View {
        ScrollView {
            Text(text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(20)
        }
        .navigationTitle(document.rawValue).navigationBarTitleDisplayMode(.inline)
    }
}

/// Only temporary form feedback is shared here; data and authentication stay in AccountModel.
struct AccountFormPage<Content: View>: View {
    let model: AccountModel
    @ViewBuilder let content: Content

    var body: some View {
        Form {
            content
            AccountActionFeedback(model: model)
        }
        .scrollDismissesKeyboard(.interactively).background(KeyboardDismissalArea())
        .disabled(model.busy).onDisappear { model.cancel() }
    }
}

struct AccountActionFeedback: View {
    let model: AccountModel
    var body: some View {
        if let notice = model.notice {
            Section { Text(notice).accessibilityIdentifier("account.notice") }
        }
        if model.busy { Section { ProgressView("Working…") } }
        if let message = model.session.deletionMessage {
            Section { Text(message).accessibilityIdentifier("account.deletion-status") }
        }
    }
}
