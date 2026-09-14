import Foundation

/// Server-issued native access, bound to one account. See NativeSyncPolicy for offline grace.
public struct Entitlement: Equatable, Sendable {
    public let uid: String
    public let status: String
    public let source: String
    public let premium: Bool
    public let validUntil: Date?

    /// The signed-in scope supplies the owner UID; no payment-provider fields enter the UI.
    public init(native: NativeEntitlement, uid: String, now: Date = Date()) {
        self.uid = uid
        premium = native.permitsEditing(at: now)
        status = premium ? "active" : "free"
        source = native.source.rawValue
        validUntil = native.editingDeadline
    }

}
