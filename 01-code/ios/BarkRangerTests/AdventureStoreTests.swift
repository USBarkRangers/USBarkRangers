import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor struct AdventureStoreTests {
    @Test func draftRelaunchStableSaveReceiptAndConflictRetainBothVersions() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: directory, uid: "trips")
        var snapshot = PersonalSnapshot(
            uid: "trips",
            profile: .init(fields: [
                "entitlement": .object(["premium": .bool(true), "status": .string("active")])
            ]), confirmedAt: Date())
        try await store.applyServerSnapshot(snapshot, sequence: store.beginRead())
        let coordinate = try #require(Coordinate(latitude: 44, longitude: -68))
        var draft = LegacyTripDraft(
            trip: Trip(
                id: "stable-trip",
                days: [
                    Trip.Day(
                        stops: [.init(name: "Custom", coordinate: coordinate)],
                        notes: "Do not lose these notes")
                ]))
        try await TripRepository(store: store).saveDraft(draft)
        await store.close()
        let reopened = try await LocalStore.open(directory: directory, uid: "trips")
        #expect(try await reopened.readSnapshot().drafts?.first == draft)
        try await TripRepository(store: reopened).save(id: draft.id)
        let operation = try #require(try await reopened.readSnapshot().pending.first?.operation)
        #expect(operation.kind == .trip && operation.value.object?["id"]?.string == "stable-trip")
        try await reopened.acknowledge(.init(operation: operation, outcome: .accepted, current: .null))
        try await reopened.acknowledge(.init(operation: operation, outcome: .accepted, current: .null))
        #expect(try await reopened.readSnapshot().visible.trips.count == 1)
        draft = try #require(try await reopened.readSnapshot().drafts?.first)
        draft.trip.name = "Local version"
        try await TripRepository(store: reopened).saveDraft(draft)
        try await TripRepository(store: reopened).save(id: draft.id)
        let pending = try #require(try await reopened.readSnapshot().pending.first)
        var remote = draft.trip
        remote.name = "Web version"
        try await reopened.acknowledge(
            .init(operation: pending.operation, outcome: .conflict, current: remote.content))
        #expect(
            try await reopened.readSnapshot().visible.trips.first?.fields["tripName"]?.string
                == "Local version")
        #expect(
            try await reopened.readSnapshot().baseline.trips.first?.fields["tripName"]?.string
                == "Web version")
        try await TripRepository(store: reopened).resolve(pending.id, keepLocal: true)
        let rebased = try #require(try await reopened.readSnapshot().pending.first?.operation)
        #expect(rebased.id != pending.id && rebased.expected == remote.content)
        snapshot = try await reopened.readSnapshot().baseline
        snapshot.profile.fields["entitlement"] = .object([
            "premium": .bool(false), "status": .string("expired"),
        ])
        try await reopened.applyServerSnapshot(snapshot, sequence: reopened.beginRead())
        await #expect(throws: LocalStore.Failure.unavailableAccess) {
            try await TripRepository(store: reopened).save(id: draft.id)
        }
        await reopened.close()
        try FileManager.default.removeItem(at: directory)
    }
    @Test func guestDraftsAreAdoptedLocallyAndNoLongerRemainInGuestPresentation() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let auth = SyntheticAuth()
        let (app, _, _) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let configuration = NativeProfileConfiguration(project: "demo-bark-native", connect: {
            try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: $0)
        })
        let session = AccountSession(auth: auth, cloud: nil, directory: directory,
            capabilities: .editableTest, nativeProfileConfiguration: configuration)
        session.start()
        try await eventually { session.nativeTrips != nil }
        let draft = TripDraft(trip: Trip(name: "Guest only"))
        try await session.nativeTrips?.repository.saveDraft(draft)
        try await eventually { session.nativeTrips?.library.drafts.count == 1 }
        #expect(session.identity == nil && session.state == nil)
        auth.select("different-account")
        try await eventually { session.nativeTrips?.scope.hasSuffix(":different-account") == true }
        #expect(try await session.nativeTrips?.repository.currentDraft(id: draft.id) == draft)
        #expect(try await session.nativeTrips?.repository.store.pendingTripIDs().isEmpty == true)
        auth.select(nil)
        try await eventually { session.nativeTrips != nil && session.identity == nil }
        #expect(session.nativeTrips?.library.drafts.isEmpty == true)
        await session.stopAndWait()
        try FileManager.default.removeItem(at: directory)
    }
    @Test func visitAndActivityWritesRespectTheOffMainActorBoundary() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let probe = StoreThreadProbe()
        let store = try await LocalStore.open(
            directory: directory, uid: "visits", beforeSave: { probe.record() })
        let url = try #require(Bundle.main.url(forResource: "catalog", withExtension: "json"))
        let catalog = try JSONDecoder().decode(CatalogSnapshot.self, from: Data(contentsOf: url))
        try await store.seedPremium()
        probe.reset()
        try await VisitRepository(store: store).markManual(park: catalog.parks[0], catalog: catalog)
        try await ProfileRepository(store: store).recordDailyActivity()
        #expect(!probe.usedMainThread)
        #expect(try await store.readSnapshot().pending.count == 2)
        await store.close()
    }
    @Test(arguments: [393, 5000]) func realDraftEditsStayOffMainThreadAndDoNotCreateCloudIntents(_ count: Int)
        async throws
    {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let probe = StoreThreadProbe()
        let store = try await LocalStore.open(
            directory: directory, uid: "scale", beforeSave: { probe.record() })
        let history: [UserValue] = (0..<count).map {
            .object([
                "id": .string("old-\($0)"), "name": .string("History \($0)"),
                "ts": .number(1_700_000_000_000),
            ])
        }
        try await store.applyServerSnapshot(
            .init(uid: "scale", profile: .init(fields: ["visitedPlaces": .array(history)])),
            sequence: store.beginRead())
        try await store.seedPremium()
        probe.reset()
        let coordinate = try #require(Coordinate(latitude: 44, longitude: -68))
        var draft = LegacyTripDraft(
            trip: Trip(
                days: (0..<50).map {
                    Trip.Day(id: "day-\($0)", stops: [.init(name: "Custom \($0)", coordinate: coordinate)])
                }))
        var timings: [Double] = []
        for index in 0..<30 {
            draft.trip.days[index % 50].notes = "Durable edit \(index) " + String(repeating: "x", count: 600)
            draft.trip.days.swapAt(0, 1)
            let started = ContinuousClock.now
            try await TripRepository(store: store).saveDraft(draft)
            let elapsed = started.duration(to: .now).components
            timings.append(Double(elapsed.seconds) * 1000 + Double(elapsed.attoseconds) / 1e15)
        }
        let saved = try await store.readSnapshot()
        #expect(saved.drafts?.first == draft && saved.pending.isEmpty && saved.visible.visitCount == count)
        #expect(!probe.usedMainThread)
        let payload = try PersonalPayload.encode(saved).count
        print(
            "PHASE4 drafts records=\(count) edits=30 medianMs=\(timings.sorted()[15]) maxMs=\(timings.max() ?? 0) payloadBytes=\(payload) mainThreadSaves=\(probe.usedMainThread) cloudIntents=\(saved.pending.count)"
        )
        await store.close()
        try FileManager.default.removeItem(at: directory)
    }
}
