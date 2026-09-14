import BarkDomain
import SwiftUI

/// Current account UI reads a small native profile/access projection. Unconnected
/// feature summaries remain explicitly unavailable, never copied from a legacy blob.
struct NativeAccountDetails: View {
    let model: AccountModel
    var body: some View {
        if let profile = model.session.profileState {
            Section {
                accountValue(
                    "Access", value: model.session.entitlement.access?.premium == true ? "Premium" : "Free")
                accountValue("Status", value: model.session.entitlement.access?.status ?? "Unconfirmed")
                if model.session.entitlement.access?.premium == true,
                    let until = model.session.entitlement.access?.validUntil
                {
                    accountValue(
                        "Premium available offline until",
                        value: until.formatted(date: .abbreviated, time: .shortened))
                    Text(
                        "Connecting refreshes your membership check. Saved park information remains available offline."
                    )
                    .font(.footnote).foregroundStyle(.secondary)
                }
                // APPLE-ACTIVATION: real purchase/restore service is the later services
                // slice. No old provider recovery URL or local Premium grant belongs here.
            } header: {
                Text("Membership").foregroundStyle(Color.primary)
            }
            Section {
                accountValue("Visits", value: "—")
                accountValue("Trips loaded", value: "—")
                accountValue("Completed expeditions", value: "—")
                accountValue("Achievement records", value: "—")
                Text("Feature summaries are not connected in this development build yet.").font(.footnote)
            } header: {
                Text("Saved account data").foregroundStyle(Color.primary)
            }
            Section {
                if model.session.isSyncing { ProgressView("Checking saved account…") }
                accountValue("Pending changes", value: String(profile.pendingCount))
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
