import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeTripEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func actualSDKRoundTripReplaysReadsPagesAndClearsOnlyAcknowledgedDraft() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let user = try await auth.createUser(
            withEmail: "\(UUID().uuidString)@native.invalid", password: UUID().uuidString
        ).user
        let profile = try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: user.uid)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: user.uid)
        let profileSync = NativeProfileSync(store: store, cloud: profile)
        #expect(try await profileSync.synchronize() == .current)
        try await NativeEmulatorFixture.seedAccess(uid: user.uid, app: app)
        #expect(try await profileSync.synchronize() == .current)
        let transport = try NativeCallableTransport(uid: user.uid, auth: auth)
        let cloud = NativeTripCloud(transport: transport)
        let trip = Trip(
            name: "Native trip",
            days: [
                .init(stops: [
                    .init(
                        id: "stop-one", placeIdentity: .provider(name: "apple", id: "native-trip-fixture"),
                        name: "Saved place", coordinate: Coordinate(latitude: 41.25, longitude: -81.75),
                        state: "Ohio",
                        notes: "Private note 🐕 — café")
                ])
            ])
        let draft = TripDraft(trip: trip, nativeBase: .init())
        _ = try await store.checkpointNativeDraft(draft, replacing: nil)
        let id = try #require(try await store.stageTripSave(draft))
        let command = try #require(try await store.nextTripSubmission(id: trip.id))
        let outcome = try await cloud.submit(command)
        #expect(outcome.operationID == id && outcome.status == .accepted)
        #expect(try await cloud.submit(command) == outcome)
        let snapshot = try await cloud.trip(trip.id)
        let reconstructed = try #require(try await store.confirmedTripSnapshot(outcome))
        #expect(reconstructed.metadata == snapshot.metadata && reconstructed.content == snapshot.content)
        #expect(reconstructed.notes == snapshot.notes)
        #expect(reconstructed.readTime == snapshot.metadata?.updatedAt)
        let recovery = try await cloud.recovery(for: trip)
        #expect(recovery.metadata == snapshot.metadata && recovery.notes == snapshot.notes)
        #expect(snapshot.content?.days[0].stops[0].noteID == snapshot.notes.first?.id)
        #expect(snapshot.notes.first?.text == trip.days[0].stops[0].notes)
        try await store.acceptTripOutcome(outcome, snapshot: snapshot)
        #expect(try await store.cachedTrip(id: trip.id)?.trip == trip)
        #expect(try await store.tripQueueState(trip.id).count == 0)
        let page = try await cloud.library()
        #expect(page.items.map(\.id) == [trip.id] && page.next == nil)
        try await store.acceptTripLibraryPage(page)
        let query = try await store.tripChangesQuery()
        let changes = try await cloud.changes(query)
        #expect(changes.items.map(\.id) == [trip.id])
        #expect(try await store.acceptTripChanges(changes, requested: query))
        let sync = NativeTripSync(store: store, cloud: cloud)
        _ = await transport.recordedCallKinds(reset: true)
        #expect(try await sync.synchronize(trip.id) == .current)
        #expect(await transport.recordedCallKinds(reset: true).isEmpty)
        var edited = try #require(try await store.currentNativeDraft(id: trip.id))
        let preimage = edited
        edited.trip.days[0].stops[0].notes = "Only the note changed"
        _ = try await store.checkpointNativeDraft(edited, replacing: preimage)
        _ = try await store.stageTripSave(edited)
        #expect(try await sync.synchronize(trip.id) == .current)
        let measured = await transport.recordedCallKinds(reset: true)
        #expect(measured == ["saveTripNotes"])
        print("NATIVE_SAVE_CALLS=\(measured)")
        #expect(try await store.cachedTrip(id: trip.id)?.trip == edited.trip)
        #expect(try await store.currentNativeDraft(id: trip.id)?.nativeBase?.contentRevision == 1)
        #expect(
            try await store.currentNativeDraft(id: trip.id)?.nativeBase?.notes.values.first?.revision == 2)
        try auth.signOut()
        await #expect(throws: NativeCallableTransport.Failure.accountChanged) {
            try await cloud.trip(trip.id)
        }
        await sync.stop()
        await profileSync.stop()
        await store.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }

}
