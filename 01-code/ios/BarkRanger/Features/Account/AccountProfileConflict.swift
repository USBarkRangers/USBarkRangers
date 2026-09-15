import BarkDomain
import SwiftUI

/// Existing profile conflict decisions, now alongside the pending changes they resolve.
struct AccountProfileConflict: View {
    let model: AccountModel
    let reviewed: NativeStore.ProfileView

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Profile changes need your review").font(.headline)
            Text(reviewMessage).font(.footnote)
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

    private var reviewMessage: String {
        switch reviewed.failureCode {
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
