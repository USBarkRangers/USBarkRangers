import BarkDomain
import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

/// Explicitly opted-in live acceptance, never part of ordinary/emulator test runs.
/// Credentials come from a private, short-lived QA fixture, not the owner's account.
@MainActor struct NativeCloudAcceptanceTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_CLOUD_ACCEPTANCE"] == "1"))
    func nativeSDKPersistsTripAndNotesAcrossStoreReopenAndPausedDelivery() async throws {
        let environment = ProcessInfo.processInfo.environment
        let email = try #require(environment["BARK_CLOUD_TEST_EMAIL"])
        let password = try #require(environment["BARK_CLOUD_TEST_PASSWORD"])
        let expectedUID = try #require(environment["BARK_CLOUD_TEST_UID"])
        #expect(email.hasPrefix("cloud-acceptance-") && email.hasSuffix("@native.invalid"))
        guard email.hasPrefix("cloud-acceptance-"), email.hasSuffix("@native.invalid") else { return }
        let directory = URL.temporaryDirectory.appendingPathComponent("NativeCloud-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let assembly = AccountAssembly.live(directory: directory)
        #expect(assembly.session.auth?.isTest == false)
        let app = try #require(FirebaseApp.app(name: "BarkNative"))
        #expect(app.options.projectID == "bark-ranger-ios")
        let auth = Auth.auth(app: app)
        defer { try? auth.signOut() }
        let db = Firestore.firestore(app: app)
        let user = try await auth.signIn(withEmail: email, password: password).user
        #expect(user.uid == expectedUID)
        guard user.uid == expectedUID else { return }
        let profile = try NativeProfileCloud(uid: user.uid, auth: auth, db: db)
        let store = try await NativeStore.open(
            directory: directory, project: "bark-ranger-ios", uid: user.uid)
        let profileSync = NativeProfileSync(store: store, cloud: profile)
        #expect(try await profileSync.synchronize() == .current)
        #expect(try await store.readEntitlement()?.source == .development)
        let transport = try NativeCallableTransport(uid: user.uid, auth: auth)
        let cloud = NativeTripCloud(transport: transport)
        let trip = Trip(
            name: "iOS SDK cloud acceptance",
            days: [
                .init(stops: [
                    .init(
                        id: "native-cloud-stop", placeIdentity: .custom(UUID().uuidString),
                        name: "Cloud acceptance pin", coordinate: .init(latitude: 41, longitude: -81),
                        state: "Ohio", notes: "First cloud note 🐕")
                ])
            ])
        let draft = TripDraft(trip: trip, nativeBase: .init())
        _ = try await store.checkpointNativeDraft(draft, replacing: nil)
        _ = try await store.stageTripSave(draft)
        let sync = NativeTripSync(store: store, cloud: cloud)
        #expect(try await sync.synchronize(trip.id) == .current)
        #expect(try await cloud.trip(trip.id).notes.first?.text == "First cloud note 🐕")
        #expect(try await cloud.library().items.contains { $0.id == trip.id })

        // The same production worker pause used by connectivity changes must preserve
        // durable work. This is controlled disconnection, not a claim of airplane-mode UI testing.
        await sync.pause()
        var changed = try #require(try await store.currentNativeDraft(id: trip.id))
        let previous = changed
        changed.trip.days[0].stops[0].notes = "Saved while delivery was paused"
        _ = try await store.checkpointNativeDraft(changed, replacing: previous)
        _ = try await store.stageTripSave(changed)
        #expect(try await store.tripQueueState(trip.id).count == 1)
        #expect(try await cloud.trip(trip.id).notes.first?.text == "First cloud note 🐕")
        await sync.stop()
        await profileSync.stop()
        await store.close()

        let reopened = try await NativeStore.open(
            directory: directory, project: "bark-ranger-ios", uid: user.uid)
        #expect(
            try await reopened.currentNativeDraft(id: trip.id)?.trip.days[0].stops[0].notes
                == changed.trip.days[0].stops[0].notes)
        #expect(try await reopened.tripQueueState(trip.id).count == 1)
        let reconnectedTransport = try NativeCallableTransport(uid: user.uid, auth: auth)
        let reconnected = NativeTripCloud(transport: reconnectedTransport)
        let resumed = NativeTripSync(store: reopened, cloud: reconnected)
        #expect(try await resumed.synchronize(trip.id) == .current)
        #expect(try await reopened.tripQueueState(trip.id).count == 0)
        let result = try await reconnected.trip(trip.id)
        #expect(result.notes.first?.text == "Saved while delivery was paused")
        #expect(result.metadata?.contentRevision == 1)
        #expect(result.notes.first?.revision == 2)
        print(
            "NATIVE_CLOUD_SDK_ACCEPTED trip=\(trip.id); source=development; reopened_pending_note_delivered=true"
        )
        await resumed.stop()
        await reopened.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }
}
