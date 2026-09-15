import SwiftUI

/// A destructive account action, deliberately outside the offline edit mailroom.
/// Apple-linked accounts require a fresh Apple confirmation after the destructive alert.
struct AccountDeletionSection: View {
    let model: AccountModel
    @State private var password = ""
    @State private var confirm = false
    @State private var confirmApple = false
    var body: some View {
        if model.capabilities.accountManagement {
            Section("Delete account") {
                Text(
                    "Permanently delete this account, its cloud data, saved pins and unsynced changes. Other accounts and guest drafts are not deleted. An internet connection and recent sign-in confirmation are required."
                )
                .font(.footnote)
                if model.session.identity?.providers.contains("password") == true {
                    SecureField("Password to confirm identity", text: $password).textContentType(.password)
                    Button("Confirm identity") {
                        model.reauthenticate(password: password)
                        password = ""
                    }.disabled(password.isEmpty)
                }
                if confirmApple {
                    Text(
                        "Continue with Apple to permanently delete this account and revoke its Apple authorization."
                    )
                    .font(.footnote)
                    AccountAppleButton(model: model, intent: .deleteAccount) { confirmApple = false }
                    Button("Cancel deletion", role: .cancel) { confirmApple = false }
                } else {
                    Button("Delete my account", role: .destructive) { confirm = true }
                        .accessibilityIdentifier("account.delete")
                }
            }
            .alert("Permanently delete this account?", isPresented: $confirm) {
                Button("Permanently delete account", role: .destructive) {
                    if model.session.identity?.providers.contains("apple.com") == true {
                        confirmApple = true
                    } else {
                        model.deleteAccount()
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This cannot be undone. Cloud cleanup continues automatically after you sign out.")
            }
        }
    }
}
