import BarkDomain
import StoreKit
import SwiftUI

extension EnvironmentValues {
    @Entry var showPremium: @MainActor () -> Void = {}
}

/// All paid feature entry points use this same navigation action and purchase owner.
struct UpgradeToPremiumButton: View {
    @Environment(\.showPremium) private var show
    var title = "Upgrade to Premium"
    var body: some View {
        Button(action: show) { Text(title).frame(minHeight: 44) }
            .barkActionStyle().accessibilityIdentifier("premium.open")
    }
}

struct PremiumView: View {
    let model: PurchaseService
    let signIn: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var managing = false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("Save your adventures", systemImage: "pawprint.fill").font(.title2.bold())
                    Text(
                        "Save trips and notes to your account, record park visits, and track walks and virtual expeditions."
                    )
                    Text("Your saved information stays on your iPhone for use offline.").font(.footnote)
                }
                Section {
                    membership
                    if model.signedIn {
                        Button("Restore Purchases") { Task { await model.restore() } }
                            .disabled(model.busy || !model.available)
                        Button("Manage Subscription") { managing = true }
                    } else {
                        Button("Sign in to your Bark account", action: signIn)
                    }
                    if model.busy { ProgressView("Checking with Apple…") }
                    if let notice = model.notice {
                        Text(notice).font(.footnote).accessibilityIdentifier("premium.notice")
                    }
                } header: {
                    Text("Membership").foregroundStyle(Color.primary)
                }
                Section {
                    if let offer = model.offer {
                        Text(
                            offer.trialAvailable
                                ? "7 days free, then \(offer.price) per year."
                                : "\(offer.price) per year."
                        )
                        .font(.headline)
                        Text(
                            "Auto-renews until canceled. Manage or cancel in your Apple Account settings. Trial eligibility and payment are confirmed by Apple."
                        )
                        .font(.footnote)
                        Button(offer.trialAvailable ? "Start 7-day free trial" : "Subscribe annually") {
                            Task { await model.buy() }
                        }.disabled(
                            model.busy || model.awaitingConfirmation || !model.signedIn || !model.available
                                || activeSubscription
                        )
                        .accessibilityIdentifier("premium.subscribe")
                    } else {
                        Text(
                            "Apple’s price is not available yet. You won’t be charged without confirming Apple’s purchase sheet."
                        )
                        if model.available {
                            Button("Load subscription offer") { Task { await model.load() } }.disabled(
                                model.busy)
                        }
                    }
                    if !model.available {
                        Text("Purchasing is unavailable in this isolated test or preview build.").font(
                            .footnote)
                    }
                }
                Section {
                    NavigationLink("Privacy policy") { bundledDocument("privacy", title: "Privacy policy") }
                    NavigationLink("Terms of use") { bundledDocument("terms", title: "Terms of use") }
                    Text("Restoring Apple purchases does not import subscriptions from the old web app.")
                        .font(.footnote)
                }
            }
            .navigationTitle("Premium")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .manageSubscriptionsSheet(isPresented: $managing)
            .task { await model.load() }
        }
    }
    private var activeSubscription: Bool {
        model.subscription.map { !$0.revoked && Double($0.expiresAtMs) / 1000 > Date().timeIntervalSince1970 }
            ?? false
    }
    @ViewBuilder private var membership: some View {
        if let subscription = model.subscription {
            Text(
                subscription.revoked
                    ? "Apple subscription revoked"
                    : activeSubscription ? "Apple Premium" : "Apple subscription expired"
            )
            .font(.headline)
            Text(
                "\(subscription.autoRenews ? "Renews" : "Subscription period ends"): \(Date(timeIntervalSince1970: Double(subscription.expiresAtMs) / 1000).formatted(date: .abbreviated, time: .omitted))"
            )
            if subscription.environment == "Sandbox" {
                Text("Apple sandbox — test subscription, not a production charge.").font(.footnote)
            }
        } else if model.account.entitlement.access?.source == "development" {
            Text("Temporary test Premium — not an Apple subscription.")
        } else if model.account.entitlement.access?.source == "none" {
            Text("Free account — No active Apple subscription on this account.")
        } else {
            Text(
                model.signedIn
                    ? "Apple subscription status not yet confirmed."
                    : "Sign in before purchasing or restoring.")
        }
    }
    private func bundledDocument(_ name: String, title: String) -> some View {
        let text =
            Bundle.main.url(forResource: name, withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            ?? "Document unavailable. See Settings → Legal."
        return ScrollView { Text(text).frame(maxWidth: .infinity, alignment: .leading).padding() }
            .navigationTitle(title)
    }
}
