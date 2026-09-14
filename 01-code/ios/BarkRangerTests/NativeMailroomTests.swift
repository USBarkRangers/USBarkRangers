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
