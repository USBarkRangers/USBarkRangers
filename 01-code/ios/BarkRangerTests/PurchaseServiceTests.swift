import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct PurchaseServiceTests {
    @Test func delayedFreeContextCannotReplaceANewerConfirmedPurchase() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        await cloud.holdContext()
        let loading = Task { await model.load() }
        try await eventually { await cloud.contextWaiter != nil }
        store.deliver(store.proof())
        try await eventually { model.subscription != nil && store.finished == ["101"] }
        await cloud.releaseContext()
        await loading.value
        #expect(model.subscription != nil && model.activeSubscription)
        #expect(f.session.entitlement.access?.premium == true)
        try await f.close()
    }
    @Test func restoreFailureDoesNotClaimAnUnmadePurchaseIsWaitingForConfirmation() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: UUID())
        store.restoreFails = true
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        await model.restore()
        #expect(model.notice?.hasPrefix("Restore could not finish.") == true)
        #expect(store.purchases == 0 && store.finished.isEmpty && !model.awaitingConfirmation)
        #expect(await cloud.calls.filter { $0 == "verify" }.isEmpty)
        try await f.close()
    }
    @Test func successUpdatesExistingWriterAndPublisherBeforeFinishingAppleTransaction() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let matching = PurchaseCloudFixture(token: store.token)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in matching })
        await model.load()
        store.outcome = .purchased(store.proof())
        await model.buy()
        try await eventually { f.session.entitlement.access?.source == "app-store-sandbox" }
        #expect(store.finished == ["101"])
        #expect(!model.awaitingConfirmation)
        #expect(model.subscription?.environment == "Sandbox")
        #expect(try await f.session.nativeProfile?.store.profileView().entitlement?.source == .sandbox)
        try await f.close()
    }
    @Test func pendingAndCancellationDoNotGrantOrFinishAnything() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: UUID())
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        store.outcome = .pending
        await model.buy()
        #expect(model.notice?.contains("Waiting for Apple") == true)
        try await eventually { f.session.profileState?.entitlement?.source == NativeEntitlement.Source.none }
        store.outcome = .cancelled
        await model.buy()
        #expect(store.finished.isEmpty)
        #expect(await cloud.calls.filter { $0 == "verify" }.isEmpty)
        try await f.close()
    }
    @Test func failedConfirmationSurvivesCoordinatorRelaunchAndRecoversWithoutBuyingAgain() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let matching = PurchaseCloudFixture(token: store.token)
        var model: PurchaseService? = PurchaseService(
            account: f.session, store: store, connect: { _ in matching })
        await model?.load()
        await matching.setFailing(true)
        store.outcome = .purchased(store.proof())
        await model?.buy()
        #expect(store.finished.isEmpty && store.pending.count == 1)
        #expect(model?.awaitingConfirmation == true)
        #expect(model?.notice?.contains("Don’t buy again") == true)
        model = nil
        await matching.setFailing(false)
        let relaunched = PurchaseService(account: f.session, store: store, connect: { _ in matching })
        relaunched.activate()
        try await eventually { store.finished == ["101"] }
        #expect(store.purchases == 1)
        try await f.close()
    }
    @Test func duplicateUpdateAndPurchaseReplyShareOneBackendConfirmation() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let matching = PurchaseCloudFixture(token: store.token)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in matching })
        await model.load()
        await matching.hold()
        let proof = store.proof()
        store.outcome = .purchased(proof)
        let work = Task { await model.buy() }
        try await eventually { await matching.calls.contains("verify") }
        store.deliver(proof)
        // Both deliveries are held behind the same server confirmation.
        await Task.yield()
        await matching.release()
        await work.value
        try await eventually { !store.finished.isEmpty }
        #expect(await matching.calls.filter { $0 == "verify" }.count == 1)
        #expect(store.finished == ["101"])
        try await f.close()
    }
    @Test func wrongBarkAccountCannotConfirmOrFinishAnotherAccountsApplePurchase() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: UUID())
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        store.outcome = .purchased(store.proof())
        await model.buy()
        #expect(store.finished.isEmpty)
        #expect(await cloud.calls.filter { $0 == "verify" }.isEmpty)
        #expect(model.notice?.contains("different Bark account") == true)
        try await f.close()
    }
    @Test func signOutDuringAppleSheetLeavesTransactionUnfinishedAndDoesNotPublishPremium() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: UUID())
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        store.outcome = .purchased(store.proof())
        store.purchaseWork = {
            f.auth.select(nil)
            try? await eventually { f.session.identity == nil }
            model.activate()
        }
        await model.buy()
        #expect(store.finished.isEmpty && store.pending.count == 1)
        #expect(model.subscription == nil)
        #expect(await cloud.calls.filter { $0 == "verify" }.isEmpty)
        try await f.close()
    }
    @Test func storeOutageKeepsMembershipAndRestoreAvailableAndUnconfirmedSignInCannotPurchase() async throws
    {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: UUID())
        store.offered = false
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        #expect(model.offer == nil)
        #expect(await cloud.calls.contains("context"))
        await model.restore()
        #expect(await cloud.calls.contains("refresh"))
        f.auth.select("a", confirmed: false)
        try await eventually { f.session.identity?.serverConfirmed == false }
        await model.buy()
        #expect(store.purchases == 0)
        try await f.close()
    }
    @Test func signOutDuringServerConfirmationCannotPublishOrFinishAgainstAnotherSession() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: UUID())
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        store.outcome = .purchased(store.proof(token: cloud.token))
        await cloud.hold()
        let work = Task { await model.buy() }
        try await eventually { await cloud.verifyWaiter != nil }
        f.auth.select(nil)
        try await eventually { f.session.identity == nil }
        model.activate()
        await cloud.release()
        await work.value
        #expect(store.finished.isEmpty && store.pending.count == 1)
        #expect(model.subscription == nil && f.session.entitlement.access == nil)
        try await f.close()
    }
    @Test func retryingAnUnconfirmedPurchaseNeverStartsASecondApplePurchase() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        await cloud.setFailing(true)
        store.outcome = .purchased(store.proof())
        await model.buy()
        await model.buy()
        #expect(store.purchases == 1 && store.finished.isEmpty)
        await cloud.setFailing(false)
        await model.buy()
        #expect(store.purchases == 1 && store.finished == ["101"])
        try await f.close()
    }
    @Test func verifiedRefundRemovesGraceThroughTheExistingEntitlementPublisher() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let store = PurchaseStoreFixture()
        let cloud = PurchaseCloudFixture(token: store.token)
        let model = PurchaseService(account: f.session, store: store, connect: { _ in cloud })
        await model.load()
        store.outcome = .purchased(store.proof())
        await model.buy()
        try await eventually { f.session.entitlement.access?.premium == true }
        await cloud.setRevoked()
        store.deliver(store.proof())
        try await eventually { f.session.entitlement.access?.premium == false }
        #expect(model.subscription?.revoked == true)
        #expect(try await f.session.nativeProfile?.store.profileView().entitlement?.premium == false)
        try await f.close()
    }
}
