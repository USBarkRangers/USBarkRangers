import Foundation
import Synchronization
import Testing

@testable import BarkRanger

struct AccountDiagnosticsTests {
    @Test(arguments: [7, 14])
    func cloudReasonsAreBoundedAndNeverIncludePrivateErrorDescriptions(_ code: Int) {
        let events = Mutex<[(Diagnostics.AccountStage, Diagnostics.AccountFailure)]>([])
        let diagnostics = Diagnostics(
            enabled: false,
            accountSink: { stage, reason in
                events.withLock { $0.append((stage, reason)) }
            })
        diagnostics.accountFailure(
            NSError(
                domain: "FIRFirestoreErrorDomain", code: code,
                userInfo: [NSLocalizedDescriptionKey: "PRIVATE DATA MUST NOT BE LOGGED"]), at: .readCloud)
        #expect(
            events.withLock {
                $0.count == 1 && $0[0].0 == .readCloud && $0[0].1 == (code == 7 ? .denied : .network)
            })
    }

    @Test func nativeFailureCategoriesNeverUseErrorDescriptions() {
        #expect(Diagnostics.accountReason(NSError(domain: "sensitive-email", code: 123)) == .unknown)
        #expect(Diagnostics.accountReason(NativeStore.Failure.corrupt) == .decoding)
        #expect(Diagnostics.accountReason(CancellationError()) == .cancelled)
        #expect(Diagnostics.accountReason(NativeStore.Failure.wrongScope) == .accountChanged)
        #expect(Diagnostics.accountReason(CocoaError(.fileWriteOutOfSpace)) == .storage)
        #expect(Diagnostics.accountReason(NativeStore.Failure.unavailable) == .denied)
    }
}
