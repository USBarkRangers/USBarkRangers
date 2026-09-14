import BarkDomain
import FirebaseFunctions
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct MutationFailureTests {
    @Test func callableClassificationDistinguishesQuotaFromPermanentLimits() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func error(_ code: FunctionsErrorCode, _ details: [String: Any] = [:]) -> NSError {
            NSError(
                domain: FunctionsErrorDomain, code: code.rawValue,
                userInfo: [FunctionsErrorDetailsKey: details])
        }
        #expect(
            MutationFailurePolicy.classify(error(.resourceExhausted, ["reason": "account-size-limit"]))
                == .rejected("account-size-limit"))
        #expect(
            MutationFailurePolicy.classify(
                error(.failedPrecondition, ["reason": "achievement-history-limit"]))
                == .rejected("achievement-history-limit"))
        #expect(MutationFailurePolicy.classify(error(.invalidArgument)) == .rejected("invalid-change"))
        #expect(MutationFailurePolicy.classify(error(.resourceExhausted)) == .retry(nil))
        #expect(
            MutationFailurePolicy.classify(error(.resourceExhausted, ["retryAfterSeconds": 600.0]), now: now)
                == .retry(now.addingTimeInterval(600)))
        let reset = ISO8601DateFormatter().string(from: now.addingTimeInterval(900))
        #expect(
            MutationFailurePolicy.classify(
                error(.resourceExhausted, ["retryAfterSeconds": 600.0, "retryAt": reset]), now: now)
                == .retry(now.addingTimeInterval(900)))
        for failure in [
            error(.unavailable), error(.deadlineExceeded), error(.unauthenticated),
            URLError(.networkConnectionLost) as NSError,
        ] {
            #expect(MutationFailurePolicy.classify(failure) == .retry(nil))
        }
    }
    @Test func rateLimitResetIsDurableAndDoesNotResubmitBeforeItsDeadline() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: folder, uid: "rate-test")
        try await store.seedPremium()
        try await store.commit(kind: .profile, value: .string("Waiting change"))
        let reset = Date().addingTimeInterval(600)
        let cloud = RateLimitedCloud(reset: reset)
        let engine = SyncEngine(store: store, cloud: cloud, uid: "rate-test")
        #expect(await engine.flush() == false)
        #expect(await engine.flush())
        let pending = try #require(try await store.readSnapshot().pending.first)
        #expect(pending.retryAt == reset && pending.receipt == nil && pending.attempts == 1)
        #expect(await cloud.submissions == 1)
        await engine.stop()
        await store.close()
        let reopened = try await LocalStore.open(directory: folder, uid: "rate-test")
        #expect(try await reopened.readSnapshot().pending.first?.retryAt == reset)
        await reopened.close()
        try FileManager.default.removeItem(at: folder)
    }
}

private actor RateLimitedCloud: CloudUserTransport {
    let reset: Date
    private(set) var submissions = 0
    init(reset: Date) { self.reset = reset }
    func changes(uid: String, previous: PersonalSnapshot) async throws -> AsyncThrowingStream<
        CloudUserEvent, Error
    > {
        AsyncThrowingStream { $0.yield(CloudUserEvent(change: .initial(previous), revision: 1)) }
    }
    func reconcile(uid: String, operations: [UserMutation]) async throws -> [CloudUserEvent] { [] }
    func submit(_ operation: UserMutation) async throws -> MutationReceipt {
        submissions += 1
        throw MutationRetryFailure(retryAt: reset)
    }
    func accountAction(_ action: ExistingAccountAction, uid: String) async throws -> URL? { nil }
}
