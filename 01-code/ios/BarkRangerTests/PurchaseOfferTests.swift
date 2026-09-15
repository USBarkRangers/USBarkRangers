import Foundation
import Testing

@testable import BarkRanger

@MainActor struct PurchaseOfferTests {
    @Test func accountOutageDoesNotHideApplesPriceAndRetryClearsNotice() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        await cloud.setContextFailing(true)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        #expect(model.offer?.price == "$19.99" && model.notice != nil)
        #expect(store.purchases == 0)
        await cloud.setContextFailing(false)
        await model.load()
        #expect(model.offer?.trialAvailable == true && model.notice == nil)
        store.offered = false
        await model.load()
        #expect(model.offer == nil)
        #expect(await cloud.calls.filter { $0 == "context" }.count == 3)
        #expect(store.offerCalls == 3)
        try await f.close()
    }

    @Test func closingRedemptionWithoutTransactionCannotGrantAnything() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        let session = try #require(await model.prepareOfferRedemption(expectedUID: f.session.identity?.uid))
        await model.completeOfferRedemption(.success(()), session: session)
        #expect(await cloud.claimFlags.isEmpty)
        #expect(model.subscription == nil && store.finished.isEmpty && store.purchases == 0)
        try await f.close()
    }

    @Test func tokenlessOfferNeedsExplicitLinkAndUsesExistingWriterAndFinishPath() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        await cloud.requireOfferLink()
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        let base = store.proof()
        let proof = PurchaseProof(
            id: base.id, productID: base.productID, accountToken: nil,
            signedTransaction: base.signedTransaction, finish: base.finish)
        store.pending = [proof]
        await model.restore()
        #expect(model.notice?.contains("Choose Restore Purchases") == true)
        #expect(model.subscription == nil && store.finished.isEmpty)
        await model.restore(expectedUID: f.session.identity?.uid, claimOffer: true)
        #expect(await cloud.claimFlags == [false, true])
        #expect(model.subscription?.environment == "Sandbox")
        #expect(store.finished == [proof.id] && store.purchases == 0)
        try await f.close()
    }

    @Test func accountChangeDuringRedemptionCannotAttachOfferToNextAccount() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        let session = try #require(await model.prepareOfferRedemption(expectedUID: f.session.identity?.uid))
        f.auth.select(nil)
        try await eventually { f.session.identity == nil }
        model.activate()
        store.pending = [store.proof()]
        await model.completeOfferRedemption(.success(()), session: session)
        #expect(await cloud.claimFlags.isEmpty)
        #expect(store.finished.isEmpty && model.subscription == nil)
        try await f.close()
    }

    @Test func offerSheetAndBackgroundDeliveryShareConfirmationWithoutDroppingConsent() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        await cloud.requireOfferLink()
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        let session = try #require(await model.prepareOfferRedemption(expectedUID: f.session.identity?.uid))
        let base = store.proof()
        let proof = PurchaseProof(
            id: base.id, productID: base.productID, accountToken: nil,
            signedTransaction: base.signedTransaction, finish: base.finish)
        store.pending = [proof]
        await cloud.hold()
        store.deliver(proof)
        try await eventually { await cloud.verifyWaiter != nil }
        let completed = Task { await model.completeOfferRedemption(.success(()), session: session) }
        await Task.yield()
        await cloud.release()
        await completed.value
        try await eventually { store.finished == [proof.id] }
        #expect(await cloud.claimFlags == [false, true])
        #expect(store.purchases == 0 && !model.awaitingConfirmation)
        try await f.close()
    }

    @Test func linkingRequiresTheExplicitlyChosenAccountAndFailedSheetCannotGrant() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        await model.restore(claimOffer: true)
        await model.restore(expectedUID: "different-account", claimOffer: true)
        #expect(await cloud.claimFlags.isEmpty)
        let session = try #require(await model.prepareOfferRedemption(expectedUID: f.session.identity?.uid))
        store.pending = [store.proof()]
        await model.completeOfferRedemption(.failure(PurchaseFailure.unavailableProduct), session: session)
        #expect(await cloud.claimFlags.isEmpty)
        #expect(store.finished.isEmpty && model.notice?.contains("could not finish") == true)
        try await f.close()
    }
}
