import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct EntitlementTransitionTests {
    @Test func paidExpiryPublishesGraceWithoutANetworkSnapshot() async throws {
        let repository = EntitlementRepository()
        let end = Date().addingTimeInterval(0.2)
        repository.update(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(end.timeIntervalSince1970 * 1000)), uid: "a")
        #expect(repository.access?.status == "active")
        try await eventually { repository.access?.status == "grace" }
        #expect(repository.access?.premium == true)
        repository.clear()
    }

    @Test func graceExpiryMakesDataReadOnlyAndRenewalKeepsTheSameOwner() async throws {
        let repository = EntitlementRepository()
        let paidEnd = Date().addingTimeInterval(-NativeSyncPolicy.offlineGrace + 0.2)
        repository.update(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(paidEnd.timeIntervalSince1970 * 1000)), uid: "a")
        #expect(repository.access?.status == "grace")
        try await eventually { repository.access?.premium == false }
        #expect(repository.access?.uid == "a" && repository.access?.status == "free")
        repository.update(
            .init(
                revision: 2, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)), uid: "a")
        #expect(repository.access?.status == "active" && repository.access?.uid == "a")
        repository.clear()
        #expect(repository.access == nil)
    }
}
