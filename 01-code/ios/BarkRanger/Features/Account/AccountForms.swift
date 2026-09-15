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
                use != .link || model.session.identity?.providers.contains("apple.com") != true,
                use != .reauthenticate || model.session.identity?.providers.contains("apple.com") == true
            {
                if use == .link {
                    Text(
                        "Link Apple to this existing Bark account, including when you choose Hide My Email. Your saved data stays in this account."
                    )
                    .font(.footnote)
                }
                AccountAppleButton(
                    model: model,
                    intent: use == .signIn ? .signIn : use == .link ? .link : .reauthenticate)
            }
            if model.google?.isConfigured == true,
                use != .link || model.session.identity?.providers.contains("google.com") != true
            {
                Button(use == .link ? "Link Google" : "Continue with Google") { model.useGoogle(use) }
            }
        }
    }
}

/// One native button wrapper owns the callback's request ID, not credentials or account state.
struct AccountAppleButton: View {
    let model: AccountModel
    let intent: AppleAccountAction
    var completed: () -> Void = {}
    @State private var requestID: UUID?
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        SignInWithAppleButton(.continue) { request in
            requestID = model.prepareApple(request, intent: intent)
        } onCompletion: { result in
            // Successful replies carry their original state, even if the view has
            // started another request since the old sheet was dismissed.
            let credential = try? result.get().credential as? ASAuthorizationAppleIDCredential
            let callbackID = credential?.state.flatMap(UUID.init(uuidString:)) ?? requestID
            model.finishApple(result, id: callbackID)
            if callbackID == requestID {
                requestID = nil
                completed()
            }
        }
        .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
        .frame(height: 44)
        .disabled(model.busy)
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
                        Text(
                            provider == "password"
                                ? "Email and password" : provider == "apple.com" ? "Apple" : provider)
                        Spacer()
                        if identity.providers.count > 1, model.capabilities.authenticationChanges {
                            Button("Unlink", role: .destructive) { model.unlink(provider) }
                                .foregroundStyle(Color("DestructiveAction"))
                        }
                    }
                }
                if !identity.providers.contains("password"), model.capabilities.authenticationChanges {
                    if identity.providers.contains("apple.com") {
                        Text(
                            "Linking connects this email address to your Apple sign-in, including a hidden Apple email address."
                        )
                        .font(.footnote)
                    }
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
