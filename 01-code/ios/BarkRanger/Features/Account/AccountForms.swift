import AuthenticationServices
import SwiftUI

/// Form-only input remains temporary and is discarded when account identity changes.
struct AccountForms: View {
    let model: AccountModel
    private enum Field { case email, password }
    @State private var email = ""
    @State private var password = ""
    @State private var create = false
    @FocusState private var focusedField: Field?
    var body: some View {
        Section("Sign in") {
            TextField("Email", text: $email).textContentType(.emailAddress)
                .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                .focused($focusedField, equals: .email).submitLabel(.next)
                .onSubmit { focusedField = .password }
            SecureField("Password", text: $password).textContentType(create ? .newPassword : .password)
                .focused($focusedField, equals: .password).submitLabel(.done)
                .onSubmit { focusedField = nil }
            if model.capabilities.authenticationChanges { Toggle("Create a new account", isOn: $create) }
            Button(create ? "Create account" : "Sign in") {
                focusedField = nil
                model.email(email, password: password, create: create)
            }
            if model.capabilities.authenticationChanges {
                Button("Reset password") {
                    focusedField = nil
                    model.resetPassword(email)
                }
            }
        }
        .onChange(of: create) { _, _ in focusedField = nil }
        if model.providerButtonsAvailable { AccountProviderButtons(model: model, use: .signIn) }
    }
}

struct AccountProviderButtons: View {
    let model: AccountModel
    let use: CredentialUse
    var body: some View {
        Section {
            if model.capabilities.appleSignIn,
                use != .link || model.session.identity?.providers.contains("apple.com") != true
            {
                SignInWithAppleButton(.continue, onRequest: model.prepareApple) { result in
                    model.finishApple(result, use: use)
                }
                .frame(height: 44)
            }
            if model.google?.isConfigured == true,
                use != .link || model.session.identity?.providers.contains("google.com") != true
            {
                Button(use == .link ? "Link Google" : "Continue with Google") { model.useGoogle(use) }
            }
        }
    }
}

struct AccountSecurity: View {
    let model: AccountModel
    @State private var email = ""
    @State private var password = ""
    var body: some View {
        if let identity = model.session.identity {
            Section("Sign-in methods") {
                ForEach(identity.providers, id: \.self) { provider in
                    HStack {
                        Text(provider == "password" ? "Email and password" : provider)
                        Spacer()
                        if identity.providers.count > 1, model.capabilities.authenticationChanges {
                            Button("Unlink", role: .destructive) { model.unlink(provider) }
                                .foregroundStyle(Color("DestructiveAction"))
                        }
                    }
                }
                if !identity.providers.contains("password"), model.capabilities.authenticationChanges {
                    TextField("Email to link", text: $email).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("New password", text: $password)
                    Button("Link email and password") { model.linkEmail(email, password: password) }
                }
                Button("Sign out", action: model.signOut)
            }
            if model.providerButtonsAvailable, model.capabilities.authenticationChanges {
                AccountProviderButtons(model: model, use: .link)
            }
        }
    }
}
