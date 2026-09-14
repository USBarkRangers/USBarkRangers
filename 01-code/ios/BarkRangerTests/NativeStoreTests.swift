import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

struct NativeStoreTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func seed(_ store: NativeStore) async throws {
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(now.addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
    }

    @Test func failedWriteCannotPublishAnEditWithoutItsDurableIntent() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fail = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "writer",
            beforeSave: { if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        try await seed(store)
        let original = try await store.profileView()
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.stageProfileEdit(.displayName("Changed"), now: now)
        }
        #expect(try await store.profileView() == original)
        #expect(try await store.nextProfileSubmission(now: now) == nil)
        fail.withLock { $0 = false }
        try await store.stageProfileEdit(.displayName("Changed"), now: now)
        #expect(try await store.profileView().visible?.displayName == "Changed")
        #expect(try await store.profileView().confirmed?.displayName == "Ranger")
        #expect(try await store.profileView().pendingCount == 1)
        await store.close()
    }

    @Test func offlineDependencySealsAgainstAcceptedRevisionAndSurvivesRelaunch() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "chain")
        try await seed(store)
        let a = try await store.stageProfileEdit(.displayName("Name A"), now: now)
        let b = try await store.stageProfileEdit(.mapStyle(.satellite), now: now)
        let first = try #require(try await store.nextProfileSubmission(now: now))
        #expect(first.id == a)
        #expect(try await store.nextProfileSubmission(now: now) == first)
        try await store.acceptProfileOutcome(
            .init(operationID: a, status: .accepted, revisions: .init(profile: 2)),
            canonical: .init(revision: 2, displayName: "Name A"))
        let second = try #require(try await store.nextProfileSubmission(now: now))
        let payload = try #require(JSONSerialization.jsonObject(with: second.bytes) as? [String: Any])
        #expect(second.id == b && (payload["expectedRevision"] as? Int) == 2)
        #expect((payload["kind"] as? String) == "updateMapStyle")
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "chain")
        #expect(try await reopened.nextProfileSubmission(now: now) == second)
        #expect(try await reopened.profileView().visible?.mapStyle == .satellite)
        try await reopened.acceptProfileOutcome(
            .init(operationID: b, status: .accepted, revisions: .init(profile: 3)),
            canonical: .init(revision: 3, displayName: "Name A", mapStyle: .satellite))
        #expect(try await reopened.profileView().pendingCount == 0)
        #expect(try await reopened.profileView().confirmed?.mapStyle == .satellite)
        await reopened.close()
    }

    @Test func newerRemoteEditCannotSilentlyRebaseTheOfflineSuccessor() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "conflict")
        try await seed(store)
        let a = try await store.stageProfileEdit(.displayName("Name A"), now: now)
        let b = try await store.stageProfileEdit(.mapStyle(.satellite), now: now)
        _ = try await store.nextProfileSubmission(now: now)
        try await store.acceptProfileOutcome(
            .init(operationID: a, status: .accepted, revisions: .init(profile: 2)),
            canonical: .init(revision: 7, displayName: "Another device"))
        let next = try #require(try await store.nextProfileSubmission(now: now))
        let payload = try #require(JSONSerialization.jsonObject(with: next.bytes) as? [String: Any])
        #expect((payload["expectedRevision"] as? Int) == 2)
        try await store.acceptProfileOutcome(
            .init(operationID: b, status: .conflict, revisions: .init(profile: 7)),
            canonical: .init(revision: 7, displayName: "Another device"))
        #expect(try await store.profileView().conflict)
        #expect(try await store.profileView().pendingCount == 1)
        #expect(try await store.profileView().visible?.mapStyle == .satellite)
        #expect(try await store.nextProfileSubmission(now: now) == nil)
        await store.close()
    }

    @Test func scopeAndServerAccessCannotBeBorrowedFromAnotherProjectOrAccount() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        try await seed(store)
        let other = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "b")
        #expect(try await other.profileView().confirmed == nil)
        await #expect(throws: (any Error).self) {
            try await other.stageProfileEdit(.displayName("No access"), now: now)
        }
        await #expect(throws: (any Error).self) {
            try await store.stageProfileEdit(.displayName("Expired"), now: now.addingTimeInterval(7200))
        }
        await #expect(throws: (any Error).self) {
            try await NativeStore.open(directory: directory, project: "barkrangermap-auth", uid: "a")
        }
        await store.close()
        await other.close()
    }

    @Test func explicitConflictChoiceIsAtomicAndCreatesNewOperationIdentity() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fail = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "resolve",
            beforeSave: { if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        try await seed(store)
        let original = try await store.stageProfileEdit(.displayName("My name"), now: now)
        try await store.stageProfileEdit(.mapStyle(.satellite), now: now)
        _ = try await store.nextProfileSubmission(now: now)
        try await store.acceptProfileOutcome(
            .init(operationID: original, status: .conflict, revisions: .init(profile: 5)),
            canonical: .init(revision: 5, displayName: "Remote name"))
        let before = try await store.profileView()
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.resolveProfileConflict(
                keepingLocalEdits: true, confirmedRevision: 5, now: now, expectedPendingIDs: before.pendingIDs
            )
        }
        #expect(try await store.profileView() == before)
        fail.withLock { $0 = false }
        await #expect(throws: (any Error).self) {
            try await store.resolveProfileConflict(
                keepingLocalEdits: true, confirmedRevision: 4, now: now, expectedPendingIDs: before.pendingIDs
            )
        }
        try await store.resolveProfileConflict(
            keepingLocalEdits: true, confirmedRevision: 5, now: now, expectedPendingIDs: before.pendingIDs)
        let replacement = try #require(try await store.nextProfileSubmission(now: now))
        #expect(replacement.id != original)
        let payload = try #require(JSONSerialization.jsonObject(with: replacement.bytes) as? [String: Any])
        #expect((payload["expectedRevision"] as? Int) == 5)
        #expect(try await store.profileView().pendingCount == 2)
        #expect(try await store.profileView().visible?.mapStyle == .satellite)
        await #expect(throws: (any Error).self) {
            // Never discard an in-flight/uncertain operation as if it were rejected.
            try await store.resolveProfileConflict(
                keepingLocalEdits: false, confirmedRevision: 5, now: now,
                expectedPendingIDs: before.pendingIDs)
        }
        try await store.acceptProfileOutcome(
            .init(operationID: replacement.id, status: .conflict, revisions: .init(profile: 6)),
            canonical: .init(revision: 6, displayName: "Latest remote"))
        try await store.resolveProfileConflict(
            keepingLocalEdits: false, confirmedRevision: 6, now: now,
            expectedPendingIDs: try await store.profileView().pendingIDs)
        #expect(try await store.profileView().pendingCount == 0)
        #expect(try await store.profileView().visible?.displayName == "Latest remote")
        await store.close()
    }
}
