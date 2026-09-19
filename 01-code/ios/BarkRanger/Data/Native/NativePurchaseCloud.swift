import Foundation

/// Bound to the existing native Auth/Functions clients; no new SDK app or account store.
nonisolated struct NativePurchaseCloud: PurchaseVerifying {
    let transport: NativeCallableTransport
    nonisolated private struct Request: Encodable, Sendable {
        let version = 1
        let kind: String
        var signedTransaction: String? = nil
        var claimOffer: Bool? = nil
    }
    func context() async throws -> PurchaseConfirmation { try await call(.init(kind: "context")) }
    func verify(_ proof: String, claimOffer: Bool) async throws -> PurchaseConfirmation {
        try await call(.init(kind: "verify", signedTransaction: proof, claimOffer: claimOffer ? true : nil))
    }
    func refresh() async throws -> PurchaseConfirmation { try await call(.init(kind: "refresh")) }
    private func call(_ request: Request) async throws -> PurchaseConfirmation {
        let reply = try await transport.call("nativePurchase", input: request, as: PurchaseConfirmation.self)
        try NativeCallableTransport.validateReply { try reply.validate() }
        return reply
    }
}
