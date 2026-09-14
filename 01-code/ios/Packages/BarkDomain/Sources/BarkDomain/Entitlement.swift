import Foundation

/// Server-issued access, bound to one account. Offline validity never exceeds 30 days or an earlier expiry.
public struct Entitlement: Equatable, Sendable {
    public let uid: String
    public let status: String
    public let source: String
    public let premium: Bool
    public let validUntil: Date?
    public let isLemon: Bool

    /// Native access projection does not manufacture an old PersonalSnapshot or
    /// import legacy provider fields. The signed-in scope supplies the owner UID.
    public init(native: NativeEntitlement, uid: String, now: Date = Date()) {
        self.uid = uid
        premium = native.permitsEditing(at: now)
        status = premium ? "active" : "free"
        source = native.source.rawValue
        validUntil = native.validUntilMs.map { Date(timeIntervalSince1970: Double($0) / 1000) }
        isLemon = false
    }

    public init(snapshot: PersonalSnapshot, now: Date = Date()) {
        uid = snapshot.uid
        let fields = snapshot.profile.fields["entitlement"]?.object ?? [:]
        status = fields["status"]?.string ?? "free"
        source = fields["source"]?.string ?? "none"
        isLemon =
            source == "lemon_squeezy" || fields["providerSubscriptionId"]?.string != nil
            || fields["lemonSqueezySubscriptionId"]?.string != nil
        let expiryKeys = ["currentPeriodEnd", "endsAt", "expiresAt"]
        let invalidExpiry = expiryKeys.contains { key in
            guard let value = fields[key], value != .null else { return false }
            return value.date == nil
        }
        let dates = expiryKeys.compactMap { fields[$0]?.date }
        let cacheEnd = snapshot.confirmedAt?.addingTimeInterval(30 * 24 * 60 * 60)
        validUntil = (dates + [cacheEnd].compactMap { $0 }).min()
        let active =
            ["active", "manual_active", "past_due", "paused", "cancelled_active"].contains(status)
            || (source == "access_code" && status == "access_code_active"
                && fields["expiresAt"]?.date.map { $0 > now } == true)
        premium =
            fields["premium"]?.bool == true && active && cacheEnd != nil
            && snapshot.confirmedAt.map { $0 <= now.addingTimeInterval(60) } == true
            && validUntil.map { $0 > now } == true && !invalidExpiry
    }
}
