import FirebaseFunctions
import Foundation

/// Callable validation and transport failures have different durable queue behavior.
nonisolated enum MutationFailurePolicy {
    enum Disposition: Equatable {
        case rejected(String)
        case retry(Date?)
    }
    static func classify(_ error: any Error, now: Date = Date()) -> Disposition {
        let error = error as NSError
        guard error.domain == FunctionsErrorDomain else { return .retry(nil) }
        let details = error.userInfo[FunctionsErrorDetailsKey] as? [String: Any] ?? [:]
        let reason = details["reason"] as? String
        switch FunctionsErrorCode(rawValue: error.code) {
        case .invalidArgument: return .rejected("invalid-change")
        case .alreadyExists: return .rejected("operation-id-reused")
        case .permissionDenied: return .rejected("permission-denied")
        case .failedPrecondition:
            return .rejected(
                reason == "achievement-history-limit" ? "achievement-history-limit" : "precondition-failed")
        case .resourceExhausted:
            if reason == "account-size-limit" { return .rejected("account-size-limit") }
            // Quota/rate failures stay retryable, including unknown resource exhaustion.
            var dates: [Date] = []
            if let seconds = details["retryAfterSeconds"] as? Double, seconds.isFinite, seconds > 0 {
                dates.append(now.addingTimeInterval(seconds))
            }
            if let value = details["retryAt"] as? String {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: value) {
                    dates.append(date)
                } else {
                    formatter.formatOptions = [.withInternetDateTime]
                    if let date = formatter.date(from: value) { dates.append(date) }
                }
            }
            return .retry(dates.filter { $0 > now }.max())
        default: return .retry(nil)
        }
    }
}

nonisolated struct MutationRetryFailure: Error { let retryAt: Date }
