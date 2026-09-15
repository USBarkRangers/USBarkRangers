import BarkDomain
import SwiftUI

struct AccountProfileCard: View {
    let model: AccountModel

    var body: some View {
        VStack(spacing: 14) {
            // Profile photos need their own account-scoped storage policy. Until that
            // feature exists, this is an avatar, not a nonfunctional camera control.
            Image(systemName: "pawprint.fill")
                .font(.system(size: 40, weight: .medium)).foregroundStyle(Color.accentColor)
                .frame(width: 92, height: 92)
                .background(
                    LinearGradient(
                        colors: [.accentColor.opacity(0.18), .accentColor.opacity(0.06)],
                        startPoint: .topLeading, endPoint: .bottomTrailing), in: .circle
                )
                .accessibilityHidden(true)
            VStack(spacing: 6) {
                Text(model.session.profileState?.visible?.displayName ?? "Your Bark account")
                    .font(.title2.bold()).accessibilityIdentifier("account.profile-name")
                Text(model.session.identity?.email ?? "Private email")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityLabel("Email address")
                    .accessibilityValue(model.session.identity?.email ?? "Private email")
                if model.session.identity?.serverConfirmed == false {
                    Text("Saved on this iPhone · waiting to connect").font(.footnote).foregroundStyle(
                        .secondary)
                }
            }
            .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            NavigationLink {
                AccountProfileEditor(model: model)
            } label: {
                Text("Edit Profile")
            }
            .buttonStyle(AccountCardButtonStyle()).accessibilityIdentifier("account.edit-profile")
        }
        .accountCard()
    }
}
