import Foundation

/// Offline policy, not a deletion timer. Keep unsynced work until accepted or
/// explicitly discarded. Update backend shared/syncPolicy.js and boundary tests
/// together when changing either window: 40 days editing + five days to retry.
public enum NativeSyncPolicy {
    public static let offlineGrace: TimeInterval = 40 * 86_400
    public static let acceptanceWindow: TimeInterval = 45 * 86_400
    // One ordinary outbox limit; park captures bypass it. Raise this only with
    // reader/performance checks. Readers must never classify a larger queue as corrupt.
    public static let queueLimit = 1_000
    public static let queueWarning = 800
    public static let deliveryBatch = 128
    public static let cleanTripItems = 100
    public static let cleanTripBytes = 64 * 1_024 * 1_024
}
