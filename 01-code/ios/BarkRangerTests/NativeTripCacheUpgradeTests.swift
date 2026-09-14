import BarkDomain
import CryptoKit
import Foundation
import SwiftData
import Testing

@testable import BarkRanger

extension NativeTripReconciliationTests {
    @Test func actualVersionOneStoreUpgradesWithoutResettingAuthoredData() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let (draft, sealed) = try await writeVersionOneTripStore(directory)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "cache-upgrade")
        #expect(try await store.currentNativeDraft(id: draft.id) == draft)
        #expect(try await store.restoreCachedNativeSelection(expectedID: draft.id) == draft)
        #expect(try await store.nextTripSubmission(id: draft.id) == sealed)
        #expect(try await store.cachedTrip(id: draft.id) == nil)
        #expect(try await store.tripCacheStamp(draft.id) == nil)
        try await store.acceptTripSnapshot(
            nativeTripSnapshot(Trip(id: draft.id, name: "Old trip"), revision: 1))
        #expect(try await store.tripCacheStamp(draft.id)?.metadata?.revision == 1)
        #expect(try await store.currentNativeDraft(id: draft.id) == draft)
        #expect(try await store.nextTripSubmission(id: draft.id) == sealed)
        await store.close()
    }
}

/// Freeze the previous cache entity, not the updated type with a field set to nil.
/// All other entities are unchanged by this upgrade.
nonisolated private enum NativeTripCacheV1: VersionedSchema {
    static var versionIdentifier: Schema.Version { .init(1, 0, 0) }
    static var models: [any PersistentModel.Type] {
        NativeLocalSchema.models.filter {
            ObjectIdentifier($0) != ObjectIdentifier(NativeLocalSchema.TripContent.self)
        }
            + [TripContent.self]
    }
    @Model final class TripContent {
        #Index<TripContent>([\.lastAccess])
        @Attribute(.unique) var id: String
        var revision: Int64
        var bytes: Data
        var byteCount: Int
        var lastAccess: Date
        init(id: String, revision: Int64, bytes: Data) {
            self.id = id
            self.revision = revision
            self.bytes = bytes
            byteCount = bytes.count
            lastAccess = Date()
        }
    }
}

@MainActor private func writeVersionOneTripStore(_ directory: URL) async throws -> (
    TripDraft, NativeStore.Submission
) {
    // Restrict the model/container lifetime to this call; NativeStore opens the same
    // on-disk file only after the old schema's context has been released.
    let scope = "demo-bark-native:account:cache-upgrade"
    let name = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
    let folder = directory.appendingPathComponent("entities-v1").appendingPathComponent(name)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let schema = Schema(versionedSchema: NativeTripCacheV1.self)
    let configuration = ModelConfiguration(
        schema: schema, url: folder.appendingPathComponent("native.store"), cloudKitDatabase: .none)
    let container = try ModelContainer(for: schema, configurations: [configuration])
    let context = ModelContext(container)
    context.autosaveEnabled = false
    let sequence = NativeLocalSchema.Metadata(scope: scope)
    sequence.sequence = 1
    context.insert(sequence)
    let trip = Trip(id: "legacy-trip", name: "Old trip")
    let snapshot = try nativeTripSnapshot(trip, revision: 1)
    let metadata = try #require(snapshot.metadata)
    context.insert(
        NativeLocalSchema.TripMetadata(
            id: trip.id, revision: 1, contentRevision: 1, createdSeconds: metadata.createdAt.seconds,
            createdNanos: metadata.createdAt.nanoseconds, createdAt: metadata.createdAt.date,
            updatedAt: metadata.updatedAt.date, isTombstone: false,
            payload: try JSONEncoder().encode(metadata)))
    context.insert(
        NativeTripCacheV1.TripContent(
            id: trip.id, revision: 1,
            bytes: try JSONEncoder().encode(try #require(snapshot.content))))
    var draft = TripDraft(
        trip: trip,
        nativeBase: .init(
            contentRevision: 1, notes: [:],
            contentFingerprint: try NativeTripBase.fingerprint(trip)))
    draft.trip.days[0].notes = "Keep my queued notes"
    context.insert(
        NativeLocalSchema.Draft(
            id: draft.id, editRevision: 1, title: draft.trip.name,
            dayCount: 1, stopCount: 0, dirty: true, bytes: try JSONEncoder().encode(draft)))
    context.insert(NativeLocalSchema.Selection(tripID: draft.id, dayID: draft.activeDayID))
    let id = UUID()
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    let intent = NativeTripIntent.save(draft)
    let bytes = try JSONEncoder().encode(
        NativeTripCommand(
            operationID: id, createdAtMs: now,
            expectedRevision: 1, intent: intent))
    let operation = NativeLocalSchema.PendingOperation(
        id: id.uuidString.lowercased(),
        entityKey: "trip:\(draft.id)", sequence: 1, createdAtMs: now,
        intent: try JSONEncoder().encode(intent), predecessor: nil, expectedRevision: 1)
    operation.listSummary = try JSONEncoder().encode(NativeTripListItem(trip: draft.trip))
    operation.draftFingerprint = try NativeTripBase.fingerprint(draft.trip)
    operation.state = "sealed"
    operation.sealedBytes = bytes
    context.insert(operation)
    try context.save()
    return (draft, .init(id: id, bytes: bytes, attempts: 0))
}
