import Foundation
import Testing

@testable import BarkDomain

struct NativeSyncPolicyTests {
    @Test func membershipLabelsSeparateSubscriptionExpiryFromEditingGrace() {
        let end = Date(timeIntervalSince1970: 1_800_000_000)
        let value = NativeEntitlement(
            revision: 1, premium: true, source: .production,
            validUntilMs: 1_800_000_000_000)
        #expect(Entitlement(native: value, uid: "a", now: end.addingTimeInterval(-1)).status == "active")
        let grace = Entitlement(native: value, uid: "a", now: end)
        #expect(grace.status == "grace" && grace.premium)
        #expect(
            Entitlement(native: value, uid: "a", now: end.addingTimeInterval(40 * 86_400)).status == "free")
    }
    @Test func productionEditingStopsAtFortyDaysButRevocationHasNoGrace() {
        let expiry = Date(timeIntervalSince1970: 1_800_000_000)
        let entitlement = NativeEntitlement(
            revision: 1, premium: true, source: .production,
            validUntilMs: Int64(expiry.timeIntervalSince1970 * 1000))
        #expect(
            entitlement.permitsEditing(at: expiry.addingTimeInterval(NativeSyncPolicy.offlineGrace - 0.001)))
        #expect(!entitlement.permitsEditing(at: expiry.addingTimeInterval(NativeSyncPolicy.offlineGrace)))
        let revoked = NativeEntitlement(
            revision: 2, premium: false, source: .production,
            validUntilMs: entitlement.validUntilMs)
        #expect(!revoked.permitsEditing(at: expiry))
        #expect(NativeSyncPolicy.acceptanceWindow == 45 * 86_400)
        #expect(
            Entitlement(native: entitlement, uid: "owner", now: expiry).validUntil
                == entitlement.editingDeadline)
    }
    @Test func developmentGrantsDoNotGainUnapprovedSubscriptionGrace() {
        let expiry = Date(timeIntervalSince1970: 1_800_000_000)
        let value = NativeEntitlement(
            revision: 1, premium: true, source: .development,
            validUntilMs: Int64(expiry.timeIntervalSince1970 * 1000))
        #expect(!value.permitsEditing(at: expiry))
        #expect(value.editingDeadline == expiry)
    }
}
