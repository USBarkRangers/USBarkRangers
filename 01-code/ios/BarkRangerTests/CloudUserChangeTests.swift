import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct CloudUserChangeTests {
    @Test func collectionDeltasPreserveDraftPendingIntentOtherDataAndConfirmationDate() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: folder, uid: "changes")
        try await store.seedPremium()
        let draft = LegacyTripDraft(trip: Trip(name: "Local draft"))
        try await store.saveDraft(draft)
        try await store.commit(kind: .profile, value: .string("Unsubmitted name"))
        let before = try await store.readSnapshot()
        let trip = SavedRecord(id: "remote", fields: ["unknown": .string("retain")])
        let award = SavedRecord(id: "historic", fields: ["tier": .string("verified")])
        try await store.applyCloudEvent(.init(change: .trips(upserts: [trip], removed: []), revision: 1))
        try await store.applyCloudEvent(
            .init(change: .achievements(upserts: [award], removed: []), revision: 2))
        let changed = try await store.readSnapshot()
        #expect(changed.pending == before.pending && changed.drafts == before.drafts)
        #expect(changed.baseline.profile == before.baseline.profile)
        #expect(changed.baseline.confirmedAt == before.baseline.confirmedAt)
        #expect(changed.baseline.trips == [trip] && changed.baseline.achievements == [award])
        try await store.applyCloudEvent(.init(change: .trips(upserts: [], removed: [trip.id]), revision: 3))
        let deleted = try await store.readSnapshot()
        #expect(deleted.baseline.trips.isEmpty && deleted.baseline.achievements == [award])
        #expect(deleted.drafts == before.drafts && deleted.visible.profile.displayName == "Unsubmitted name")
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }

    @Test func delayedListenerOrPointReadCannotRollBackNewerDocumentOrResurrectDeletion() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: folder, uid: "order")
        let profile = UserProfile(fields: ["displayName": .string("Latest")])
        try await store.applyCloudEvent(.init(change: .profile(profile, confirmedAt: Date()), revision: 5))
        try await store.applyCloudEvent(
            .init(change: .profile(UserProfile(), confirmedAt: Date()), revision: 4))
        #expect(try await store.readSnapshot().baseline.profile == profile)
        let trip = SavedRecord(id: "trip", fields: ["note": .string("Keep independent change")])
        // An older callback for another document is still relevant.
        try await store.applyCloudEvent(.init(change: .trips(upserts: [trip], removed: []), revision: 4))
        #expect(try await store.readSnapshot().baseline.trips == [trip])
        try await store.applyCloudEvent(.init(change: .trips(upserts: [], removed: [trip.id]), revision: 6))
        try await store.applyCloudEvent(.init(change: .trips(upserts: [trip], removed: []), revision: 5))
        #expect(try await store.readSnapshot().baseline.trips.isEmpty)
        // A reconnect can start a different transport clock after the old reader is cancelled.
        try await store.applyCloudEvent(.init(change: .initial(PersonalSnapshot(uid: "order")), revision: 1))
        try await store.applyCloudEvent(.init(change: .profile(profile, confirmedAt: Date()), revision: 2))
        #expect(try await store.readSnapshot().baseline.profile == profile)
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }

    @Test func malformedOrWrongAccountEventKeepsTheLastGoodSnapshot() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: folder, uid: "safe")
        try await store.seedPremium()
        let before = try await store.readSnapshot()
        await #expect(throws: CloudUserDecoder.Failure.incomplete) {
            try await store.applyCloudEvent(
                .init(
                    change: .profile(
                        UserProfile(fields: ["visitedPlaces": .string("malformed")]), confirmedAt: Date()),
                    revision: 1))
        }
        await #expect(throws: LocalStore.Failure.wrongAccount) {
            try await store.applyCloudEvent(
                .init(change: .initial(PersonalSnapshot(uid: "other")), revision: 2))
        }
        #expect(try await store.readSnapshot() == before)
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }
}
