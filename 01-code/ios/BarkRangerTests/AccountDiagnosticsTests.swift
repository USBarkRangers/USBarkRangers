import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor struct AccountDiagnosticsTests {
    @Test(arguments: [7, 14])
    func failedCloudReadHasABoundedReasonAndPreservesSavedData(_ code: Int) async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let events = Mutex<[(Diagnostics.AccountStage, Diagnostics.AccountFailure)]>([])
        let diagnostics = Diagnostics(
            enabled: false,
            accountSink: { stage, reason in
                events.withLock { $0.append((stage, reason)) }
            })
        let store = try await LocalStore.open(directory: folder, uid: "a")
        let before = try await store.readSnapshot().baseline
        let cloud = ControlledUserCloud()
        await cloud.failReads(
            with: NSError(
                domain: "FIRFirestoreErrorDomain", code: code,
                userInfo: [NSLocalizedDescriptionKey: "PRIVATE CUSTOMER DATA MUST NOT BE LOGGED"]))
        let engine = SyncEngine(store: store, cloud: cloud, uid: "a", diagnostics: diagnostics)
        #expect(await engine.flush() == false)
        #expect(
            events.withLock {
                $0.count == 1 && $0[0].0 == .readCloud && $0[0].1 == (code == 7 ? .denied : .network)
            })
        #expect(try await store.readSnapshot().baseline == before)
        await engine.stop()
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }
    @Test func localSaveFailureIsNotReportedAsACloudFailure() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fail = Mutex(false)
        let stages = Mutex<[Diagnostics.AccountStage]>([])
        let store = try await LocalStore.open(
            directory: folder, uid: "a",
            beforeSave: {
                if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) }
            })
        let diagnostics = Diagnostics(
            enabled: false, accountSink: { stage, _ in stages.withLock { $0.append(stage) } })
        let cloud = ControlledUserCloud()
        let engine = SyncEngine(store: store, cloud: cloud, uid: "a", diagnostics: diagnostics)
        fail.withLock { $0 = true }
        #expect(await engine.flush() == false)
        #expect(stages.withLock { $0 == [.readStore] })
        #expect(await cloud.reads == 0)
        await engine.stop()
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }
    @Test func categoriesNeverUseErrorDescriptions() {
        #expect(Diagnostics.accountReason(NSError(domain: "sensitive-email", code: 123)) == .unknown)
        #expect(Diagnostics.accountReason(PersonalPayload.Failure.unreadable) == .decoding)
        #expect(Diagnostics.accountReason(CancellationError()) == .cancelled)
        #expect(Diagnostics.accountReason(MutationSubmissionFailure(reason: "private-text")) == .rejected)
    }
}
