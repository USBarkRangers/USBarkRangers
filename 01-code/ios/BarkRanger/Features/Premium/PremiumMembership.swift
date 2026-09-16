import BarkDomain
import SwiftUI

/// A presentation of server-confirmed membership, never another entitlement owner.
struct PremiumMembership: View {
    let model: PurchaseService

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.ownerPremium {
                Label("Owner Premium", systemImage: "gift.fill").font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Permanent complimentary access. No charge or renewal.").font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Available wherever you sign in to this Bark account.").font(.footnote)
                    .fixedSize(horizontal: false, vertical: true)
                if model.subscription?.autoRenews == true {
                    Text(
                        "An existing Apple subscription renews separately. Use Manage Subscription to cancel it."
                    )
                    .font(.footnote).fixedSize(horizontal: false, vertical: true)
                }
            } else if let subscription = model.subscription {
                Label(
                    title(subscription),
                    systemImage: model.activeSubscription ? "checkmark.seal.fill" : "person.crop.circle"
                )
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
                LabeledContent(
                    dateLabel(subscription),
                    value: Date(
                        timeIntervalSince1970: Double(subscription.expiresAtMs) / 1000
                    ).formatted(date: .abbreviated, time: .omitted)
                )
                .fixedSize(horizontal: false, vertical: true)
                if subscription.environment == "Sandbox" {
                    // Apple requires sandbox for TestFlight/App Review. Never disguise it
                    // as a production payment; actual App Store buyers do not see this row.
                    Text("Apple sandbox subscription · No real charge").font(.footnote)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else if model.account.entitlement.access?.source == "development",
                model.account.entitlement.access?.premium == true
            {
                Label("Complimentary Premium", systemImage: "gift").font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text("You have temporary complimentary access, not an Apple subscription.").font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Label(model.signedIn ? "Your membership" : "Join the adventure", systemImage: "pawprint")
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text(
                    model.account.entitlement.access?.premium == false
                        ? "Free account. Upgrade to unlock every Premium feature."
                        : model.signedIn
                            ? "Connect to confirm your Apple subscription."
                            : "Sign in to save your adventures."
                )
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
            }
            if model.account.entitlement.access?.status == "grace",
                let until = model.account.entitlement.access?.validUntil
            {
                Text(
                    "Your subscription has ended. Bark’s editing grace lasts through \(until.formatted(date: .abbreviated, time: .omitted)). Renew to keep editing afterward. Your saved data will stay readable."
                )
                .font(.subheadline).fixedSize(horizontal: false, vertical: true)
            } else if model.account.entitlement.access?.premium == false {
                Text("Your saved data stays readable. Renewing restores editing on this same Bark account.")
                    .font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 4)
    }

    private func title(_ subscription: PurchaseConfirmation.Subscription) -> String {
        subscription.revoked
            ? "Subscription access ended"
            : model.activeSubscription ? "Bark Ranger Premium" : "Subscription expired"
    }

    private func dateLabel(_ subscription: PurchaseConfirmation.Subscription) -> String {
        if subscription.revoked { return "Subscription period end" }
        if !model.activeSubscription { return "Expired" }
        return subscription.autoRenews ? "Renews" : "Available until"
    }
}
