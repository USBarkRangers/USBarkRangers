import Foundation
import Testing

@testable import BarkDomain

struct NativeDevelopmentAccessTests {
    @Test func permanentOwnerAccessSurvivesReleaseAndPersistenceWithoutAnAppleSubscription() throws {
        let access = NativeEntitlement(revision: 3, premium: true, source: .owner, validUntilMs: nil)
        let restored = try JSONDecoder().decode(
            NativeEntitlement.self, from: JSONEncoder().encode(access))
        try restored.validate()
        let future = Date(timeIntervalSince1970: 4_000_000_000)
        #expect(restored.permitsEditing(at: future))
        #expect(restored.editingDeadline == nil)
        let display = Entitlement(native: restored, uid: "owner", now: future)
        #expect(display.premium && display.status == "active" && display.validUntil == nil)
        #expect(
            !NativeEntitlement(revision: 4, premium: false, source: .owner, validUntilMs: nil)
                .permitsEditing(at: future))
        #expect(
            !NativeEntitlement(revision: 3, premium: true, source: .owner, validUntilMs: 5_000_000_000_000)
                .permitsEditing(at: future))
        #expect(
            !NativeEntitlement(revision: 3, premium: true, source: .none, validUntilMs: nil)
                .permitsEditing(at: future))
    }

    @Test func developmentAccessExpiresAndIsNeverAnApplePurchase() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let access = NativeEntitlement(
            revision: 2, premium: true, source: .development,
            validUntilMs: 1_800_000_001_000)
        try access.validate()
        #expect(access.source.rawValue == "development")
        #if DEBUG
            #expect(access.permitsEditing(at: now))
        #else
            #expect(!access.permitsEditing(at: now))
        #endif
        #expect(!access.permitsEditing(at: now.addingTimeInterval(1)))
        #expect(
            NativeEntitlement(
                revision: 2, premium: true, source: .sandbox,
                validUntilMs: 1_800_000_001_000
            ).permitsEditing(at: now))
    }
}
