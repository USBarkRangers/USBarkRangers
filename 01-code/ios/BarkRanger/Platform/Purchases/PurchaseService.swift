import BarkDomain
import Foundation
import Observation

/// One app-owned purchase coordinator. StoreKit owns redelivery; NativeStore remains
/// the single local writer and EntitlementRepository the single Premium publisher.
@MainActor @Observable final class PurchaseService {
    let account: AccountSession
    private let store: any ApplePurchasing
    private let connect: (@MainActor (String) throws -> any PurchaseVerifying)?
    private var uid: String?
    private var cloud: (any PurchaseVerifying)?
    private var context: PurchaseConfirmation?
    private var generation = UUID()
    private struct Confirmation {
        let id = UUID()
        let task: Task<Void, Error>
    }
    private var confirmations: [String: Confirmation] = [:]
    private var updatesTask: Task<Void, Never>?
    private var recoveryTask: Task<Void, Never>?
    private(set) var offer: PurchaseOffer?
    private(set) var busy = false
    private(set) var awaitingConfirmation = false
    private(set) var notice: String?
    private(set) var subscription: PurchaseConfirmation.Subscription?
    var available: Bool { connect != nil }
    var signedIn: Bool { account.identity != nil }
    var activeSubscription: Bool {
        subscription.map { !$0.revoked && Double($0.expiresAtMs) / 1000 > Date().timeIntervalSince1970 }
            ?? false
    }

    init(
        account: AccountSession, store: any ApplePurchasing,
        connect: (@MainActor (String) throws -> any PurchaseVerifying)? = nil
    ) {
        self.account = account
        self.store = store
        self.connect = connect
        guard connect != nil else { return }
        let stream = store.updates()
        updatesTask = Task { [weak self] in
            for await proof in stream {
                guard !Task.isCancelled else { return }
                await self?.recover(proof)
            }
        }
    }
    isolated deinit {
        updatesTask?.cancel()
        recoveryTask?.cancel()
    }

    /// Called on identity changes and foreground. Free accounts with no unfinished
    /// purchase cause no new backend calls just for opening the app.
    func activate() {
        if uid != account.identity?.uid {
            generation = UUID()
            uid = account.identity?.uid
            cloud = nil
            context = nil
            subscription = nil
            notice = nil
            busy = false
            awaitingConfirmation = false
            for confirmation in confirmations.values { confirmation.task.cancel() }
            confirmations.removeAll()
            recoveryTask?.cancel()
            recoveryTask = nil
        }
        guard available, signedIn, recoveryTask == nil else { return }
        let generation = generation
        recoveryTask = Task { [weak self, store] in
            for proof in await store.unfinished() {
                guard let self, !Task.isCancelled, self.generation == generation else { return }
                await self.recover(proof)
            }
            guard let self, !Task.isCancelled, self.generation == generation else { return }
            if let access = self.account.profileState?.entitlement,
                [.production, .sandbox].contains(access.source), let expiry = access.validUntilMs,
                Double(expiry) / 1000 - Date().timeIntervalSince1970 <= AppleMembership.nearExpiry
            {
                do {
                    let client = try self.client()
                    try await self.apply(try await client.refresh(), generation: generation)
                } catch {
                    // Keep last confirmed access; the next foreground/Restore retries.
                }
            }
            if self.generation == generation { self.recoveryTask = nil }
        }
    }

    func load() async {
        activate()
        guard available, !busy else { return }
        let generation = generation
        busy = true
        notice = nil
        defer { if self.generation == generation { busy = false } }
        // The App Store offer is public. An unavailable account server must not hide
        // Apple's price; conversely a storefront outage must not hide membership.
        do {
            let offer = try await store.offer()
            try check(generation)
            self.offer = offer
        } catch {
            guard self.generation == generation else { return }
            offer = nil
            notice = Self.message(error)
        }
        do {
            try check(generation)
            if signedIn {
                let client = try client()
                try await apply(try await client.context(), generation: generation)
            }
        } catch { if self.generation == generation { notice = Self.message(error) } }
    }

    func buy() async {
        guard available, !busy else { return }
        let generation = generation
        busy = true
        notice = nil
        defer { if self.generation == generation { busy = false } }
        do {
            let client = try client()
            if context == nil { try await apply(try await client.context(), generation: generation) }
            try check(generation)
            guard let context else { throw PurchaseFailure.accountRequired }
            // Recover Apple's retained transaction before ever showing a second purchase.
            // This survives relaunch without building a second persistent mailroom.
            let unfinished = await store.unfinished()
            try check(generation)
            if !unfinished.isEmpty {
                for proof in unfinished { try await confirm(proof, generation: generation) }
                return
            }
            if context.subscription.map({
                !$0.revoked && Double($0.expiresAtMs) / 1000 > Date().timeIntervalSince1970
            }) == true {
                notice =
                    "This account already has an Apple subscription. Use Manage Subscription or Restore Purchases."
                return
            }
            switch try await store.purchase(accountToken: context.appAccountToken) {
            case .cancelled: break
            case .pending:
                try check(generation)
                notice = "Waiting for Apple’s purchase approval. You haven’t been granted Premium yet."
            case .purchased(let proof):
                // An account switch must leave Apple's transaction unfinished, not
                // acknowledge a purchase against whatever account is now on screen.
                try check(generation)
                notice = "Apple purchase received. Confirming with your Bark account…"
                do { try await confirm(proof, generation: generation) } catch {
                    try check(generation)
                    notice = Self.confirmationMessage(error)
                }
            }
        } catch { if self.generation == generation { notice = Self.message(error) } }
    }

    func restore(expectedUID: String? = nil, claimOffer: Bool = false) async {
        if claimOffer && expectedUID == nil { return }
        if let expectedUID, expectedUID != account.identity?.uid { return }
        guard available, !busy else { return }
        let generation = generation
        busy = true
        notice = nil
        defer { if self.generation == generation { busy = false } }
        do {
            let client = try client()
            if context == nil { try await apply(try await client.context(), generation: generation) }
            let proofs = try await store.restore()
            try check(generation)
            for proof in proofs { try await confirm(proof, generation: generation, claimOffer: claimOffer) }
            if proofs.isEmpty {
                try await apply(try await client.refresh(), generation: generation)
                notice =
                    "No Apple purchases were found for this Apple Account. Your saved Bark data is unchanged."
            }
        } catch {
            if self.generation == generation {
                if let failure = error as? NativeCallableTransport.ServerFailure,
                    ["purchase-account-mismatch", "purchase-link-required"].contains(failure.reason)
                {
                    notice = Self.message(error)
                } else {
                    notice =
                        "Restore could not finish. Your saved data is unchanged. Reconnect and try Restore Purchases again; don’t buy another subscription to restore access."
                }
            }
        }
    }

    /// Capture the chosen account before Apple's sheet. Closing it is not a purchase.
    func prepareOfferRedemption(expectedUID: String?) async -> UUID? {
        activate()
        guard available, !busy, let expectedUID, expectedUID == uid else { return nil }
        let generation = generation
        busy = true
        notice = nil
        defer { if self.generation == generation { busy = false } }
        do {
            try await apply(try await client().context(), generation: generation)
            return generation
        } catch {
            if self.generation == generation { notice = Self.message(error) }
            return nil
        }
    }

    func completeOfferRedemption(_ result: Result<Void, any Error>, session: UUID) async {
        guard generation == session, signedIn else { return }
        guard case .success = result else {
            notice =
                "Apple’s offer-code screen could not finish. You can try again or use Restore Purchases if you already redeemed a code."
            return
        }
        // Reuse Apple's durable delivery, not a new queue or another sign-in prompt.
        for proof in await store.unfinished() {
            do { try await confirm(proof, generation: session, claimOffer: true) } catch {
                if generation == session { notice = Self.confirmationMessage(error) }
            }
        }
    }

    private func recover(_ proof: PurchaseProof) async {
        guard signedIn else { return }
        let generation = generation
        do { try await confirm(proof, generation: generation) } catch {
            if self.generation == generation { notice = Self.confirmationMessage(error) }
        }
    }
    private func confirm(_ proof: PurchaseProof, generation: UUID, claimOffer: Bool = false) async throws {
        try check(generation)
        guard proof.productID == AppleMembership.productID else {
            throw PurchaseFailure.unverifiedTransaction
        }
        if let existing = confirmations[proof.id] {
            do { return try await existing.task.value } catch {
                // An observer may arrive before the user approves linking. Only that
                // specific denial may be retried with explicit consent.
                guard claimOffer, let failure = error as? NativeCallableTransport.ServerFailure,
                    failure.reason == "purchase-link-required"
                else { throw error }
                try check(generation)
            }
        }
        let client = try client()
        let task = Task { [weak self] in
            guard let self else { throw CancellationError() }
            if self.context == nil {
                try await self.apply(try await client.context(), generation: generation)
            }
            try self.check(generation)
            guard proof.accountToken == nil || proof.accountToken == self.context?.appAccountToken else {
                throw NativeCallableTransport.ServerFailure(
                    reason: "purchase-account-mismatch", retryAfterMs: nil)
            }
            self.awaitingConfirmation = true
            try await self.apply(
                try await client.verify(proof.signedTransaction, claimOffer: claimOffer),
                generation: generation)
            try self.check(generation)
            await proof.finish()
            try self.check(generation)
            self.awaitingConfirmation = false
            self.notice = "Apple membership confirmed. Your saved account has been updated."
        }
        let confirmation = Confirmation(task: task)
        confirmations[proof.id] = confirmation
        defer {
            if self.generation == generation, confirmations[proof.id]?.id == confirmation.id {
                confirmations[proof.id] = nil
            }
        }
        try await task.value
    }
    private func apply(_ reply: PurchaseConfirmation, generation: UUID) async throws {
        try check(generation)
        try reply.validate()
        guard let feature = account.nativeProfile, feature.uid == uid else {
            throw PurchaseFailure.accountChanged
        }
        try await feature.store.acceptEntitlement(reply.entitlement)
        try check(generation)
        context = reply
        subscription = reply.subscription
    }
    private func client() throws -> any PurchaseVerifying {
        guard let identity = account.identity, identity.serverConfirmed,
            identity.uid == uid, let connect
        else { throw PurchaseFailure.accountRequired }
        if let cloud { return cloud }
        let client = try connect(identity.uid)
        cloud = client
        return client
    }
    private func check(_ generation: UUID) throws {
        try Task.checkCancellation()
        guard self.generation == generation, account.identity?.uid == uid else {
            throw PurchaseFailure.accountChanged
        }
    }
    static func message(_ error: any Error) -> String {
        switch error {
        case PurchaseFailure.accountRequired:
            return "Sign in to your Bark account and connect to the internet before purchasing or restoring."
        case PurchaseFailure.accountChanged, NativeCallableTransport.Failure.accountChanged:
            return
                "The Bark account changed. Sign in to the account used for your purchase and choose Restore Purchases."
        case PurchaseFailure.unavailableProduct:
            return
                "Apple’s subscription offer is unavailable right now. No purchase was made. Please try again later."
        case let failure as NativeCallableTransport.ServerFailure
        where failure.reason == "purchase-link-required":
            return
                "An Apple offer is ready to link. Choose Restore Purchases and confirm which Bark account should receive it."
        case let failure as NativeCallableTransport.ServerFailure
        where failure.reason == "purchase-account-mismatch":
            return
                "This Apple subscription belongs to a different Bark account. Sign in to that account and restore. It has not been transferred."
        default: return "Purchasing is temporarily unavailable. Check your connection and try again."
        }
    }
    static func confirmationMessage(_ error: any Error) -> String {
        if let failure = error as? NativeCallableTransport.ServerFailure,
            ["purchase-account-mismatch", "purchase-link-required"].contains(failure.reason)
        {
            return message(error)
        }
        return
            "Your Apple purchase is waiting for account confirmation. Don’t buy again. Reconnect and use Restore Purchases; Apple keeps the transaction for retry."
    }
}
