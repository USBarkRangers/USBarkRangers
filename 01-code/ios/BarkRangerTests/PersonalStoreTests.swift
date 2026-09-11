import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor struct PersonalStoreTests {
    @Test func offlineIntentsSurviveReopenAndOnlyExactReceiptClearsThem() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        try await store.commit(kind: .profile, value: .string("First name"))
        try await store.commit(kind: .profile, value: .string("Second name"))
        let saved = try await store.readSnapshot()
        await store.close()
        let reopened = try await LocalStore.open(directory: folder, uid: "a")
        #expect(try await reopened.readSnapshot() == saved)
        let first = try #require(saved.pending.first?.operation)
        let forged = UserMutation(
            uid: "a", kind: .profile, expected: first.expected, value: .string("Forged"), id: first.id)
        await #expect(throws: (any Error).self) {
            try await reopened.acknowledge(.init(operation: forged, outcome: .accepted, current: .null))
        }
        let receipt = MutationReceipt(operation: first, outcome: .accepted, current: first.expected)
        try await reopened.acknowledge(receipt)
        try await reopened.acknowledge(receipt)
        let after = try await reopened.readSnapshot()
        #expect(after.pending.count == 1)
        #expect(after.visible.profile.displayName == "Second name")
        await reopened.close()
    }
    @Test func lateReadCannotUndoAcceptedEditAndConflictsKeepLocalValueUntilResolution() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        let sequence = try await store.beginRead()
        try await store.commit(kind: .profile, value: .string("Local name"))
        let operation = try #require(try await store.readSnapshot().pending.first?.operation)
        try await store.acknowledge(
            .init(operation: operation, outcome: .accepted, current: operation.expected))
        try await store.applyServerSnapshot(.init(uid: "a"), sequence: sequence)
        #expect(try await store.readSnapshot().visible.profile.displayName == "Local name")
        try await store.commit(kind: .profile, value: .string("New local"))
        let pending = try #require(try await store.readSnapshot().pending.first?.operation)
        let remote = UserValue.object(["displayName": .string("Remote"), "username": .string("Remote")])
        try await store.acknowledge(.init(operation: pending, outcome: .conflict, current: remote))
        #expect(try await store.readSnapshot().visible.profile.displayName == "New local")
        try await store.resolve(id: pending.id, keepLocal: true)
        let retried = try #require(try await store.readSnapshot().pending.first?.operation)
        #expect(retried.id != pending.id)
        #expect(retried.expected == remote)
        #expect(retried.value == .string("New local"))
        await store.close()
    }
    @Test func resolvingConflictUsesTheNewestAcceptedServerValue() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        try await store.commit(kind: .profile, value: .string("Local"))
        let op = try #require(try await store.readSnapshot().pending.first?.operation)
        try await store.acknowledge(
            .init(
                operation: op, outcome: .conflict,
                current: .object([
                    "displayName": .string("Older server"), "username": .string("Older server"),
                ])))
        let newer = PersonalSnapshot(
            uid: "a",
            profile: .init(fields: [
                "displayName": .string("Newer server"), "username": .string("Newer server"),
            ]))
        try await store.applyServerSnapshot(newer, sequence: store.beginRead())
        try await store.resolve(id: op.id, keepLocal: false)
        #expect(try await store.readSnapshot().visible.profile.displayName == "Newer server")
        #expect(try await store.readSnapshot().pending.isEmpty)
        await store.close()
    }
    @Test func failedSavePublishesNeitherChangeNorIntentAndExistingDiskRemainsReadable() async throws {
        let gate = SaveFailureGate()
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a", beforeSave: { try gate.check() })
        try await store.commit(kind: .profile, value: .string("Durable"))
        let before = try await store.readSnapshot()
        gate.fail()
        await #expect(throws: (any Error).self) {
            try await store.commit(kind: .profile, value: .string("Lost"))
        }
        #expect(try await store.readSnapshot() == before)
        await store.close()
        let reopened = try await LocalStore.open(directory: folder, uid: "a")
        #expect(try await reopened.readSnapshot() == before)
        await reopened.close()
    }
    @Test func foreignSnapshotsAreRejectedAndAccountFoldersNeverShareData() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let a = try await LocalStore.open(directory: folder, uid: "a")
        let b = try await LocalStore.open(directory: folder, uid: "b")
        try await a.commit(kind: .profile, value: .string("Only A"))
        let read = try await b.beginRead()
        await #expect(throws: (any Error).self) {
            try await b.applyServerSnapshot(.init(uid: "a"), sequence: read)
        }
        #expect(try await b.readSnapshot().pending.isEmpty)
        #expect(try await b.readSnapshot().visible.profile.displayName == "Bark Ranger")
        await a.close()
        await b.close()
    }
    @Test func deletingOneClosedAccountKeepsTheOtherAccountAndItsPendingWrites() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let a = try await LocalStore.open(directory: folder, uid: "a")
        let b = try await LocalStore.open(directory: folder, uid: "b")
        try await b.commit(kind: .profile, value: .string("Keep B"))
        await a.close()
        try await LocalStore.removeAccount(directory: folder, uid: "a")
        #expect(try await b.readSnapshot().visible.profile.displayName == "Keep B")
        #expect(try await b.readSnapshot().pending.count == 1)
        await b.close()
        let reopened = try await LocalStore.open(directory: folder, uid: "b")
        #expect(try await reopened.readSnapshot().visible.profile.displayName == "Keep B")
        await reopened.close()
    }
    @Test func mapPreferenceRequiresTrustedUnexpiredAccountAccessAndPreservesOtherFields() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        await #expect(throws: (any Error).self) {
            try await store.commit(kind: .mapStyle, value: .string("satellite"))
        }
        let snapshot = PersonalSnapshot(
            uid: "a",
            profile: .init(fields: [
                "entitlement": .object([
                    "premium": .bool(true), "status": .string("active"),
                ]), "settings": .object(["other": .number(7)]),
            ]), confirmedAt: Date())
        try await store.applyServerSnapshot(snapshot, sequence: store.beginRead())
        try await store.commit(kind: .mapStyle, value: .string("satellite"))
        #expect(try await store.readSnapshot().visible.profile.settings["other"] == .number(7))
        await store.close()
    }
}

nonisolated final class SaveFailureGate: Sendable {
    private let failing = Mutex(false)
    func fail() { failing.withLock { $0 = true } }
    func check() throws {
        if failing.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) }
    }
}
