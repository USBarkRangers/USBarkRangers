import BarkDomain
import FirebaseAuth
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

struct NativeProfileEdgeTests {
    @Test func repeatedSaveDoesNotGrowQueueAndClosedScopeRejectsLateEdits() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await NativeStore.open(directory: folder, project: "demo-bark-native", uid: "no-op")
        let now = Date()
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: try NativeClientTime.milliseconds(now.addingTimeInterval(60))))
        try await store.saveProfileEdit(.displayName("Ranger"), now: now)
        try await store.saveProfileEdit(.mapStyle(.default), now: now)
        #expect(try await store.profileView().pendingCount == 0)
        try await store.saveProfileEdit(.displayName("New name"), now: now)
        let first = try await store.profileView()
        for _ in 0..<150 { try await store.saveProfileEdit(.displayName("New name"), now: now) }
        #expect(try await store.profileView() == first)
        for invalid in ["x", "<Name>", "Bad\nName", String(repeating: "a", count: 31)] {
            await #expect(throws: NativeProfileEdit.Failure.invalid) {
                try await store.saveProfileEdit(.displayName(invalid), now: now)
            }
        }
        #expect(try await store.profileView() == first)
        for number in 1..<NativeSyncPolicy.queueLimit {
            try await store.saveProfileEdit(.displayName("Name \(number)"), now: now)
        }
        let full = try await store.profileView()
        #expect(full.pendingCount == NativeSyncPolicy.queueLimit)
        await #expect(throws: NativeStore.Failure.queueFull) {
            try await store.saveProfileEdit(.displayName("Beyond limit"), now: now)
        }
        #expect(try await store.profileView() == full)
        await store.close()
        await #expect(throws: NativeStore.Failure.closed) {
            try await store.saveProfileEdit(.mapStyle(.satellite))
        }
    }

    @MainActor @Test func nativeAccessExpiresAndCannotLeakAcrossAccountUpdates() async throws {
        let repository = EntitlementRepository()
        let until = Date().addingTimeInterval(0.15 - NativeSyncPolicy.offlineGrace)
        repository.update(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: try NativeClientTime.milliseconds(until)), uid: "a")
        #expect(repository.access?.premium == true)
        try await eventually { repository.access?.premium == false }
        repository.update(
            .init(
                revision: 2, premium: true, source: .sandbox,
                validUntilMs: try NativeClientTime.milliseconds(Date().addingTimeInterval(60))), uid: "b")
        #expect(repository.access?.uid == "b" && repository.access?.premium == false)
        repository.clear()
        #expect(repository.access == nil)
    }

    @Test func permanentFailuresDoNotTurnIntoAutomaticNetworkRetries() {
        for code in [FirestoreErrorCode.permissionDenied, .invalidArgument, .failedPrecondition, .dataLoss] {
            #expect(
                !NativeProfileCloud.isTransient(NSError(domain: FirestoreErrorDomain, code: code.rawValue)))
        }
        for code in [FirestoreErrorCode.unavailable, .deadlineExceeded, .resourceExhausted] {
            #expect(
                NativeProfileCloud.isTransient(NSError(domain: FirestoreErrorDomain, code: code.rawValue)))
        }
        #expect(NativeProfileCloud.isTransient(URLError(.notConnectedToInternet)))
        #expect(!NativeProfileCloud.isTransient(URLError(.badURL)))
        #expect(!NativeProfileCloud.isTransient(NativeProfileCloud.Failure.invalidReply))
        #expect(!NativeProfileCloud.isTransient(NativeStore.Failure.corrupt))
        #expect(
            !NativeProfileCloud.isTransient(
                NativeCallableTransport.ServerFailure(reason: "unsupported-contract", retryAfterMs: nil)))
    }
}
