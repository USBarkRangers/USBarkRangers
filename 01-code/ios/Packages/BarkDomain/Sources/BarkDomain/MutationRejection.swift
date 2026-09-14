import Foundation

/// Fixed user-facing vocabulary; backend descriptions and unknown details are never shown verbatim.
public enum MutationRejection {
    public static func message(for reason: String?) -> String {
        switch reason {
        case "duplicate-walk", "overlapping-walk":
            "This walk was already recorded or overlaps another recorded workout. Review history before retrying."
        case "changed-trail-run", "incomplete-expedition":
            "The active trail or its confirmed progress changed. Review the expedition before retrying."
        case "walk-history-limit":
            "Walk history has reached its limit. Your data is retained; contact support."
        case "invalid-walk", "implausible-walk", "walk-correction-limit", "manual-walk-limit":
            "The walk's distance or time is outside the supported limits. Review the entry before retrying."
        case "duplicate-trail-run", "duplicate-completion":
            "This trail run was already used or completed. Your existing progress is retained."
        case "premium-required": AccountDataAccess.readOnlyMessage
        case "permission-denied":
            "This account cannot accept the change. Sign in again or contact support; your saved data is retained."
        case "account-size-limit":
            "This account has reached its data limit. Your data is retained; contact support before retrying."
        case "achievement-history-limit", "precondition-failed":
            "This account needs review before the change can be accepted. Your data is retained."
        case "invalid-change", "server-rejected-change":
            "This change is not supported by the server. Review it or update the app."
        case "expired-operation":
            "This change is too old to submit. Review your latest saved data before trying again."
        case "operation-id-reused":
            "This change could not be verified. Your data is retained; contact support."
        default: "The server did not accept this change. Your data is retained for review."
        }
    }
}
