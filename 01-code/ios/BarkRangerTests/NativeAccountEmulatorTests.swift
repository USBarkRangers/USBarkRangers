import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

/// Explicit opt-in: ordinary unit/UI tests never initialize Firebase or need running emulators.
@MainActor struct NativeAccountEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"))
    func nativeVisitTripAndLeaderboardUseTheRealSDKAndBoundedReads() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let scope = UUID()
        let assembly = AccountAssembly.emulator(directory: folder, scope: scope)
        let session = assembly.session
        let app = try #require(FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)"))
        let db = Firestore.firestore(app: app)
        session.setForeground(true)
        session.connectivityChanged(true)
        let auth = try #require(session.auth)
        try await auth.email("ranger-adventure@example.test", password: "BarkTest123!", create: false)
        try await eventually(timeout: .seconds(20)) {
            session.state?.baseline.confirmedAt != nil && session.identity?.uid == "native-test-adventure"
        }
        let catalogURL = try #require(Bundle.main.url(forResource: "catalog", withExtension: "json"))
        let catalog = try JSONDecoder().decode(CatalogSnapshot.self, from: Data(contentsOf: catalogURL))
        let park = catalog.parks[10]
        let visits = try #require(session.visits)
        let trips = try #require(session.trips)
        print("PHASE4 SDK signed in")
        try await visits.markManual(park: park, catalog: catalog)
        try await eventually(timeout: .seconds(20)) {
            session.state?.baseline.profile.fields["visitedPlaces"]?.array?.contains {
                $0.object?["id"]?.string == park.id.rawValue
            } == true
        }
        print("PHASE4 SDK visit confirmed")
        let draft = LegacyTripDraft(
            trip: Trip(
                name: "SDK itinerary",
                days: [Trip.Day(stops: [Trip.Stop(park: park)], notes: "Persist via native callable")]))
        try await trips.saveDraft(draft)
        try await trips.save(id: draft.id)
        print("PHASE4 SDK trip staged")
        try await eventually(timeout: .seconds(20)) {
            session.state?.baseline.trips.contains { $0.id == draft.id } == true
                && session.state?.pending.isEmpty == true
        }
        let cloud = try #require(session.cloud as? CloudUserClient)
        let target = TripDayID(tripID: draft.id, dayID: draft.trip.days[0].id)
        let stopID = draft.trip.days[0].stops[0].id
        var previousNote = ""
        for note in ["Water for dog 🐾", "Edited stop note e\u{301}", ""] {
            try await trips.editDay(target, edit: .stopNotes(id: stopID, expected: previousNote, value: note))
            try await trips.save(id: draft.id)
            try await eventually(timeout: .seconds(20)) {
                guard session.state?.pending.isEmpty == true,
                    let record = session.state?.baseline.trips.first(where: { $0.id == draft.id }),
                    let trip = try? Trip(record: record)
                else { return false }
                return trip.days[0].stops.first { $0.id == stopID }?.notes == note
            }
            let document = try await db.collection("users").document("native-test-adventure")
                .collection("savedRoutes").document(draft.id).getDocument(source: .server)
            let fields = try #require(CloudUserDecoder.value(document.data() ?? [:]).object)
            let record = SavedRecord(id: draft.id, fields: fields)
            #expect(
                try Trip(record: record).days[0].stops.first { $0.id == stopID }?.notes == note)
            previousNote = note
        }
        print("CORRECTNESS SDK stop-note add/edit/clear independently read back")
        await session.waitForSync()
        let before = await cloud.documentReads
        session.requestSync(refresh: true)
        await session.waitForSync()
        let fetched = try #require(session.state?.baseline)
        let count = await cloud.documentReads - before
        #expect(count == 1 + max(1, fetched.trips.count) + max(1, fetched.achievements.count))
        print(
            "PHASE4 SDK full-refresh documentReads=\(count) trips=\(fetched.trips.count) achievements=\(fetched.achievements.count)"
        )
        let board = try #require(assembly.leaderboard)
        let leaders = try await board.topFive()
        #expect(leaders.count <= 5)
        #expect(try await board.standing(uid: "native-test-adventure") != nil)
        try await session.visits?.remove([park.id.rawValue])
        try await session.trips?.delete(id: draft.id)
        await session.waitForSync()
        try await eventually(timeout: .seconds(20)) { session.state?.pending.isEmpty == true }
        await session.stopAndWait()
        if let app = FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)") {
            try await Firestore.firestore(app: app).terminate()
            await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        }
        try FileManager.default.removeItem(at: folder)
    }
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"))
    func newAccountVerificationResetLinkAndDeletionUseRealSDK() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let scope = UUID()
        let assembly = AccountAssembly.emulator(
            directory: folder, scope: scope,
            host: ProcessInfo.processInfo.environment["BARK_EMULATOR_HOST"] ?? "127.0.0.1")
        let session = assembly.session
        let auth = try #require(session.auth)
        let model = AccountModel(session: session)
        session.setForeground(true)
        session.connectivityChanged(true)
        let email = "native-lifecycle-\(scope.uuidString)@example.test"
        model.email(email, password: "BarkTest123!", create: true)
        await model.action?.value
        try await eventually(timeout: .seconds(20)) { session.state?.baseline.confirmedAt != nil }
        let uid = try #require(session.identity?.uid)
        #expect(session.identity?.verified == false)
        model.verifyEmail()
        await model.action?.value
        #expect(model.notice == "Verification link is in the local Auth emulator log.")
        model.resetPassword(email)
        await model.action?.value
        #expect(model.notice?.contains("password reset instructions") == true)
        model.saveName("New native ranger")
        await model.action?.value
        #expect(model.notice == AccountDataAccess.readOnlyMessage)
        #expect(session.state?.pending.isEmpty == true)
        // This unsigned credential is accepted only by the explicitly selected Auth emulator.
        let claims = try JSONSerialization.data(withJSONObject: ["sub": uid, "email": email])
        let payload = claims.base64EncodedString().replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        let credential = GoogleAuthProvider.credential(
            withIDToken: "eyJhbGciOiJub25lIn0.\(payload).", accessToken: "emulator-only")
        try await auth.credential(credential, use: .link, uid: uid)
        try await eventually(timeout: .seconds(20)) {
            session.identity?.providers.contains("google.com") == true
        }
        model.unlink("google.com")
        await model.action?.value
        try await eventually(timeout: .seconds(20)) { session.identity?.providers == ["password"] }
        await #expect(throws: AccountFailure.lastProvider) { try await auth.unlink("password", uid: uid) }
        model.reauthenticate(password: "BarkTest123!")
        await model.action?.value
        #expect(model.notice?.contains("Identity confirmed") == true)
        model.deleteAccount(confirmation: "DELETE")
        await model.action?.value
        try await eventually(timeout: .seconds(20)) { session.identity == nil && session.state == nil }
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: folder.path).filter { $0 != "GuestDrafts" }
                .isEmpty)
        await session.stopAndWait()
        if let app = FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)") {
            try await Firestore.firestore(app: app).terminate()
            await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        }
        try FileManager.default.removeItem(at: folder)
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"))
    func sdkSignInOfflineReopenSyncAndAccountIsolation() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let scope = UUID()
        let assembly = AccountAssembly.emulator(
            directory: folder, scope: scope,
            host: ProcessInfo.processInfo.environment["BARK_EMULATOR_HOST"] ?? "127.0.0.1")
        let auth = try #require(assembly.session.auth)
        let cloud = try #require(assembly.session.cloud)
        let first = assembly.session
        first.setForeground(true)
        first.connectivityChanged(true)
        try await auth.email("ranger-a@example.test", password: "BarkTest123!", create: false)
        try await eventually(timeout: .seconds(20)) { first.state?.baseline.confirmedAt != nil }
        #expect(first.identity?.uid == "native-test-a")
        #expect(first.entitlement.access?.premium == true)
        #expect(first.state?.baseline.trips.first?.id == "stored-route-id")
        #expect(first.state?.baseline.visitCount == 2)
        first.connectivityChanged(false)
        let name = "Native \(String(UUID().uuidString.prefix(8)))"
        try await first.profile?.editDisplayName(name)
        try await eventually(timeout: .seconds(20)) { first.state?.pending.count == 1 }
        let pending = try #require(first.state?.pending.first?.operation)
        await first.stopAndWait()
        let reopened = AccountSession(
            auth: auth, cloud: cloud, directory: folder, capabilities: .editableTest)
        reopened.setForeground(true)
        try await eventually(timeout: .seconds(20)) { reopened.state?.baseline.uid == "native-test-a" }
        #expect(reopened.state?.visible.profile.displayName == name)
        #expect(reopened.state?.pending.first?.operation.id == pending.id)
        reopened.connectivityChanged(true)
        try await eventually(timeout: .seconds(20)) { reopened.state?.pending.isEmpty == true }
        #expect(reopened.state?.visible.profile.displayName == name)
        try await auth.email("ranger-b@example.test", password: "BarkTest123!", create: false)
        try await eventually(timeout: .seconds(20)) { reopened.state?.baseline.uid == "native-test-b" }
        #expect(reopened.state?.visible.profile.displayName != name)
        #expect(reopened.entitlement.access?.premium == false)
        try await eventually(timeout: .seconds(20)) { reopened.state?.baseline.confirmedAt != nil }
        #expect(reopened.state?.baseline.trips.first?.id == "stored-route-id")
        #expect(reopened.state?.baseline.visitCount == 2)
        await #expect(throws: LocalStore.Failure.unavailableAccess) {
            try await reopened.profile?.editDisplayName("Forbidden")
        }
        await #expect(throws: (any Error).self) { _ = try await cloud.submit(pending) }
        await #expect(throws: (any Error).self) { try await auth.verifyEmail(uid: "native-test-a") }
        await #expect(throws: (any Error).self) { try await auth.unlink("password", uid: "native-test-a") }
        try auth.signOut()
        await reopened.stopAndWait()
        if let app = FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)") {
            try await Firestore.firestore(app: app).terminate()
            await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        }
        // Failed runs leave temporary files for OS cleanup rather than unlinking an open store.
        try FileManager.default.removeItem(at: folder)
    }
}
