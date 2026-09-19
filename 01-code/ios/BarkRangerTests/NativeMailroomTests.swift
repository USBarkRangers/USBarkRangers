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
