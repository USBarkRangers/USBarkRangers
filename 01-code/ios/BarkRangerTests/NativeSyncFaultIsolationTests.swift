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
        NativeCallableTransport.Failure.invalidRequest,
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

    @Test func aRequestThePhoneGotWrongIsLocalAndNeverIsolatable() throws {
        // Nothing reached the server, so none of these may be read as the server's bad reply:
        // an endpoint this client does not call, an oversized body, a visit selection outside
        // 1...500, a leaderboard standing asked for another account or before the top five.
        #expect(throws: NativeCallableTransport.Failure.invalidRequest) {
            try NativeCallableTransport.checkRequest(endpoint: "someoneElsesFunction", bytes: Data())
        }
        #expect(throws: NativeCallableTransport.Failure.invalidRequest) {
            try NativeCallableTransport.checkRequest(
                endpoint: "nativeCommand", bytes: Data(count: 400_001))
        }
        try NativeCallableTransport.checkRequest(endpoint: "nativeCommand", bytes: Data(count: 400_000))
        let local: [NativeCallableTransport.Failure] = [.invalidRequest, .accountChanged, .wrongScope]
        for error in local {
            #expect(!NativeMailroom.isIsolatableRemoteResponseFailure(error), "\(error)")
            #expect(!NativeProfileCloud.isTransient(error), "\(error)")
        }
        let reply = NativeCallableTransport.Failure.invalidReply
        #expect(NativeMailroom.isIsolatableRemoteResponseFailure(reply))
    }

    @Test func aBareValidationFailureIsNotIsolatableBecauseOnlyLocalDataCanStillRaiseIt() throws {
        // BarkDomain keeps this error type internal, so the app cannot name it. Every cloud
        // boundary turns it into invalidReply, which leaves local rows as its only source.
        let item = try tripItem()
        let upper = try NativeServerTime(seconds: 1_800_000_001, nanoseconds: 0)
        do {
            try NativeTripPage(items: [item, item], readTime: upper).validate()
            Issue.record("A page listing the same trip twice must not validate.")
        } catch {
            #expect(!NativeMailroom.isIsolatableRemoteResponseFailure(error))
        }
    }

    @Test func aWellFormedReplyThatBreaksItsContractIsAnInvalidReply() throws {
        // Syntactically valid: it decodes. Domain-invalid: the same trip is listed twice.
        let item = try tripItem()
        let upper = try NativeServerTime(seconds: 1_800_000_001, nanoseconds: 0)
        let wire = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(NativeTripPage(items: [item, item], readTime: upper)))
        let reply = try NativeCallableTransport.decodeReply(NativeTripPage.self, from: wire)
        #expect(reply.items.count == 2)
        do {
            try NativeCallableTransport.validateReply { try reply.validate() }
            Issue.record("A page listing the same trip twice must not validate.")
        } catch {
            #expect(error as? NativeCallableTransport.Failure == .invalidReply)
            #expect(NativeMailroom.isIsolatableRemoteResponseFailure(error))
            #expect(!NativeProfileCloud.isTransient(error))
        }
        // A reply that honours its contract passes through unchanged.
        let good = NativeTripPage(items: [item], readTime: upper)
        try NativeCallableTransport.validateReply { try good.validate() }
    }

    @Test func aDamagedLocalRecordNeverBecomesAnInvalidReply() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        let coordinate = try #require(Coordinate(latitude: 41, longitude: -81))
        let place = NativeSavedPin.Place(
            identity: .custom("a"), name: "Place", coordinate: coordinate,
            state: "", subtitle: "", stopID: "stop-a", savedAtMs: 1_800_000_000_000)
        let pin = NativeSavedPin(id: place.identity.storageID, revision: 1, saved: true, place: place)
        try await store.seedSavedPinsForTest([pin])
        // Wrong shape on disk: the local read reports damaged storage, as the app expects.
        try await store.overwriteConfirmedPinForTest(pin.id, with: Data("not json".utf8))
        do {
            _ = try await store.savedPinValue(pin.id)
            Issue.record("A damaged local row must not read.")
        } catch {
            #expect(error is DecodingError)
            #expect(!NativeMailroom.isIsolatableRemoteResponseFailure(error))
        }
        // Right shape but contract broken on disk: still a local failure, never invalidReply.
        let unnamed = NativeSavedPin.Place(
            identity: place.identity, name: "", coordinate: place.coordinate, state: "", subtitle: "",
            stopID: "stop-a", savedAtMs: place.savedAtMs)
        try await store.overwriteConfirmedPinForTest(
            pin.id,
            with: JSONEncoder().encode(NativeSavedPin(id: pin.id, revision: 1, saved: true, place: unnamed)))
        do {
            _ = try await store.savedPinValue(pin.id)
            Issue.record("A local row that breaks its contract must not read.")
        } catch {
            #expect(error as? NativeCallableTransport.Failure == nil)
            #expect(error as? NativeProfileCloud.Failure == nil)
            #expect(!NativeMailroom.isIsolatableRemoteResponseFailure(error))
        }
        await store.close()
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

extension NativeStore {
    /// Test-only damage to one local row; production code never writes unvalidated bytes here.
    func overwriteConfirmedPinForTest(_ id: String, with bytes: Data) throws {
        guard let row = try savedPinRow(id) else { throw Failure.corrupt }
        row.confirmed = bytes
        try commit()
    }
}
