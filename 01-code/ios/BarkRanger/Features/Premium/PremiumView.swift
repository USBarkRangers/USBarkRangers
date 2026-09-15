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
    @State private var redeeming = false
    @State private var redemptionSession: UUID?
    @State private var accountAction: AccountAction?
    private enum AccountAction: String, Identifiable {
        case redeem, restore
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "pawprint.fill")
                            .font(.system(size: 38)).foregroundStyle(Color.accentColor)
                            .accessibilityHidden(true)
                        Text("Bark Ranger Premium").font(.title2.bold())
                        Text("More adventures. More memories.").font(.headline)
                        Text("Keep the places you love, plan your next trip and make every walk count.")
                            .font(.subheadline)
                    }
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                }
                annualPlan
                PremiumBenefits()
                Section {
                    PremiumMembership(model: model)
                    if model.signedIn {
                        Button("Restore Purchases") { accountAction = .restore }
                            .disabled(model.busy || !model.available)
                        if model.subscription != nil {
                            Button("Manage Subscription") { managing = true }
                        }
                    } else {
                        Button(action: signIn) {
                            Text("Sign in to your Bark account")
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(minHeight: 44)
                        }
                    }
                    if model.busy { ProgressView("Checking membership…") }
                    if let notice = model.notice {
                        Text(notice).font(.subheadline).accessibilityIdentifier("premium.notice")
                    }
                } header: {
                    Text("Your account").foregroundStyle(Color.primary)
                }
                Section {
                    NavigationLink("Privacy policy") { bundledDocument("privacy", title: "Privacy policy") }
                    NavigationLink("Terms of use") { bundledDocument("terms", title: "Terms of use") }
                }
            }
            .navigationTitle("Premium")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .manageSubscriptionsSheet(isPresented: $managing)
            .offerCodeRedemption(isPresented: $redeeming) { result in
                guard let session = redemptionSession else { return }
                redemptionSession = nil
                Task { await model.completeOfferRedemption(result, session: session) }
            }
            .confirmationDialog(
                "Use this Bark account?",
                isPresented: Binding(
                    get: { accountAction != nil }, set: { if !$0 { accountAction = nil } }
                ), presenting: accountAction
            ) { action in
                Button(action == .redeem ? "Continue to Apple" : "Restore to this account") {
                    let uid = model.account.identity?.uid
                    Task {
                        if action == .redeem {
                            redemptionSession = await model.prepareOfferRedemption(expectedUID: uid)
                            redeeming = redemptionSession != nil
                        } else {
                            await model.restore(expectedUID: uid, claimOffer: true)
                        }
                    }
                }
            } message: { _ in
                Text(
                    "An unlinked Apple offer will belong to \(model.account.identity?.email ?? "the signed-in Bark account"). An existing subscription cannot be moved from another Bark account."
                )
            }
            .task { await model.load() }
        }
    }

    private var annualPlan: some View {
        Section {
            if let offer = model.offer {
                VStack(alignment: .leading, spacing: 12) {
                    Text("One plan. Every Premium feature.").font(.headline)
                    Text("\(offer.price) / year").font(.title.bold())
                        .accessibilityIdentifier("premium.price")
                    if offer.trialAvailable && !model.activeSubscription {
                        Text("Start with 7 days free.").font(.headline)
                    }
                    if model.signedIn && !model.activeSubscription {
                        Button(offer.trialAvailable ? "Start 7-day free trial" : "Subscribe annually") {
                            Task { await model.buy() }
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .barkActionStyle(prominent: true)
                        .disabled(model.busy || model.awaitingConfirmation || !model.available)
                        .accessibilityIdentifier("premium.subscribe")
                    }
                    Text(
                        offer.trialAvailable && !model.activeSubscription
                            ? "7 days free, then \(offer.price) per year. Cancel before the trial ends to avoid a charge. Apple confirms your eligibility."
                            : "\(offer.price) billed annually. Payment is confirmed in Apple’s purchase sheet."
                    )
                    .font(.footnote)
                    Text("Auto-renews until canceled. Manage or cancel in your Apple Account settings.")
                        .font(.footnote)
                }
                .fixedSize(horizontal: false, vertical: true).padding(.vertical, 6)
            } else {
                Text("Annual Premium membership").font(.headline)
                Text(
                    "Connect to the App Store to see your price and free-trial eligibility. No purchase is made until you confirm with Apple."
                )
                .font(.subheadline)
                if model.available {
                    Button("Try again") { Task { await model.load() } }.disabled(model.busy)
                }
            }
            if model.signedIn {
                Button("Redeem offer code") { accountAction = .redeem }
                    .accessibilityIdentifier("premium.redeem")
                    .disabled(model.busy || !model.available || model.awaitingConfirmation)
            }
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
