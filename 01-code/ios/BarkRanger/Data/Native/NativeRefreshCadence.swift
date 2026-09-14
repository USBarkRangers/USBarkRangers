import Foundation

/// An account-lifetime freshness bound, not a timer or a durable cache version.
/// Only accepted server reads advance it. Reopening an account always revalidates;
/// commands, explicit refreshes and exact revision/conflict checks bypass the bound.
nonisolated struct NativeRefreshCadence: Sendable {
    private var lastSuccess: Date?
    private let interval: TimeInterval

    init(interval: TimeInterval = 300) { self.interval = interval }

    func isDue(at now: Date) -> Bool {
        guard let lastSuccess else { return true }
        let elapsed = now.timeIntervalSince(lastSuccess)
        return elapsed < 0 || elapsed >= interval
    }

    mutating func accepted(at now: Date) { lastSuccess = now }
}
