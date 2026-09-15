import Foundation
import StoreKit
import StoreKitTest
import XCTest

@testable import BarkRanger

/// Real StoreKit machinery on the Mac simulator. The configuration lives ONLY in
/// the test bundle; no local transaction is submitted to the live native backend.
nonisolated final class StoreKitClientTests: XCTestCase {
    @MainActor func testAnnualOfferPurchaseRetentionRestoreRenewalAndRefund() async throws {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "ApplePurchases", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: url)
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        session.billingGracePeriodIsEnabled = false
        session.timeRate = .realTime
        defer {
            session.clearTransactions()
            session.resetToDefaultState()
        }

        let client = StoreKitClient()
        let token = UUID()
        let offer = try await client.offer()
        XCTAssertEqual(offer.id, AppleMembership.productID)
        XCTAssertEqual(offer.price, "$19.99")
        XCTAssertTrue(offer.trialAvailable)
        guard case .purchased(let proof) = try await client.purchase(accountToken: token) else {
            return XCTFail("The isolated annual purchase did not complete")
        }
        XCTAssertEqual(proof.accountToken, token)
        XCTAssertEqual(proof.signedTransaction.split(separator: ".").count, 3)
        let restartedClient = StoreKitClient()
        let retained = await restartedClient.unfinished()
        XCTAssertEqual(retained.map(\.id), [proof.id])
        await proof.finish()
        let finished = await restartedClient.unfinished()
        XCTAssertTrue(finished.isEmpty)
        let restored = try await restartedClient.restore()
        XCTAssertEqual(restored.map(\.id), [proof.id])
        XCTAssertEqual(restored.first?.accountToken, token)

        try session.forceRenewalOfSubscription(productIdentifier: AppleMembership.productID)
        try await eventually { await restartedClient.unfinished().contains { $0.id != proof.id } }
        let unfinishedRenewals = await restartedClient.unfinished()
        let renewed = try XCTUnwrap(unfinishedRenewals.first { $0.id != proof.id })
        XCTAssertEqual(renewed.accountToken, token)
        await renewed.finish()
        try session.refundTransaction(identifier: try XCTUnwrap(UInt(renewed.id)))
        try await eventually {
            if case .verified(let latest) = await Transaction.latest(for: AppleMembership.productID) {
                return latest.revocationDate != nil
            }
            return false
        }
        // Refunds remain available to Restore even though currentEntitlements excludes them.
        let refunded = try await restartedClient.restore()
        XCTAssertTrue(refunded.contains { $0.id == renewed.id })
    }
}
