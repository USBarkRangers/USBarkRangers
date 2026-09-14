import BarkDomain
import Foundation
import MapKit
import SwiftData
import Testing

@testable import BarkRanger

struct NativePendingChangesTests {
    @Test func renewalRetriesOriginalWalkBytesWithoutCreatingTwoUncertainWalks() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await seeded(directory)
        let now = Date()
        for _ in 0..<2 {
            let walk = try NativeActivitySummary(
                WalkSummary(
                    source: .gps,
                    startedAt: now.addingTimeInterval(-600), endedAt: now, meters: 500, elapsedSeconds: 600))
            try await store.stageNativeExpeditionOperation(
                .init(action: .record(walk), recordedTrailName: "Retained walk"))
            let command = try #require(try await store.nextExpeditionSubmission())
            try await store.rejectExpeditionOperation(command.submission.id, code: "premium-required")
        }
        let before = try await store.expeditionQueue()
        try await store.acceptEntitlement(
            .init(revision: 2, premium: false, source: .production, validUntilMs: 0))
        try await store.resumeAuthorizedSubmissions()
        #expect(try await store.expeditionQueue().allSatisfy { $0.state == "rejected" })
        try await store.acceptEntitlement(
            .init(
                revision: 3, premium: true, source: .production,
                validUntilMs: Int64(now.addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        try await store.resumeAuthorizedSubmissions()
        let after = try await store.expeditionQueue()
        #expect(after.map(\.id) == before.map(\.id))
        #expect(after.filter { $0.state == "sealed" }.count == 1)
        let first = try #require(try await store.nextExpeditionSubmission())
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "pending-owner")
        #expect(try await reopened.nextExpeditionSubmission()?.submission == first.submission)
        await #expect(throws: (any Error).self) {
            try await reopened.reviewPendingDiscard(first.submission.id)
        }
        await reopened.close()
    }
    @MainActor @Test func switchingAccountClearsVisiblePinsBeforeTheNextDiskRead() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let auth = SyntheticAuth()
        let session = AccountSession(auth: auth, directory: directory.appendingPathComponent("Account"))
        let root = SavedPlaceStore(directory: directory.appendingPathComponent("Pins"))
        let stop = Trip.Stop(
            name: "A private place", coordinate: try #require(Coordinate(latitude: 40, longitude: -80)))
        let place = try #require(SavedPlace(stop: stop, subtitle: "A only"))
        try await root.scoped(project: "bark-ranger-ios", uid: "A").save(place)
        session.start()
        auth.select("A")
        try await eventually { session.identity?.uid == "A" }
        let model = SavedPlacesModel(store: root, account: session)
        model.viewport(
            MKCoordinateRegion(
                center: .init(latitude: 40, longitude: -80), span: .init(latitudeDelta: 1, longitudeDelta: 1)),
            including: [])
        await model.waitForPending()
        try await eventually { model.places[place.id] != nil }
        auth.select("B")
        try await eventually { session.identity?.uid == "B" }
        #expect(model.places[place.id] == nil)
        await model.waitForPending()
        #expect(model.places.isEmpty)
        auth.select("A")
        try await eventually { session.identity?.uid == "A" }
        try await eventually { model.places[place.id] != nil }
        await model.waitForPending()
        await session.stopAndWait()
        await model.waitForPending()
    }
    private func seeded(_ directory: URL) async throws -> NativeStore {
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "pending-owner")
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
        try await store.acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        return store
    }

    @Test func discardReviewsDependentSuffixAndRefusesChangesSentAfterReview() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await seeded(directory)
        let a = try await store.stageProfileEdit(.displayName("First"))
        let b = try await store.stageProfileEdit(.mapStyle(.satellite))
        let review = try await store.reviewPendingDiscard(a)
        #expect(review.ids == [a, b])
        _ = try await store.nextProfileSubmission()
        await #expect(throws: (any Error).self) { try await store.discardPending(review) }
        #expect(try await store.pendingChanges().count == 2)
        let tail = try await store.reviewPendingDiscard(b)
        try await store.discardPending(tail)
        #expect(try await store.profileView().visible?.mapStyle == .default)
        #expect(try await store.profileView().totalPendingCount == 1)
        await store.close()
    }

    @Test func largerQueuesStayReadableAndOnlyParkCapturesBypassAdmission() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await seeded(directory)
        try await store.seedPendingCapacityFixture(NativeSyncPolicy.queueLimit)
        #expect(try await store.profileView().totalPendingCount == 1000)
        #expect(try await store.pendingChanges().count == 1000)
        #expect(try await store.tripLocalLists().pending.isEmpty)
        #expect(try await store.pendingTripIDs().isEmpty)
        await #expect(throws: (any Error).self) { try await store.stageProfileEdit(.displayName("Full")) }
        let now = Date()
        let park = Park(
            id: .init(rawValue: "park"), siteID: .init(rawValue: "park"), name: "Park",
            coordinate: try #require(Coordinate(latitude: 40, longitude: -80)))
        let visit = try NativeVisitDraft(park: park, id: "visit-park", now: now, timeZone: .gmt, fix: nil)
        let mark = NativeVisitChange(
            intent: .init(
                target: .init(
                    visitID: visit.id,
                    officialPlaceID: visit.officialPlaceID, siteID: visit.siteID, visitRevision: 0,
                    placeRevision: 0),
                edit: .mark(happenedAtMs: visit.happenedAtMs, timeZone: visit.timeZone, proximity: nil)),
            before: nil, after: visit)
        try await store.stageNativeVisitOperation(.single(mark))
        let walk = try NativeActivitySummary(
            WalkSummary(
                source: .gps, startedAt: now.addingTimeInterval(-600),
                endedAt: now, meters: 500, elapsedSeconds: 600))
        try await store.stageNativeExpeditionOperation(
            .init(action: .record(walk), recordedTrailName: "Offline park walk"))
        let manual = try NativeActivitySummary(
            WalkSummary(
                source: .manual, startedAt: now, endedAt: now,
                meters: 500, elapsedSeconds: 0))
        await #expect(throws: (any Error).self) {
            try await store.stageNativeExpeditionOperation(
                .init(action: .record(manual), recordedTrailName: "Manual import"))
        }
        #expect(try await store.profileView().totalPendingCount == 1002)
        #expect(try await store.pendingChanges().contains { $0.detail.contains("Park") })
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "pending-owner")
        #expect(try await reopened.profileView().totalPendingCount == 1002)
        #expect(try await reopened.nextVisitSubmission() != nil)
        #expect(try await reopened.nextExpeditionSubmission() != nil)
        await reopened.close()
    }

    @Test func savedPinsAreIsolatedAcrossAccountsGuestsProjectsAndRelaunch() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let root = SavedPlaceStore(directory: directory)
        let stop = Trip.Stop(
            name: "My place", coordinate: try #require(Coordinate(latitude: 40, longitude: -80)))
        let place = try #require(SavedPlace(stop: stop, subtitle: "Private"))
        try await root.save(place)  // Unowned earlier test file is not imported.
        let a = root.scoped(project: "demo-bark-native", uid: "A")
        #expect(try await a.saved(stop) == nil)
        try await a.save(place)
        #expect(try await root.scoped(project: "demo-bark-native", uid: "B").saved(stop) == nil)
        #expect(try await root.scoped(project: "demo-bark-native", uid: nil).saved(stop) == nil)
        #expect(try await root.scoped(project: "bark-ranger-ios", uid: "A").saved(stop) == nil)
        #expect(
            try await SavedPlaceStore(directory: directory).scoped(project: "demo-bark-native", uid: "A")
                .saved(stop) == place)
    }
}

extension NativeStore {
    /// Batch only the synthetic setup, not the behavior under test. Every row is a
    /// valid ordered profile edit; actual admission, capture and reopen use runtime APIs.
    fileprivate func seedPendingCapacityFixture(_ count: Int) throws {
        var previous: String?
        for i in 0..<count {
            let id = UUID().uuidString.lowercased()
            let row = NativeLocalSchema.PendingOperation(
                id: id, entityKey: "profile", sequence: try nextNativeSequence(),
                createdAtMs: Int64(Date().timeIntervalSince1970 * 1000),
                intent: try JSONEncoder().encode(NativeProfileEdit.displayName("Name \(i)")),
                predecessor: previous, expectedRevision: previous == nil ? 1 : nil)
            modelContext.insert(row)
            previous = id
        }
        try commitProfileChange()
    }
}
