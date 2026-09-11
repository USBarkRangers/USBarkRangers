import Foundation
import Testing

@testable import BarkDomain

struct EntitlementTests {
    private let now = Date(timeIntervalSince1970: 1_789_000_000)
    @Test(arguments: ["active", "manual_active", "past_due", "paused", "cancelled_active"])
    func existingStatusMatrixAndThirtyDayCache(_ status: String) {
        let snapshot = snapshot(status: status)
        #expect(Entitlement(snapshot: snapshot, now: now).premium)
        #expect(Entitlement(snapshot: snapshot, now: now.addingTimeInterval(30 * 86400)).premium == false)
        #expect(Entitlement(snapshot: snapshot, now: now).uid == "a")
    }
    @Test func absentUnconfirmedOrFutureConfirmationNeverGrantsAccess() {
        var snapshot = snapshot(status: "active")
        snapshot.confirmedAt = nil
        #expect(!Entitlement(snapshot: snapshot, now: now).premium)
        snapshot.confirmedAt = now.addingTimeInterval(300)
        #expect(!Entitlement(snapshot: snapshot, now: now).premium)
        #expect(!Entitlement(snapshot: .init(uid: "b"), now: now).premium)
    }
    @Test func earlierExpiryMalformedExpiryAndAccessCodeAreHandledConservatively() {
        var snapshot = snapshot(status: "active")
        snapshot.profile.fields["entitlement"] = .object([
            "premium": .bool(true), "status": .string("active"),
            "currentPeriodEnd": .number(now.addingTimeInterval(10).timeIntervalSince1970 * 1000),
        ])
        #expect(!Entitlement(snapshot: snapshot, now: now.addingTimeInterval(11)).premium)
        snapshot.profile.fields["entitlement"] = .object([
            "premium": .bool(true), "status": .string("active"), "expiresAt": .string("broken"),
        ])
        #expect(!Entitlement(snapshot: snapshot, now: now).premium)
        snapshot.profile.fields["entitlement"] = .object([
            "premium": .bool(true), "status": .string("access_code_active"),
            "source": .string("access_code"),
            "expiresAt": .object([
                "seconds": .number(now.timeIntervalSince1970 + 30), "nanoseconds": .number(0),
            ]),
        ])
        #expect(Entitlement(snapshot: snapshot, now: now).premium)
        #expect(!Entitlement(snapshot: snapshot, now: now.addingTimeInterval(31)).premium)
    }
    private func snapshot(status: String) -> PersonalSnapshot {
        .init(
            uid: "a",
            profile: .init(fields: [
                "entitlement": .object([
                    "premium": .bool(true), "status": .string(status),
                ])
            ]), confirmedAt: now)
    }
}
