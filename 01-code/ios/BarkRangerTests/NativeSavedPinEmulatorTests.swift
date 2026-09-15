import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct NativeSavedPinEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func actualSavedPlaceModelFollowsAccountChangesAndRestoresOfflinePendingPins() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let scope = UUID()
        let assembly = AccountAssembly.nativeEmulator(directory: directory, scope: scope)
        let session = assembly.session
        let account = AccountModel(session: session)
        let pins = SavedPlacesModel(
            store: SavedPlaceStore(directory: directory.appendingPathComponent("pins")), account: session)
        let app = try #require(FirebaseApp.app(name: "BarkNativeUI-\(scope.uuidString)"))
        func finish() async throws {
            // A failed startup must stop the writer before the directory defer.
            // CI previously unlinked these SQLite files while they were in use.
            await session.stopAndWait()
            await pins.waitForPending()
            try await Firestore.firestore(app: app).terminate()
            await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        }
        do {
            let email = "\(UUID().uuidString)@native.invalid"
            let password = "NativeOnly123!"
            pins.viewport(
                MKCoordinateRegion(
                    center: .init(latitude: 41, longitude: -81),
                    span: .init(latitudeDelta: 10, longitudeDelta: 10)), including: [])
            session.setForeground(true)
            session.connectivityChanged(true)
            account.email(email, password: password, create: true)
            await account.action?.value
            try await eventually {
                session.nativeSavedPins != nil && session.profileState?.confirmed != nil && pins.isReady
            }
            let originalUID = try #require(session.identity?.uid)
            #expect(!pins.canEdit)
            try await NativeEmulatorFixture.seedAccess(uid: originalUID, app: app)
            session.requestSync(refresh: true)
            try await eventually { pins.canEdit }
            session.connectivityChanged(false)
            await session.nativeSavedPins?.sync?.wait()
            let place = try #require(
                SavedPlace(
                    stop: .init(
                        id: "offline-stop", placeIdentity: .custom("offline-pin"),
                        name: "Offline pin", coordinate: Coordinate(latitude: 41, longitude: -81)),
                    subtitle: "Ohio"))
            pins.select(place.stop)
            await pins.waitForPending()
            pins.save(place)
            await pins.waitForPending()
            try await eventually { pins.places[place.id]?.isPending == true && pins.selected?.id == place.id }
            #expect(pins.selectedPending)
            account.signOut()
            await account.action?.value
            try await eventually { session.identity == nil && pins.places.isEmpty && pins.selected == nil }
            session.connectivityChanged(true)
            account.email("\(UUID().uuidString)@native.invalid", password: password, create: true)
            await account.action?.value
            try await eventually {
                session.identity?.uid != nil && session.identity?.uid != originalUID
                    && session.nativeSavedPins != nil && pins.isReady
            }
            #expect(pins.places.isEmpty)
            account.signOut()
            await account.action?.value
            session.connectivityChanged(false)
            account.email(email, password: password, create: false)
            await account.action?.value
            try await eventually {
                session.identity?.uid == originalUID && pins.places[place.id]?.isPending == true
            }
            session.connectivityChanged(true)
            session.requestSync()
            try await eventually(timeout: .seconds(15)) { pins.places[place.id]?.isPending == false }
            try await NativeEmulatorFixture.seedAccess(
                uid: originalUID, app: app, premium: false, revision: 3)
            session.requestSync(refresh: true)
            try await eventually { !pins.canEdit }
            pins.select(place.stop)
            await pins.waitForPending()
            #expect(pins.selected?.id == place.id)
            pins.remove(place) { Issue.record("Read-only removal must not complete") }
            pins.save(place)
            await pins.waitForPending()
            #expect(pins.selected?.id == place.id)
            #expect(pins.message == AccountDataAccess.readOnlyMessage)
            #expect(try await session.nativeSavedPins?.store.pendingChanges().isEmpty == true)
        } catch {
            do { try await finish() } catch { Issue.record(error) }
            throw error
        }
        try await finish()
    }
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func premiumAccountUsesTheMailroomAndAnotherDeviceGetsOnlyMetadataWithoutMapReads() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let user = try await auth.createUser(
            withEmail: "\(UUID().uuidString)@native.invalid", password: UUID().uuidString
        ).user
        let profile = try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: user.uid)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: user.uid)
        let bootstrap = NativeProfileSync(store: store, cloud: profile)
        #expect(try await bootstrap.synchronize() == .current)
        try await NativeEmulatorFixture.seedAccess(uid: user.uid, app: app)
        #expect(try await bootstrap.synchronize() == .current)
        let transport = try NativeCallableTransport(uid: user.uid, auth: auth)
        let cloud = NativeSavedPinCloud(transport: transport)
        let feature = NativeSavedPinFeature(store: store, cloud: cloud)
        try await feature.start()
        feature.sync?.setAllowed(true)
        await feature.sync?.wait()
        _ = await transport.recordedCallKinds(reset: true)
        let place = try #require(
            SavedPlace(
                stop: .init(
                    id: "stop-a", placeIdentity: .custom("native-pin"),
                    name: "Private pin", coordinate: Coordinate(latitude: 41, longitude: -81)),
                subtitle: "Ohio"))
        try await store.saveSavedPin(place)
        #expect(try await store.savedPinValue(place.id).pending)
        feature.sync?.request()
        await feature.sync?.wait()
        #expect(try await store.pendingChanges().isEmpty)
        #expect(try await store.savedPinValue(place.id).place?.id == place.id)
        #expect(try await !store.savedPinValue(place.id).pending)
        #expect(await transport.recordedCallKinds(reset: true) == ["setSavedPin"])
        let device2 = try await NativeStore.open(
            directory: directory.appendingPathComponent("device2"), project: "demo-bark-native", uid: user.uid
        )
        let query = try await device2.savedPinChangesQuery()
        try await device2.acceptSavedPinChanges(cloud.changes(query), requested: query)
        #expect(try await device2.savedPinValue(place.id).place?.id == place.id)
        _ = await transport.recordedCallKinds(reset: true)
        let region = SavedPlaceIndex.Region(
            latitude: 0, longitude: 0, latitudeDelta: 180, longitudeDelta: 360)
        for _ in 0..<100 {
            #expect(try await device2.savedPins(in: region, including: []).count == 1)
            #expect(try await device2.savedPinValue(place.id).place != nil)
        }
        #expect(await transport.recordedCallKinds(reset: true).isEmpty)
        print("NATIVE_PIN_CALLS save=[setSavedPin]; anotherDevice=[savedPinChanges]; browse100=[]")
        feature.sync?.setAllowed(false)
        await feature.sync?.wait()
        try await store.saveSavedPin(place, saved: false)
        #expect(try await store.savedPinValue(place.id).place == nil)
        #expect(try await store.pendingChanges().count == 1)
        feature.sync?.setAllowed(true)
        await feature.sync?.wait()
        let next = try await device2.savedPinChangesQuery()
        try await device2.acceptSavedPinChanges(cloud.changes(next), requested: next)
        #expect(try await device2.savedPinValue(place.id).place == nil)
        try auth.signOut()
        await #expect(throws: NativeCallableTransport.Failure.accountChanged) {
            try await cloud.changes(.init())
        }
        await feature.close()
        await bootstrap.stop()
        await store.close()
        await device2.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }
}
