import BarkDomain
import Foundation

nonisolated enum AppleMembership {
    static let productID = "swarm.USBARKRANGERS.premium.annual"
    static let nearExpiry: TimeInterval = 24 * 60 * 60
}

nonisolated struct PurchaseOffer: Equatable, Sendable {
    let id: String
    let name: String
    let price: String
    let trialAvailable: Bool
}

nonisolated struct PurchaseProof: Sendable {
    let id: String
    let productID: String
    let accountToken: UUID?
    let signedTransaction: String
    let finish: @Sendable () async -> Void
}

nonisolated enum PurchaseOutcome: Sendable {
    case purchased(PurchaseProof)
    case pending, cancelled
}

@MainActor protocol ApplePurchasing: AnyObject {
    func offer() async throws -> PurchaseOffer
    func purchase(accountToken: UUID) async throws -> PurchaseOutcome
    func updates() -> AsyncStream<PurchaseProof>
    func unfinished() async -> [PurchaseProof]
    func restore() async throws -> [PurchaseProof]
}

nonisolated struct PurchaseConfirmation: Decodable, Sendable {
    nonisolated struct Subscription: Decodable, Equatable, Sendable {
        let environment: String
        let expiresAtMs: Int64
        let autoRenews: Bool
        let revoked: Bool
        let checkedAtMs: Int64
    }
    let version: Int
    let appAccountToken: UUID
    let productID: String
    let entitlement: NativeEntitlement
    let subscription: Subscription?

    func validate() throws {
        try entitlement.validate()
        guard version == 1, productID == AppleMembership.productID,
            subscription.map({
                ["Production", "Sandbox"].contains($0.environment)
                    && $0.expiresAtMs > 0 && $0.checkedAtMs > 0
            }) ?? true
        else { throw NativeCallableTransport.Failure.invalidReply }
    }
}

nonisolated protocol PurchaseVerifying: Sendable {
    func context() async throws -> PurchaseConfirmation
    func verify(_ proof: String, claimOffer: Bool) async throws -> PurchaseConfirmation
    func refresh() async throws -> PurchaseConfirmation
}

nonisolated enum PurchaseFailure: Error {
    case unavailableProduct, unverifiedTransaction, accountRequired, accountChanged
}
