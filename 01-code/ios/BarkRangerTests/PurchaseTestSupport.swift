import BarkDomain
import Foundation

@testable import BarkRanger

@MainActor final class PurchaseStoreFixture: ApplePurchasing {
    let token = UUID()
    var outcome: PurchaseOutcome = .cancelled
    var pending: [PurchaseProof] = []
    var finished: [String] = []
    var purchases = 0
    var offered = true
    var restoreFails = false
    var purchaseWork: (@MainActor () async -> Void)?
    private let channel = AsyncStream<PurchaseProof>.makeStream()
    func offer() async throws -> PurchaseOffer {
        guard offered else { throw PurchaseFailure.unavailableProduct }
        return .init(id: AppleMembership.productID, name: "Premium", price: "$19.99", trialAvailable: true)
    }
    func purchase(accountToken: UUID) async throws -> PurchaseOutcome {
        purchases += 1
        await purchaseWork?()
        if case .purchased(let proof) = outcome { pending.append(proof) }
        return outcome
    }
    func updates() -> AsyncStream<PurchaseProof> { channel.stream }
    func unfinished() async -> [PurchaseProof] { pending }
    func restore() async throws -> [PurchaseProof] {
        if restoreFails { throw PurchaseFailure.unavailableProduct }
        return pending
    }
    func deliver(_ proof: PurchaseProof) { channel.continuation.yield(proof) }
    func proof(id: String = "101", token: UUID? = nil) -> PurchaseProof {
        .init(
            id: id, productID: AppleMembership.productID, accountToken: token ?? self.token,
            signedTransaction: "fixture-\(id)",
            finish: { [weak self] in
                await MainActor.run {
                    self?.finished.append(id)
                    self?.pending.removeAll { $0.id == id }
                }
            })
    }
}

actor PurchaseCloudFixture: PurchaseVerifying {
    let token: UUID
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    var accepted = false
    var revoked = false
    var failing = false
    var calls: [String] = []
    var verifyWaiter: CheckedContinuation<Void, Never>?
    var shouldHold = false
    init(token: UUID) { self.token = token }
    func setFailing(_ value: Bool) { failing = value }
    func setRevoked() { revoked = true }
    func hold() { shouldHold = true }
    func release() {
        shouldHold = false
        verifyWaiter?.resume()
        verifyWaiter = nil
    }
    func context() -> PurchaseConfirmation {
        calls.append("context")
        return reply()
    }
    func verify(_ proof: String) async throws -> PurchaseConfirmation {
        calls.append("verify")
        if shouldHold { await withCheckedContinuation { verifyWaiter = $0 } }
        if failing { throw PurchaseFailure.unavailableProduct }
        accepted = true
        return reply()
    }
    func refresh() -> PurchaseConfirmation {
        calls.append("refresh")
        return reply()
    }
    func reply() -> PurchaseConfirmation {
        let expiry = now + 3600_000
        return .init(
            version: 1, appAccountToken: token, productID: AppleMembership.productID,
            entitlement: .init(
                revision: revoked ? 4 : accepted ? 3 : 2, premium: accepted && !revoked,
                source: accepted ? .sandbox : .none, validUntilMs: accepted ? expiry : nil),
            subscription: accepted
                ? .init(
                    environment: "Sandbox", expiresAtMs: expiry,
                    autoRenews: !revoked, revoked: revoked, checkedAtMs: now) : nil)
    }
}
