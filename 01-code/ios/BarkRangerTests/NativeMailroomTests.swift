import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct NativeMailroomTests {
    @Test func lostReplyDefersTheSameSealedBytesAndSurvivesRelaunch() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "delivery")
        let id = try await store.stageProfileEdit(.bootstrap)
        let sealed = try #require(try await store.nextProfileSubmission())
        let stop = try await NativeMailroom.drain(store: store, next: {
            guard let command = try await store.nextProfileSubmission() else { return nil }
            return .init(command: command) { throw URLError(.networkConnectionLost) }
        }, reject: { try await store.rejectProfileOperation($0, code: $1) })
        guard case .retry(let date) = stop else { Issue.record("Lost reply must retry"); return }
        #expect(date > Date())
        #expect(try await store.nextProfileSubmission() == nil)
        await store.close()
        let reopened = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "delivery")
        let retry = try #require(try await reopened.nextProfileSubmission(now: date.addingTimeInterval(1)))
        #expect(retry.id == id && retry.bytes == sealed.bytes && retry.attempts == 1)
        await reopened.close()
    }

    /// The server refuses a first command from a phone whose clock runs ahead. That used to
    /// leave a new account with no profile and no way to get one.
    @Test func refusedBootstrapIsReplacedOnAForcedRefreshAndNeverAsksForAReview() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "new-user")
        try await store.stageBootstrap(replacingRefused: false)
        let refused = try #require(try await store.nextProfileSubmission())
        let stop = try await NativeMailroom.drain(store: store, next: {
            guard let command = try await store.nextProfileSubmission() else { return nil }
            return .init(command: command) {
                throw NativeCallableTransport.ServerFailure(reason: "invalid", retryAfterMs: nil)
            }
        }, reject: { try await store.rejectProfileOperation($0, code: $1) })
        guard case .blocked = stop else { Issue.record("A refusal must stop this pass"); return }
        var view = try await store.profileView()
        #expect(view.failureCode == "invalid" && !view.conflict && view.pendingCount == 1)

        // Ordinary passes leave it alone, so a persistent refusal cannot become a send loop.
        try await store.stageBootstrap(replacingRefused: false)
        #expect(try await store.nextProfileSubmission() == nil)

        try await store.stageBootstrap(replacingRefused: true)
        let fresh = try #require(try await store.nextProfileSubmission())
        view = try await store.profileView()
        #expect(fresh.id != refused.id && fresh.attempts == 0)
        #expect(view.pendingCount == 1 && view.failureCode == nil)

        // An account that already has its profile is never bootstrapped again.
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.stageBootstrap(replacingRefused: true)
        #expect(try await store.profileView().pendingIDs == [fresh.id])
        await store.close()
    }

    @Test func featureStoresShareTheMailroomRefusalsAndWalksOnlyAddTheirOwn() async throws {
        #expect(
            NativeStore.expeditionRejectionCodes.subtracting(NativeMailroom.rejectionCodes)
                == ["activity-reused", "overlapping-activity", "incomplete-expedition"])
        #expect(NativeStore.expeditionRejectionCodes.isSuperset(of: NativeMailroom.rejectionCodes))
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        // Every shared refusal is persisted by a feature store; each needs its own sealed head.
        for code in NativeMailroom.rejectionCodes.sorted() {
            let store = try await NativeStore.open(
                directory: directory, project: "demo-bark-native", uid: code)
            try await store.seedPremium()
            _ = try await store.stageProfileEdit(.displayName("Refused"))
            let profile = try #require(try await store.nextProfileSubmission())
            try await store.rejectProfileOperation(profile.id, code: code)
            #expect(try await store.profileView().failureCode == code)
            await store.close()
        }
        // A reason the mailroom does not list is never written as a refusal: the row stays sealed.
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "trip")
        try await store.seedPremium()
        let trip = Trip(id: "refused-trip", name: "Refused", days: [.init(id: "day", stops: [])])
        try await store.acceptTripSnapshot(nativeTripSnapshot(trip, revision: 1))
        var edit = try #require(try await store.cachedTrip(id: trip.id))
        edit.trip.name = "Renamed"
        _ = try await store.checkpointNativeDraft(edit, replacing: nil)
        _ = try await store.stageTripSave(edit)
        let command = try #require(try await store.nextTripSubmission(id: trip.id))
        await #expect(throws: NativeStore.Failure.corrupt) {
            try await store.rejectTripOperation(command.id, code: "activity-reused")
        }
        #expect(try await store.nextTripSubmission(id: trip.id) == command)
        try await store.rejectTripOperation(command.id, code: "intent-expired")
        #expect(try await store.tripQueueState(trip.id).needsDecision)
        await store.close()
    }

    private func pin(_ id: String) throws -> SavedPlace {
        try #require(
            SavedPlace(
                stop: .init(
                    id: "stop-" + id, placeIdentity: .custom(id), name: "Place " + id,
                    coordinate: Coordinate(latitude: 41, longitude: -81)), subtitle: "Ohio",
                savedAt: Date(timeIntervalSince1970: 1_800_000_000)))
    }
    /// What the drain tried to send, in order. A class because the drain's closures escape.
    private final class Attempts: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [NativeStore.Submission] = []
        func add(_ value: NativeStore.Submission) -> Int {
            lock.withLock {
                values.append(value)
                return values.count
            }
        }
        var all: [NativeStore.Submission] { lock.withLock { values } }
    }
    /// Two unrelated saved pins, a then b, and a drain whose replies the test scripts by order.
    private func drainPins(
        _ store: NativeStore, isolating: Bool, attempts: Attempts,
        reply: @escaping @Sendable (Int, NativeStore.Submission) async throws -> Void
    ) async throws -> NativeMailroom.Stop {
        try await NativeMailroom.drain(
            store: store,
            next: {
                guard let command = try await store.nextSavedPinSubmission() else { return nil }
                return .init(command: command) {
                    try await reply(attempts.add(command), command)
                }
            }, reject: { try await store.rejectSavedPin($0, code: $1) }, continueAfterRejection: true,
            isolatingRemoteResponseFailures: isolating)
    }

    @Test func aBadReplyDefersOnlyItsOperationWhileAnUnrelatedPinStillDelivers() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        try await store.seedPremium()
        let a = try pin("a")
        let b = try pin("b")
        let confirmedB = NativeSavedPin(id: b.id, revision: 1, saved: true, place: try b.nativeValue)
        try await store.saveSavedPin(a)
        try await store.saveSavedPin(b)
        let attempts = Attempts()
        // The first fault is still thrown, but only after the lane had nothing more to send.
        await #expect(throws: NativeCallableTransport.Failure.invalidReply) {
            try await drainPins(store, isolating: true, attempts: attempts) { order, command in
                if order == 1 { throw NativeCallableTransport.Failure.invalidReply }
                try await store.acceptSavedPinOutcome(
                    .init(
                        version: 1, operationID: command.id, status: "accepted",
                        confirmation: confirmedB, revisions: .init(savedPin: 1)))
            }
        }
        let sent = attempts.all
        #expect(sent.count == 2)
        #expect(try await store.savedPinValue(b.id).pending == false)
        // Outcome unknown: sealed and durable with the same bytes, never rejected, backed off.
        let waiting = try await store.pendingChanges()
        #expect(waiting.map(\.state) == ["sealed"] && waiting.first?.id == sent.first?.id)
        #expect(try await store.nextSavedPinSubmission() == nil)
        #expect(try #require(try await store.savedPinRetryAt()) > Date())
        let later = try #require(try await store.nextSavedPinSubmission(now: .distantFuture))
        #expect(later.id == sent[0].id && later.bytes == sent[0].bytes && later.attempts == 1)
        await store.close()
    }

    @Test func aLaneWideStopIsStillReportedAndLocalFaultsStillEndTheLaneAtOnce() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        func lane(_ uid: String) async throws -> NativeStore {
            let store = try await NativeStore.open(
                directory: directory, project: "demo-bark-native", uid: uid)
            try await store.seedPremium()
            try await store.saveSavedPin(pin("a"))
            try await store.saveSavedPin(pin("b"))
            return store
        }
        // Service unreachable after an isolated bad reply: reported as a retry, as before.
        var store = try await lane("retry")
        var attempts = Attempts()
        var stop = try await drainPins(store, isolating: true, attempts: attempts) { order, _ in
            if order == 1 { throw NativeCallableTransport.Failure.invalidReply }
            throw URLError(.notConnectedToInternet)
        }
        if case .retry = stop {} else { Issue.record("Expected a retry stop, got \(stop)") }
        #expect(attempts.all.count == 2)
        await store.close()
        // Access refused after an isolated bad reply: the access stop wins so it is refreshed.
        store = try await lane("access")
        attempts = Attempts()
        stop = try await drainPins(store, isolating: true, attempts: attempts) { order, _ in
            if order == 1 { throw NativeCallableTransport.Failure.invalidReply }
            throw NativeCallableTransport.ServerFailure(reason: "premium-required", retryAfterMs: nil)
        }
        if case .blocked(let access) = stop { #expect(access) } else { Issue.record("Expected blocked") }
        await store.close()
        // A local fault is never isolated: thrown at once, not deferred, nothing else is sent.
        let localFaults: [any Error] = [
            NativeStore.Failure.corrupt, NativeCallableTransport.Failure.invalidRequest,
        ]
        for fault in localFaults {
            store = try await lane("local-\(fault)")
            attempts = Attempts()
            await #expect(throws: (any Error).self) {
                try await drainPins(store, isolating: true, attempts: attempts) { _, _ in throw fault }
            }
            let sent = attempts.all
            #expect(sent.count == 1)
            #expect(try await store.nextSavedPinSubmission() == sent.first)
            await store.close()
        }
        // A lane that does not opt in is unchanged: the bad reply ends it, still due, no backoff.
        store = try await lane("chain")
        attempts = Attempts()
        await #expect(throws: NativeCallableTransport.Failure.invalidReply) {
            try await drainPins(store, isolating: false, attempts: attempts) { _, _ in
                throw NativeCallableTransport.Failure.invalidReply
            }
        }
        let sent = attempts.all
        #expect(sent.count == 1)
        #expect(try await store.nextSavedPinSubmission() == sent.first)
        await store.close()
    }

    @Test func malformedAcknowledgmentIsRetainedWithoutAnAutomaticRetryLoop() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "invalid-reply")
        try await store.stageProfileEdit(.bootstrap)
        let sealed = try #require(try await store.nextProfileSubmission())
        await #expect(throws: NativeProfileCloud.Failure.invalidReply) {
            try await NativeMailroom.drain(store: store, next: {
                .init(command: sealed) { throw NativeProfileCloud.Failure.invalidReply }
            }, reject: { try await store.rejectProfileOperation($0, code: $1) })
        }
        #expect(try await store.nextProfileSubmission() == sealed)
        await store.close()
    }
}
