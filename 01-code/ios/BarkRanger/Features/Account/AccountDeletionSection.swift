import SwiftUI

/// A destructive account action, deliberately outside the offline edit mailroom.
/// APPLE-ACTIVATION: before enabling Apple sign-in, revoke its authorization using
/// a fresh Apple authorization code before submitting this native deletion request.
struct AccountDeletionSection: View {
    let model: AccountModel
    @State private var password = ""
    @State private var confirm = false
    var body: some View {
        if model.capabilities.accountManagement {
            Section("Delete account") {
                Text("Permanently delete this account, its cloud data, saved pins and unsynced changes. Other accounts and guest drafts are not deleted. An internet connection and recent sign-in confirmation are required.")
                    .font(.footnote)
                if model.session.identity?.providers.contains("password") == true {
                    SecureField("Password to confirm identity", text: $password).textContentType(.password)
                    Button("Confirm identity") {
                        model.reauthenticate(password: password)
                        password = ""
                    }.disabled(password.isEmpty)
                }
                Button("Delete my account", role: .destructive) { confirm = true }
                    .accessibilityIdentifier("account.delete")
            }
            .alert("Permanently delete this account?", isPresented: $confirm) {
                Button("Permanently delete account", role: .destructive) { model.deleteAccount() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This cannot be undone. Cloud cleanup continues automatically after you sign out.")
            }
            if model.providerButtonsAvailable {
                AccountProviderButtons(model: model, use: .reauthenticate)
            }
        }
    }
}
