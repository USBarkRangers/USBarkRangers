import BarkDomain
import Foundation
import SwiftData
import Synchronization
import Testing

@testable import BarkRanger

struct NativeSavedPinTests {
    private let region = SavedPlaceIndex.Region(
        latitude: 0, longitude: 0, latitudeDelta: 180, longitudeDelta: 360)
    private func place(_ id: String = "a") throws -> SavedPlace {
        try #require(
            SavedPlace(
                stop: .init(
                    id: "stop-" + id, placeIdentity: .custom(id), name: "Place " + id,
                    coordinate: Coordinate(latitude: 41, longitude: -81)), subtitle: "Ohio",
                savedAt: Date(timeIntervalSince1970: 1_800_000_000)))
    }
    @MainActor @Test func addingPinModelsUpgradesExistingStoreWithoutResettingProfileOrPendingBytes()
        async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let folder = try NativeStore.scopeDirectory(
            directory: directory, project: "demo-bark-native", uid: "upgrade")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let id = UUID().uuidString.lowercased()
        let bytes = try JSONEncoder().encode(NativeProfileEdit.bootstrap)
        try autoreleasepool {
            let types = NativeLocalSchema.models.filter {
                $0 != NativeLocalSchema.SavedPin.self && $0 != NativeLocalSchema.SavedPinCursor.self
            }
            let schema = Schema(types, version: .init(1, 1, 0))
            let container = try ModelContainer(
                for: schema,
                configurations: [
                    ModelConfiguration(
                        schema: schema,
                        url: folder.appendingPathComponent("native.store"), cloudKitDatabase: .none)
                ])
            let context = ModelContext(container)
            let metadata = NativeLocalSchema.Metadata(scope: "demo-bark-native:account:upgrade")
            metadata.sequence = 1
            context.insert(metadata)
            context.insert(
                NativeLocalSchema.PendingOperation(
                    id: id, entityKey: "profile", sequence: 1,
                    createdAtMs: 1_800_000_000_000, intent: bytes, predecessor: nil, expectedRevision: 0))
            try context.save()
        }
        let upgraded = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "upgrade")
        #expect(try await upgraded.profileView().pendingIDs == [UUID(uuidString: id)!])
        try await upgraded.seedPremium()
        try await upgraded.saveSavedPin(place())
        #expect(try await upgraded.pendingChanges().count == 2)
        await upgraded.close()
    }
    @Test func writeFailureIsAtomicAndDiscardRemovesOnlyTheNeverSentPinSuffix() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let failing = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "a",
            beforeSave: { if failing.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        let a = try place()
        let b = try place("b")
        try await store.seedPremium()
        failing.withLock { $0 = true }
        await #expect(throws: (any Error).self) { try await store.saveSavedPin(a) }
        #expect(try await store.savedPinValue(a.id).place == nil)
        #expect(try await store.pendingChanges().isEmpty)
        failing.withLock { $0 = false }
        try await store.saveSavedPin(a)
        let first = try #require(try await store.pendingChanges().first)
        #expect(first.title == "Save pin" && first.canDiscard)
        #expect(try await store.savedPins(in: region, including: [])[a.id]?.isPending == true)
        try await store.saveSavedPin(a, saved: false)
        try await store.saveSavedPin(a)
        try await store.saveSavedPin(b)
        let review = try await store.reviewPendingDiscard(first.id)
        #expect(review.ids.count == 3 && !review.retainsTripDraft)
        try await store.discardPending(review)
        #expect(try await store.savedPinValue(a.id).place == nil)
        #expect(try await store.savedPinValue(b.id).place != nil)
        #expect(try await store.savedPins(in: region, including: []).count == 1)
        await store.close()
    }
    @Test func sealedSaveSurvivesRelaunchAndCannotOverwriteANewerRemoteRemoval() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let a = try place()
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        try await store.seedPremium()
        try await store.saveSavedPin(a)
        let sealed = try #require(try await store.nextSavedPinSubmission())
        await #expect(throws: (any Error).self) { try await store.reviewPendingDiscard(sealed.id) }
        await store.close()
        let reopened = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        #expect(try await reopened.nextSavedPinSubmission() == sealed)
        let newer = NativeSavedPin(id: a.id, revision: 2, saved: false, place: try a.nativeValue)
        try await reopened.seedSavedPinsForTest([newer])
        #expect(try await reopened.savedPinValue(a.id).pending)
        try await reopened.acceptSavedPinOutcome(
            .init(
                version: 1, operationID: sealed.id, status: "accepted",
                confirmation: .init(id: a.id, revision: 1, saved: true, place: try a.nativeValue),
                revisions: .init(savedPin: 1)))
        #expect(try await reopened.savedPinValue(a.id).place == nil)
        #expect(try await reopened.pendingChanges().isEmpty)
        #expect(try await reopened.savedPins(in: region, including: []).isEmpty)
        await reopened.close()
    }
    @Test func freeAccountFileAdoptionPreservesReadAccessWithoutImportingGuestOrOtherOwners() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let root = SavedPlaceStore(directory: directory.appendingPathComponent("pins"))
        let original = root.scoped(project: "demo-bark-native", uid: "a")
        var a = try place()
        a.notes = "Keep this private local text"
        try await original.save(a)
        let guest = root.scoped(project: "demo-bark-native", uid: nil)
        try await guest.save(place("guest"))
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        let adopted = root.scoped(project: "demo-bark-native", uid: "a", native: store)
        try await adopted.prepare()
        #expect(try await adopted.saved(a.stop)?.notes == a.notes)
        #expect(try await store.pendingChanges().count == 1)
        #expect(
            try await SavedPlaceStore(directory: directory.appendingPathComponent("pins"))
                .scoped(project: "demo-bark-native", uid: "a").saved(a.stop) == nil)
        let repeated = root.scoped(project: "demo-bark-native", uid: "a", native: store)
        try await repeated.prepare()
        #expect(try await store.pendingChanges().count == 1)
        #expect(try await guest.saved(place("guest").stop) != nil)
        let other = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "b")
        #expect(try await other.savedPinValue(a.id).place == nil)
        await #expect(throws: NativeStore.Failure.wrongScope) {
            try await root.scoped(project: "demo-bark-native", uid: "a", native: other).prepare()
        }
        let bytes = try #require(try await store.nextSavedPinSubmission()?.bytes)
        #expect(!String(decoding: bytes, as: UTF8.self).contains(a.notes))
        await other.close()
        await store.close()
    }
    @Test func freeAndExpiredAccountsReadPinsButCannotStageChangesAndRenewalRetainsPendingBytes() async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "free")
        let a = try place()
        let b = try place("b")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.seedSavedPinsForTest([
            .init(id: a.id, revision: 1, saved: true, place: try a.nativeValue)
        ])
        await #expect(throws: NativeStore.Failure.unavailable) { try await store.saveSavedPin(b) }
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.saveSavedPin(a, saved: false)
        }
        #expect(try await store.savedPinValue(a.id).place != nil)
        #expect(try await store.pendingChanges().isEmpty)
        let now = Date()
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(now.addingTimeInterval(-39 * 86_400).timeIntervalSince1970 * 1000)))
        try await store.saveSavedPin(b, now: now)  // Same 40-day local grace as other paid features.
        let submitted = try #require(try await store.nextSavedPinSubmission())
        try await store.rejectSavedPin(submitted.id, code: "premium-required")
        try await store.acceptEntitlement(
            .init(
                revision: 2, premium: true, source: .production,
                validUntilMs: Int64(now.addingTimeInterval(-41 * 86_400).timeIntervalSince1970 * 1000)))
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.saveSavedPin(a, saved: false, now: now)
        }
        #expect(try await store.savedPinValue(a.id).place != nil)
        #expect(try await store.savedPinValue(b.id).pending)
        #expect(try await store.pendingChanges().count == 1)
        try await store.acceptEntitlement(
            .init(
                revision: 3, premium: true, source: .production,
                validUntilMs: Int64(now.addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        let resumed = try #require(try await store.nextSavedPinSubmission())
        #expect(resumed.id == submitted.id && resumed.bytes == submitted.bytes)
        await store.close()
    }
    @Test func refusedPinBlocksLaterEditsUntilDiscardedThenTheConfirmedPinReturns() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        try await store.seedPremium()
        let a = try place()
        try await store.seedSavedPinsForTest([
            .init(id: a.id, revision: 1, saved: true, place: try a.nativeValue)
        ])
        try await store.saveSavedPin(a, saved: false)
        let refused = try #require(try await store.nextSavedPinSubmission())
        try await store.rejectSavedPin(refused.id, code: "invalid")
        // The later edit queues behind the refused head and is never selected for delivery.
        try await store.saveSavedPin(a)
        #expect(try await store.nextSavedPinSubmission() == nil)
        #expect(try await store.savedPinValue(a.id).pending)
        let items = try await store.pendingChanges()
        #expect(items.map(\.state) == ["rejected", "queued"] && items.allSatisfy(\.canDiscard))
        #expect(items.first?.resumesWithAccess == false)
        await store.close()
        // The refusal and its exit survive relaunch.
        let reopened = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        #expect(try await reopened.nextSavedPinSubmission() == nil)
        let review = try await reopened.reviewPendingDiscard(refused.id)
        #expect(review.ids.count == 2 && review.ids.first == refused.id)
        try await reopened.discardPending(review)
        #expect(try await reopened.pendingChanges().isEmpty)
        let restored = try await reopened.savedPinValue(a.id)
        #expect(restored.place != nil && !restored.pending)
        #expect(try await reopened.savedPins(in: region, including: [])[a.id]?.isPending == false)
        // The pin accepts edits again, as a fresh operation.
        try await reopened.saveSavedPin(a, saved: false)
        let fresh = try #require(try await reopened.nextSavedPinSubmission())
        #expect(fresh.id != refused.id)
        await reopened.close()
    }
    @Test func onlyRefusedPinsGainDiscardAndSentOrOtherFeatureWorkStaysProtected() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        try await store.seedPremium()
        // A sealed pin may already be applied by the server; its outcome is unknown.
        try await store.saveSavedPin(place())
        let sealed = try #require(try await store.nextSavedPinSubmission())
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.reviewPendingDiscard(sealed.id)
        }
        // Expiry never destroys paid work by itself, but the user may give up on it.
        // The row says it would retry, so the Discard warning can state what is lost.
        try await store.rejectSavedPin(sealed.id, code: "premium-required")
        #expect(try await store.reviewPendingDiscard(sealed.id).ids == [sealed.id])
        let waiting = try #require(try await store.pendingChanges().first)
        #expect(waiting.canDiscard && waiting.resumesWithAccess)
        #expect(waiting.status == "Premium required · will retry if access returns")
        // A refused profile edit keeps its own review; Discard stays never-sent only.
        _ = try await store.stageProfileEdit(.displayName("First"))
        let profile = try #require(try await store.nextProfileSubmission())
        try await store.rejectProfileOperation(profile.id, code: "invalid")
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.reviewPendingDiscard(profile.id)
        }
        #expect(try await store.pendingChanges().first { $0.id == profile.id }?.canDiscard == false)
        await store.close()
    }
    @Test func repeatedMapQueriesDoNotRebuildTheIndexAndOnePinUpdatesOnlyOneRow() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        let values = try (0..<300).map { i -> NativeSavedPin in
            let pin = try place("pin-\(i)")
            return .init(id: pin.id, revision: 1, saved: true, place: try pin.nativeValue)
        }
        try await store.seedSavedPinsForTest(values)
        let count = Mutex(0)
        await store.observeSavedPinIndexForTest { n in count.withLock { $0 += n } }
        #expect(try await store.savedPins(in: region, including: []).count == 300)
        #expect(count.withLock { $0 } == 300)
        count.withLock { $0 = 0 }
        for _ in 0..<100 { #expect(try await store.savedPins(in: region, including: []).count == 300) }
        #expect(count.withLock { $0 } == 0)
        let first = try #require(values.first)
        try await store.seedSavedPinsForTest([
            .init(id: first.id, revision: 2, saved: false, place: first.place)
        ])
        #expect(try await store.savedPins(in: region, including: []).count == 299)
        #expect(count.withLock { $0 } == 1)
        print("NATIVE_PIN_INDEX initial=300 repeated100=0 oneRemoteRemoval=1; cloudCalls=0 (local-only API)")
        await store.close()
    }
}

extension NativeStore {
    func seedSavedPinsForTest(_ values: [NativeSavedPin]) throws {
        for value in values { try stageSavedPin(value) }
        try commit()
        publish([.savedPins])
    }
    func observeSavedPinIndexForTest(_ observer: @escaping @Sendable (Int) -> Void) {
        savedPinIndexObserver = observer
    }
}
