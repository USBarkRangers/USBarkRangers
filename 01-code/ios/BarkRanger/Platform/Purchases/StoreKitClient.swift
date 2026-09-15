import Foundation
import StoreKit

/// Apple's storefront and unfinished-transaction storage, with no entitlement authority.
@MainActor final class StoreKitClient: ApplePurchasing {
    private var product: Product?

    func offer() async throws -> PurchaseOffer {
        let values = try await Product.products(for: [AppleMembership.productID])
        guard let value = values.first(where: { $0.id == AppleMembership.productID }),
            value.type == .autoRenewable, let subscription = value.subscription,
            subscription.subscriptionPeriod.value == 1, subscription.subscriptionPeriod.unit == .year
        else { throw PurchaseFailure.unavailableProduct }
        product = value
        let trial = subscription.introductoryOffer
        let eligible = await subscription.isEligibleForIntroOffer
        return PurchaseOffer(
            id: value.id, name: value.displayName, price: value.displayPrice,
            trialAvailable: eligible && trial?.paymentMode == .freeTrial
                && ((trial?.period.value == 1 && trial?.period.unit == .week)
                    || (trial?.period.value == 7 && trial?.period.unit == .day))
        )
    }

    func purchase(accountToken: UUID) async throws -> PurchaseOutcome {
        if product == nil { _ = try await offer() }
        guard let product else { throw PurchaseFailure.unavailableProduct }
        switch try await product.purchase(options: [.appAccountToken(accountToken)]) {
        case .success(let result): return .purchased(try Self.proof(result))
        case .pending: return .pending
        case .userCancelled: return .cancelled
        @unknown default: throw PurchaseFailure.unverifiedTransaction
        }
    }

    func updates() -> AsyncStream<PurchaseProof> {
        AsyncStream { continuation in
            let task = Task {
                for await result in Transaction.updates {
                    guard !Task.isCancelled else { break }
                    // Unverified/other-product transactions cannot grant or finish anything.
                    if let proof = try? Self.proof(result) { continuation.yield(proof) }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func unfinished() async -> [PurchaseProof] {
        var proofs: [PurchaseProof] = []
        for await result in Transaction.unfinished {
            if Task.isCancelled { break }
            if let proof = try? Self.proof(result) { proofs.append(proof) }
        }
        return proofs
    }

    func restore() async throws -> [PurchaseProof] {
        // Only explicit user action calls sync (Apple may ask for authentication).
        try await AppStore.sync()
        var proofs = await unfinished()
        if let latest = await Transaction.latest(for: AppleMembership.productID) {
            let proof = try Self.proof(latest)
            if !proofs.contains(where: { $0.id == proof.id }) { proofs.append(proof) }
        }
        return proofs
    }

    private static func proof(_ result: VerificationResult<Transaction>) throws -> PurchaseProof {
        guard case .verified(let transaction) = result,
            transaction.productID == AppleMembership.productID,
            transaction.ownershipType == .purchased
        else { throw PurchaseFailure.unverifiedTransaction }
        return PurchaseProof(
            id: String(transaction.id), productID: transaction.productID,
            accountToken: transaction.appAccountToken, signedTransaction: result.jwsRepresentation,
            finish: { await transaction.finish() })
    }
}
