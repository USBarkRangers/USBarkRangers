import AuthenticationServices
import SwiftUI

/// Form-only input remains temporary and is discarded when account identity changes.
struct AccountForms: View {
    let model: AccountModel
    @State private var email = ""
    @State private var password = ""
    @State private var create = false
    var body: some View {
        Section("Sign in") {
            TextField("Email", text: $email).textContentType(.emailAddress)
                .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("Password", text: $password).textContentType(create ? .newPassword : .password)
            Toggle("Create a new account", isOn: $create)
            Button(create ? "Create account" : "Sign in") {
                model.email(email, password: password, create: create)
            }
            Button("Reset password") { model.resetPassword(email) }
        }
        if model.providerButtonsAvailable { AccountProviderButtons(model: model, use: .signIn) }
    }
}

struct AccountProviderButtons: View {
    let model: AccountModel
    let use: CredentialUse
    var body: some View {
        Section {
            SignInWithAppleButton(.continue, onRequest: model.prepareApple) { result in
                model.finishApple(result, use: use)
            }
            .frame(height: 44)
            if model.google?.clientID != nil { Button("Continue with Google") { model.useGoogle(use) } }
        }
    }
}

struct AccountSecurity: View {
    let model: AccountModel
    @State private var email = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var showDeletion = false
    var body: some View {
        if let identity = model.session.identity {
            Section("Sign-in methods") {
                ForEach(identity.providers, id: \.self) { provider in
                    HStack {
                        Text(provider == "password" ? "Email and password" : provider)
                        Spacer()
                        if identity.providers.count > 1 {
                            Button("Unlink", role: .destructive) { model.unlink(provider) }
                                .foregroundStyle(Color("DestructiveAction"))
                        }
                    }
                }
                if !identity.providers.contains("password") {
                    TextField("Email to link", text: $email).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("New password", text: $password)
                    Button("Link email and password") { model.linkEmail(email, password: password) }
                }
                Button("Sign out", action: model.signOut)
            }
            if model.providerButtonsAvailable { AccountProviderButtons(model: model, use: .link) }
            Section {
                DisclosureGroup("Delete account", isExpanded: $showDeletion) {
                    Text(
                        "This permanently removes this account and its cloud data. Existing Lemon Squeezy cancellation is attempted first. Identity deletion alone does not manage an Apple subscription."
                    )
                    Text(
                        "Confirm your identity again, then type DELETE. Nothing is deleted until you press Delete account permanently."
                    )
                    if identity.providers.contains("password") {
                        SecureField("Current password", text: $password).textContentType(.password)
                        Button("Confirm identity") { model.reauthenticate(password: password) }
                    }
                    if model.providerButtonsAvailable {
                        SignInWithAppleButton(.continue, onRequest: model.prepareApple) {
                            model.finishApple($0, use: .reauthenticate)
                        }
                        .frame(height: 44)
                        if identity.providers.contains("google.com") {
                            Button("Confirm with Google") { model.useGoogle(.reauthenticate) }
                        }
                    }
                    TextField("Type DELETE", text: $confirmation).autocorrectionDisabled()
                    Button("Delete account permanently", role: .destructive) {
                        model.deleteAccount(confirmation: confirmation)
                    }
                    .foregroundStyle(Color("DestructiveAction"))
                    .disabled(confirmation != "DELETE")
                }
            }
        }
    }
}
