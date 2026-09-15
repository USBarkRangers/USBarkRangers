import BarkDomain
import SwiftUI

/// Membership and sync use existing account projections. Feature totals belong in
/// Passport/Trips, not placeholder rows or extra downloads on the account screen.
struct NativeAccountDetails: View {
    let model: AccountModel
    var body: some View {
        if let profile = model.session.profileState {
            Section {
                accountValue(
                    "Access",
                    value: model.session.entitlement.access.map { $0.premium ? "Premium" : "Free" }
                        ?? "Unconfirmed")
                if model.session.entitlement.access?.source == "development",
                    model.session.entitlement.access?.premium == true
                {
                    Text("Complimentary access. You do not have an Apple subscription.")
                        .font(.footnote)
                }
                if model.session.entitlement.access?.premium == true,
                    let until = model.session.entitlement.access?.validUntil
                {
                    accountValue(
                        "Offline editing available until",
                        value: until.formatted(date: .abbreviated, time: .shortened))
                    Text(
                        "Your saved information stays readable after Premium ends. Connect periodically to keep your membership up to date."
                    )
                    .font(.footnote).foregroundStyle(.secondary)
                }
                if model.session.entitlement.access?.premium == false {
                    Text(
                        "Explore the park map for free. Upgrade to save places, record visits and walks, and plan trips. Your existing saved information remains readable."
                    )
                    .font(.subheadline)
                }
                UpgradeToPremiumButton(
                    title: model.session.entitlement.access?.premium == true
                        ? "Premium membership" : "Upgrade to Premium")
            } header: {
                Text("Membership").foregroundStyle(Color.primary)
            }
            Section {
                if model.session.isSyncing { ProgressView("Checking saved account…") }
                NavigationLink {
                    PendingChangesView(session: model.session)
                } label: {
                    accountValue("Pending changes", value: String(profile.totalPendingCount))
                }
                if profile.totalPendingCount >= NativeSyncPolicy.queueWarning {
                    Text(
                        "Many changes are waiting. Open Pending changes to review them or sync when connected."
                    )
                    .font(.footnote).foregroundStyle(.orange)
                }
                if let message = model.session.message { Text(message).font(.footnote) }
                Button("Sync now") { model.session.requestSync(refresh: true) }
                if profile.conflict { conflict(profile) }
            } header: {
                Text("Sync").foregroundStyle(Color.primary)
            }
        }
    }
    private func conflict(_ reviewed: NativeStore.ProfileView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Profile changes need your review").font(.headline)
            Text(reviewMessage(reviewed.failureCode)).font(.footnote)
            if reviewed.visible?.displayName != reviewed.confirmed?.displayName {
                Text("On this iPhone: \(reviewed.visible?.displayName ?? "—")").font(.footnote)
                Text("On server: \(reviewed.confirmed?.displayName ?? "—")").font(.footnote)
            }
            if reviewed.visible?.mapStyle != reviewed.confirmed?.mapStyle {
                Text("On this iPhone: \(appearance(reviewed.visible?.mapStyle))").font(.footnote)
                Text("On server: \(appearance(reviewed.confirmed?.mapStyle))").font(.footnote)
            }
            if model.canEditData {
                Button("Keep my change") { model.resolveNativeProfile(reviewed, keepLocal: true) }
            }
            Button("Use server value") { model.resolveNativeProfile(reviewed, keepLocal: false) }
        }.accessibilityIdentifier("account-conflict-profile")
    }
    private func appearance(_ style: NativeProfile.MapStyle?) -> String {
        switch style {
        case .default: "Standard map"
        case .satellite: "Satellite map"
        case nil: "—"
        }
    }
    private func reviewMessage(_ code: String?) -> String {
        switch code {
        case "premium-required":
            "The server requires current Premium access. Your edits are retained. Refresh your membership before retrying, or use the server values."
        case "unsupported-contract":
            "These changes require a compatible app version. Your edits are retained."
        case "intent-expired":
            "These edits are too old to submit unchanged. Review them before saving a fresh change."
        case "account-deleting", "forbidden":
            "This account is not accepting edits. Your local changes are retained."
        case "invalid", "operation-reused":
            "The server could not accept these edits. Your local changes are retained for review."
        default: "Review the saved values before choosing which changes to keep."
        }
    }
}
