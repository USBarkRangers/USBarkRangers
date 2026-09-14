import BarkDomain
import CryptoKit
import Foundation
import SwiftData
import Testing

@testable import BarkRanger

@MainActor struct PersonalPayloadTests {
    @Test func phase3FixtureOpensWithoutRewritingAndSurvivesVersionedSave() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let url = try #require(
            Bundle(for: PayloadFixtureBundle.self).url(
                forResource: "phase3-personal-state", withExtension: "json"))
        let bytes = try Data(contentsOf: url)
        let original = try JSONDecoder().decode(PersonalState.self, from: bytes)
        try await Self.seed(bytes, directory: folder)
        let store = try await LocalStore.open(directory: folder, uid: "compatibility-user")
        #expect(try await store.readSnapshot() == original)
        #expect(try await Self.savedBytes(directory: folder) == bytes)
        #expect(original.visible.profile.displayName == "Unsynced name")
        #expect(original.pending.first?.receipt?.outcome == .conflict)
        #expect(original.baseline.trips.first?.fields["unknown"]?.string == "Keep this too")
        _ = try await store.beginRead()
        let expected = try await store.readSnapshot()
        await store.close()
        let encoded = try await Self.savedBytes(directory: folder)
        let envelope = try #require(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(envelope["version"] as? Int == 4)
        #expect(try JSONDecoder().decode(PersonalState.self, from: encoded) == expected)
        let reopened = try await LocalStore.open(directory: folder, uid: "compatibility-user")
        #expect(try await reopened.readSnapshot() == expected)
        await reopened.close()
        try FileManager.default.removeItem(at: folder)
    }

    @Test(arguments: [
        "{broken", "{\"version\":99,\"state\":{}}", "{\"baseline\":{\"uid\":\"compatibility-user\"}}",
    ])
    func unreadableOrFuturePayloadIsPreservedAndDoesNotBecomeAnEmptyAccount(_ text: String) async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let bytes = Data(text.utf8)
        try await Self.seed(bytes, directory: folder)
        await #expect(throws: PersonalPayload.Failure.self) {
            _ = try await LocalStore.open(directory: folder, uid: "compatibility-user")
        }
        #expect(try await Self.savedBytes(directory: folder) == bytes)
        let auth = SyntheticAuth()
        let session = AccountSession(auth: auth, cloud: nil, directory: folder)
        session.setForeground(true)
        auth.select("compatibility-user")
        try await eventually { session.requiresStorageRecovery }
        #expect(session.state == nil && session.profile == nil)
        await session.stopAndWait()
        #expect(try await Self.savedBytes(directory: folder) == bytes)
        try FileManager.default.removeItem(at: folder)
    }

    @concurrent private static func seed(_ bytes: Data, directory: URL) async throws {
        let container = try container(directory: directory)
        let context = ModelContext(container)
        context.insert(LocalSchema.AccountRecord(uid: "compatibility-user", payload: bytes))
        try context.save()
    }
    @concurrent private static func savedBytes(directory: URL) async throws -> Data {
        let context = ModelContext(try container(directory: directory))
        return try #require(context.fetch(FetchDescriptor<LocalSchema.AccountRecord>()).first).payload
    }
    nonisolated private static func container(directory: URL) throws -> ModelContainer {
        let name = SHA256.hash(data: Data("compatibility-user".utf8)).map { String(format: "%02x", $0) }
            .joined()
        let folder = directory.appendingPathComponent(name)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let schema = Schema(versionedSchema: LocalSchema.self)
        return try ModelContainer(
            for: schema,
            configurations: ModelConfiguration(
                schema: schema, url: folder.appendingPathComponent("account.store"), cloudKitDatabase: .none))
    }
}
private final class PayloadFixtureBundle: NSObject {}
