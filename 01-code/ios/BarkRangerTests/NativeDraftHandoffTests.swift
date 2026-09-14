import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct NativeDraftHandoffTests {
    @Test func collidingGuestIDRetainsBothVersionsAndDoesNotAcknowledgeTheMove() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "guest-drafts", guest: true)
        let target = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "a", guest: true)
        let guest = TripDraft(trip: Trip(id: "same", name: "Guest notes"))
        let existing = TripDraft(trip: Trip(id: "same", name: "Existing notes"))
        _ = try await source.checkpointNativeDraft(guest, replacing: nil)
        _ = try await target.checkpointNativeDraft(existing, replacing: nil)
        let claim = try await source.claimDeviceDrafts(for: "a")
        await #expect(throws: NativeStore.Failure.invalidAcknowledgment) {
            try await target.adoptDeviceDrafts(claim, source: "guest")
        }
        #expect(try await target.currentNativeDraft(id: existing.id) == existing)
        #expect(try await source.claimDeviceDrafts(for: "a") == [guest])
        await source.close()
        await target.close()
    }
    @Test func guestClaimCannotLeakToAnotherAccountOrReimportAfterDeletion() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let guest = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "guest-drafts", guest: true)
        let original = TripDraft(trip: Trip(name: "Guest work"))
        _ = try await guest.checkpointNativeDraft(original, replacing: nil)
        let claim = try await guest.claimDeviceDrafts(for: "a")
        #expect(claim == [original])
        #expect(try await guest.tripLocalLists().drafts.isEmpty)
        #expect(try await guest.currentNativeDraft(id: original.id) == nil)
        #expect(try await guest.claimDeviceDrafts(for: "b").isEmpty)
        let a = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        try await a.adoptDeviceDrafts(claim, source: "guest")
        try await a.adoptDeviceDrafts(claim, source: "guest")
        #expect(try await a.tripLocalLists().drafts.count == 1)
        #expect(try await a.pendingTripIDs().isEmpty)
        try await a.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await a.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        try await a.deleteNativeTrip(matching: original)
        try await a.adoptDeviceDrafts(claim, source: "guest")
        #expect(try await a.tripLocalLists().drafts.isEmpty)
        try await guest.finishDeviceDraftHandoff(for: "a")
        #expect(try await guest.claimDeviceDrafts(for: "a").isEmpty)
        await a.close()
        await guest.close()
    }

    @Test func olderGuestFileIsRecoveredWithoutRawExpectedDataEnteringNativeStorage() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let legacy = try await LocalStore.open(
            directory: directory.appendingPathComponent("GuestDrafts"), uid: "guest-drafts", isGuest: true)
        let draft = LegacyTripDraft(trip: Trip(name: "Earlier on-device plan"))
        try await legacy.saveDraft(draft)
        await legacy.close()
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "guest-drafts", guest: true)
        try await NativeDraftHandoff.importEarlierGuestFiles(directory: directory, into: store)
        let restored = try #require(try await store.currentNativeDraft(id: draft.id))
        #expect(restored.trip == draft.trip)
        let bytes = try JSONEncoder().encode(restored)
        #expect(!String(decoding: bytes, as: UTF8.self).contains("expected"))
        try await NativeDraftHandoff.importEarlierGuestFiles(directory: directory, into: store)
        #expect(try await store.tripLocalLists().drafts.count == 1)
        await store.close()
    }
}
