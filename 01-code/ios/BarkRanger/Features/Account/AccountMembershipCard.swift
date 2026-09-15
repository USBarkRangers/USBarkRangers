import BarkDomain
import SwiftUI

struct AccountMembershipCard: View {
    let access: Entitlement?
    @Environment(\.showPremium) private var showPremium

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: access?.premium == true ? "checkmark.seal.fill" : "tree.fill")
                    .font(.system(size: 24)).foregroundStyle(Color.accentColor).frame(width: 52, height: 52)
                    .background(Color.accentColor.opacity(0.1), in: .rect(cornerRadius: 16))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(access.map { $0.premium ? "Premium Plan" : "Free Plan" } ?? "Your membership")
                        .font(.headline).accessibilityIdentifier("account.plan")
                    Text(description).font(.subheadline).foregroundStyle(.secondary)
                }.fixedSize(horizontal: false, vertical: true)
            }
            Button(
                access?.premium == true ? "View Premium membership" : "Upgrade to Premium",
                action: showPremium
            )
            .buttonStyle(AccountCardButtonStyle(prominent: true)).accessibilityIdentifier("premium.open")
        }
        .accountCard()
    }

    private var description: String {
        guard let access else {
            return "Connect to confirm your membership. Your saved data stays on this iPhone."
        }
        return access.premium
            ? "Your places, trips and park adventures—all together, even when you’re offline."
            : "Explore the map for free. Upgrade to save places, record visits and plan trips."
    }
}
