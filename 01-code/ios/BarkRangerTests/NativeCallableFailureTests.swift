import FirebaseFunctions
import Foundation
import Testing

@testable import BarkRanger

struct NativeCallableFailureTests {
    @Test func sdkTimeoutAndUnavailableRetainUnknownOutcomeWhileAuthAndBadDataNeedAttention() {
        for code in [FunctionsErrorCode.deadlineExceeded, .unavailable, .cancelled] {
            let failure = NativeCallableTransport.serverFailure(
                NSError(domain: FunctionsErrorDomain, code: code.rawValue))
            #expect(failure?.reason == "unavailable")
        }
        let quota = NativeCallableTransport.serverFailure(
            NSError(domain: FunctionsErrorDomain, code: FunctionsErrorCode.resourceExhausted.rawValue))
        #expect(quota?.reason == "rate-limited" && quota?.retryAfterMs == 60_000)
        for code in [FunctionsErrorCode.unauthenticated, .permissionDenied, .invalidArgument, .internal] {
            #expect(
                NativeCallableTransport.serverFailure(
                    NSError(domain: FunctionsErrorDomain, code: code.rawValue)) == nil)
        }
        let known = NSError(
            domain: FunctionsErrorDomain, code: FunctionsErrorCode.failedPrecondition.rawValue,
            userInfo: [FunctionsErrorDetailsKey: ["contractVersion": 1, "reason": "premium-required"]])
        #expect(NativeCallableTransport.serverFailure(known)?.reason == "premium-required")
    }
}
