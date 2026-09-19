import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeSyncFaultIsolationTests {
    private struct Unknown: Error {}
    private let isolatable: [any Error] = [
        NativeCallableTransport.Failure.invalidReply, NativeProfileCloud.Failure.invalidReply,
        NativeStore.Failure.invalidAcknowledgment, NativeStore.Failure.staleRead,
        NativeCallableTransport.ServerFailure(reason: "invalid", retryAfterMs: nil),
        NativeCallableTransport.ServerFailure(reason: "premium-required", retryAfterMs: nil),
        NativeCallableTransport.ServerFailure(reason: "account-unavailable", retryAfterMs: nil),
        NativeCallableTransport.ServerFailure(reason: "a-future-reason", retryAfterMs: nil),
    ]
    private let ending: [any Error] = [
        CancellationError(), URLError(.notConnectedToInternet), URLError(.timedOut),
        NativeCallableTransport.ServerFailure(reason: "unavailable", retryAfterMs: nil),
        NativeCallableTransport.ServerFailure(reason: "rate-limited", retryAfterMs: 60_000),
        NativeCallableTransport.Failure.accountChanged, NativeCallableTransport.Failure.wrongScope,
        NativeProfileCloud.Failure.accountChanged, NativeProfileCloud.Failure.incomplete,
        AccountFailure.accountChanged, NativeSyncAdmission.closed,
        NativeStore.Failure.corrupt, NativeStore.Failure.closed, NativeStore.Failure.wrongScope,
        NativeStore.Failure.unavailable, NativeStore.Failure.queueFull,
        CocoaError(.fileWriteOutOfSpace),
        DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "local row")), Unknown(),
    ]
    private func tripItem() throws -> NativeTripMetadata {
        let time = try NativeServerTime(seconds: 1_800_000_000, nanoseconds: 1)
        return NativeTripMetadata(
            id: "trip-1", revision: 1, contentRevision: 1, title: "Trip", dayCount: 1, stopCount: 0,
            contentBytes: 100, createdAt: time, updatedAt: time)
    }

    @Test func onlyDefinitiveRemoteResponsesAreIsolatableAndNoneOfThemArmsARetry() {
        for error in isolatable {
            #expect(NativeMailroom.isIsolatableRemoteResponseFailure(error), "\(error)")
            // NativeFeatureSync schedules its 30 second retry only for transient errors, so a
            // surfaced isolatable failure can never become a timer-driven loop.
            #expect(!NativeProfileCloud.isTransient(error), "\(error)")
        }
        for error in ending {
            #expect(!NativeMailroom.isIsolatableRemoteResponseFailure(error), "\(error)")
        }
    }

    @Test func aValidationFailureIsNotIsolatableBecauseLocalRowsRaiseTheSameError() throws {
        // BarkDomain keeps this error type internal, so the app cannot tell a reply that broke
        // its contract from a damaged local row. Until the remote boundary reports it as an
        // invalid reply, it ends the pass as it always has.
        let item = try tripItem()
        let upper = try NativeServerTime(seconds: 1_800_000_001, nanoseconds: 0)
        do {
            try NativeTripPage(items: [item, item], readTime: upper).validate()
            Issue.record("A page listing the same trip twice must not validate.")
        } catch {
            #expect(!NativeMailroom.isIsolatableRemoteResponseFailure(error))
        }
    }

    @Test func aBadReplySkipsOnlyItsStepAndTheFirstOneIsStillThrownAtTheEnd() async throws {
        var steps = NativeIndependentSteps()
        var ran: [String] = []
        let first = try await steps.run {
            ran.append("library")
            throw NativeCallableTransport.Failure.invalidReply
        }
        let second = try await steps.run { ran.append("trip B") }
        let third = try await steps.run {
            ran.append("scan")
            throw NativeCallableTransport.ServerFailure(reason: "invalid", retryAfterMs: nil)
        }
        #expect(ran == ["library", "trip B", "scan"])
        #expect(!first && second && !third)
        #expect(throws: NativeCallableTransport.Failure.invalidReply) { try steps.finish() }
        var clean = NativeIndependentSteps()
        try await clean.run {}
        try clean.finish()
    }

    @Test func everyOtherErrorEndsThePassAtOnce() async throws {
        for error in ending where !(error is CancellationError) {
            var steps = NativeIndependentSteps()
            var later = false
            await #expect(throws: (any Error).self) {
                try await steps.run { throw error }
                try await steps.run { later = true }
            }
            #expect(!later && steps.firstFailure == nil, "\(error)")
        }
    }

    @Test func cancellationEndsThePassEvenWhenTheCancelledCallLooksLikeABadReply() async {
        let task = Task { @MainActor in
            var steps = NativeIndependentSteps()
            try await steps.run {
                withUnsafeCurrentTask { $0?.cancel() }
                throw NativeCallableTransport.Failure.invalidReply
            }
            return steps.firstFailure == nil
        }
        let result = await task.result
        #expect(throws: CancellationError.self) { try result.get() }
    }

    @Test func theSchedulerStillReportsTheFaultOnceAndDoesNotRunThePassAgain() async throws {
        var passes = 0
        var independentWork = 0
        let sync = NativeFeatureSync(
            label: "Example",
            work: { _ in
                passes += 1
                var steps = NativeIndependentSteps()
                try await steps.run { throw NativeCallableTransport.Failure.invalidReply }
                try await steps.run { independentWork += 1 }
                try steps.finish()
                return Date()  // Would ask for an immediate retry if the fault were swallowed.
            }, pause: {})
        sync.setAllowed(true)
        await sync.wait()
        #expect(sync.message == "Example could not finish syncing. Your saved changes are retained.")
        try await Task.sleep(for: .milliseconds(1_300))
        await sync.wait()
        #expect(passes == 1 && independentWork == 1)
        await sync.close()
    }

    @Test func aReplyOfTheWrongShapeIsAnInvalidReplyNeverADecodingError() {
        struct Reply: Decodable { let version: Int }
        #expect(throws: NativeCallableTransport.Failure.invalidReply) {
            try NativeCallableTransport.decodeReply(Reply.self, from: ["version": "one"])
        }
        #expect(throws: NativeCallableTransport.Failure.invalidReply) {
            try NativeCallableTransport.decodeReply(Reply.self, from: "not an object")
        }
        #expect(throws: NativeCallableTransport.Failure.invalidReply) {
            try NativeCallableTransport.decodeReply(Reply.self, from: NSNull())
        }
        #expect((try? NativeCallableTransport.decodeReply(Reply.self, from: ["version": 1]))?.version == 1)
    }

    @Test func aMalformedChangePageLeavesTheTripCursorAndLibraryUntouched() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "scan", guest: true)
        let upper = try NativeServerTime(seconds: 1_800_000_001, nanoseconds: 0)
        let item = try tripItem()
        let query = try await store.tripChangesQuery()
        // The same trip twice is a reply the phone must refuse whole.
        let malformed = NativeTripChanges(items: [item, item], upper: upper, next: nil)
        await #expect(throws: (any Error).self) {
            try await store.acceptTripChanges(malformed, requested: query)
        }
        #expect(try await store.tripChangesQuery() == query)
        #expect(try await store.tripMetadataPage().isEmpty)
        // A later well-formed page is accepted from the same cursor.
        let page = NativeTripChanges(items: [item], upper: upper, next: nil)
        #expect(try await store.acceptTripChanges(page, requested: query))
        #expect(try await store.tripChangesQuery() != query)
        await store.close()
    }
}
