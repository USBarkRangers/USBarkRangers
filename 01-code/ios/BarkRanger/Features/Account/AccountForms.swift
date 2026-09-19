import AuthenticationServices
import SwiftUI

/// Form-only input remains temporary and is discarded when account identity changes.
struct AccountForms: View {
    let model: AccountModel
    private enum Field { case email, password }
    private enum Mode { case signIn, create, reset }
    @State private var email = ""
    @State private var password = ""
    @State private var mode = Mode.signIn
    @FocusState private var focusedField: Field?
    var body: some View {
        if mode == .signIn, model.providerButtonsAvailable {
            Section {
                AccountAppleButton(model: model, intent: .signIn)
                Text(
                    "Already have an email account? Sign in below, then connect Apple in Sign-in & Security to keep your saved data together."
                )
                .font(.footnote)
            }
        }
        Section(mode == .create ? "Create account" : mode == .reset ? "Reset password" : "Sign in with email")
        {
            TextField("Email", text: $email).textContentType(.emailAddress)
                .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                .focused($focusedField, equals: .email).submitLabel(mode == .reset ? .done : .next)
                .onSubmit { focusedField = mode == .reset ? nil : .password }
            if mode != .reset {
                SecureField("Password", text: $password).textContentType(
                    mode == .create ? .newPassword : .password
                )
                .focused($focusedField, equals: .password).submitLabel(.done)
                .onSubmit { focusedField = nil }
            }
            if mode == .create { Text("Use at least 8 characters.").font(.footnote) }
            if mode == .reset {
                Text(
                    "For email/password accounts, we’ll send a reset link if the address is eligible. If you use Apple only, continue with Apple instead."
                ).font(.footnote)
            }
            Button(mode == .create ? "Create account" : mode == .reset ? "Send reset email" : "Sign in") {
                focusedField = nil
                if mode == .reset {
                    model.resetPassword(email)
                } else {
                    model.email(email, password: password, create: mode == .create)
                }
            }
            if model.capabilities.authenticationChanges {
                if mode == .signIn {
                    Button("Forgot password?") { mode = .reset }
                    Button("Create an account") { mode = .create }
                        .accessibilityIdentifier("account.create-mode")
                } else {
                    Button("Back to sign in") { mode = .signIn }
                }
            }
        }
        .onChange(of: mode) { _, _ in
            focusedField = nil
            password = ""
            model.cancel()
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
        .disabled(model.busy || model.session.isCleaningUp)
    }
}

struct AccountSecurity: View {
    let model: AccountModel
    @State private var email = ""
    @State private var password = ""
    @State private var removing: String?
    var body: some View {
        if let identity = model.session.identity {
            Section("Sign-in methods") {
                ForEach(["apple.com", "password"], id: \.self) { provider in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(provider == "password" ? "Email and password" : "Apple")
                            Text(identity.providers.contains(provider) ? "Connected" : "Not connected")
                                .foregroundStyle(.secondary).font(.subheadline)
                        }
                        Spacer()
                        if identity.providers.count > 1, model.capabilities.authenticationChanges {
                            Button("Disconnect", role: .destructive) { removing = provider }
                                .foregroundStyle(Color("DestructiveAction"))
                                .accessibilityLabel(
                                    provider == "apple.com" ? "Disconnect Apple" : "Remove email and password"
                                )
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
                    TextField("Email to link", text: $email).textContentType(.emailAddress).keyboardType(
                        .emailAddress
                    )
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("New password", text: $password).textContentType(.newPassword)
                    Button("Link email and password") {
                        model.linkEmail(email, password: password)
                        password = ""
                    }
                }
                if identity.providers.contains("password"), model.capabilities.authenticationChanges {
                    Button("Send password reset email") {
                        model.resetPassword(identity.passwordEmail ?? identity.email ?? "")
                    }
                }
                Button("Refresh sign-in methods", action: model.refreshIdentity)
                Button("Sign out", action: model.signOut)
            }
            if let removing {
                Section(removing == "apple.com" ? "Disconnect Apple" : "Remove email and password") {
                    Text(
                        "Your Bark account, saved data and subscription stay unchanged. Disconnecting a sign-in method does not cancel Apple billing."
                    ).font(.footnote)
                    if removing == "apple.com" {
                        Text(
                            "Confirm your password to keep email sign-in. If you use Apple after disconnecting it, you may create a separate account. To reconnect it here, sign in with email first."
                        ).font(.footnote)
                        Text(identity.passwordEmail ?? "Verify your connected email first.").font(
                            .subheadline)
                        SecureField("Password to keep email sign-in", text: $password).textContentType(
                            .password)
                        Button("Confirm and disconnect Apple", role: .destructive) {
                            model.unlinkApple(password: password)
                            password = ""
                            self.removing = nil
                        }.disabled(password.isEmpty)
                    } else {
                        Text(
                            "Confirm with the connected Apple Account. Apple will be your remaining sign-in method."
                        ).font(.footnote)
                        AccountAppleButton(model: model, intent: .unlinkPassword) { self.removing = nil }
                    }
                    Button("Cancel", role: .cancel) {
                        self.removing = nil
                        password = ""
                    }
                }
            }
            if model.providerButtonsAvailable, model.capabilities.authenticationChanges,
                !identity.providers.contains("apple.com")
            {
                Section("Link Apple") {
                    Text(
                        "Link Apple to this existing Bark account, including when you choose Hide My Email. Your saved data stays in this account."
                    )
                    .font(.footnote)
                    AccountAppleButton(model: model, intent: .link)
                }
            }
        }
    }
}
