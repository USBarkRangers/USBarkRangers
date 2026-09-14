import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

/// Server-confirmed SDK queries, not a mock of Firestore's limit/window semantics.
@MainActor struct NativeTripLibraryEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"),
          arguments: [0, 1, 10, 11, 20, 200, 5_000])
    func pagesAndActiveTripStayBounded(_ count: Int) async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let scope = UUID()
        let assembly = AccountAssembly.emulator(directory: folder, scope: scope)
        let session = assembly.session
        let auth = try #require(session.auth)
        try await auth.email("pages-\(scope.uuidString)@example.test", password: "BarkTest123!", create: true)
        let cloud = try #require(session.cloud as? CloudUserClient)
        let options = try #require(FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)"))
        let uid = try #require(Auth.auth(app: options).currentUser?.uid)
        let db = Firestore.firestore(app: options)
        let path = "users/\(uid)"
        var writes = [Self.update(path, [
            "displayName": ["stringValue": "Paging test"],
            "entitlement": ["mapValue": ["fields": ["premium": ["booleanValue": true], "status": ["stringValue": "active"]]]],
        ])]
        for index in 0..<count { writes.append(Self.update(path + "/savedRoutes/" + Self.id(index), Self.fields(index))) }
        for start in stride(from: 0, to: writes.count, by: 400) {
            try await Self.commit(Array(writes[start..<min(start + 400, writes.count)]))
        }
        if count > 10 {
            // Simulate an already downloaded, older active itinerary on the phone before startup.
            let store = try await LocalStore.open(directory: folder, uid: uid)
            var snapshot = PersonalSnapshot(uid: uid)
            snapshot.trips = [Self.record(0)]
            try await store.applyServerSnapshot(snapshot, sequence: store.beginRead())
            _ = try await store.openTripDraft(id: Self.id(0))
            await store.close()
        }
        let started = ContinuousClock.now
        let expected = max(1, min(10, count)) + 2 + (count > 10 ? 1 : 0)
        session.setForeground(true)
        session.connectivityChanged(true)
        try await eventually(timeout: .seconds(30)) {
            guard session.state?.tripLibrary != nil,
                session.state?.baseline.trips.count == min(10, count) + (count > 10 ? 1 : 0) else { return false }
            return await cloud.documentReads == expected
        }
        await session.waitForSync()
        let firstReads = await cloud.documentReads
        let firstTrips = try #require(session.state?.baseline.trips)
        let initialBytes = try JSONEncoder().encode(firstTrips).count
        #expect(firstReads == expected)
        #expect(await cloud.tripListenerCount() == (count > 10 ? 2 : 1))
        #expect(session.hasMoreTrips == (count >= 10))
        let activeID = session.state?.selectedTripID
        for _ in 0..<4 { await session.waitForSync() }
        #expect(await cloud.documentReads == firstReads)
        if count >= 10 {
            session.loadMoreTrips()
            session.loadMoreTrips()
            try await eventually { !session.isLoadingMoreTrips }
            #expect(session.tripLibraryMessage == nil)
            let fetched = min(10, count - 10)
            try await eventually { session.state?.baseline.trips.count == min(20, count) + (count > 20 ? 1 : 0) }
            #expect(await cloud.documentReads == firstReads + max(1, fetched))
            #expect(session.state?.baseline.trips.count == min(20, count) + (count > 20 ? 1 : 0))
            #expect(session.state?.selectedTripID == activeID)
            #expect(session.hasMoreTrips == (count >= 20))
        }
        if count == 20 {
            session.loadMoreTrips()
            try await eventually { !session.isLoadingMoreTrips && !session.hasMoreTrips }
            #expect(!session.hasMoreTrips)
            #expect(session.state?.baseline.trips.count == 20)
        }
        if count == 200 {
            try await windowAndActiveChanges(session, cloud: cloud, path: path)
            // A head insertion/deletion restarts the cursor; a stable completed scan must still reach every ID.
            for _ in 0..<25 where session.hasMoreTrips {
                session.loadMoreTrips()
                try await eventually { !session.isLoadingMoreTrips }
                #expect(session.tripLibraryMessage == nil)
            }
            #expect(!session.hasMoreTrips)
            #expect(Set(session.state?.baseline.trips.map(\.id) ?? []) == Set((0..<count).map(Self.id)))
            // An uncached server query while offline must relinquish its listener promptly on cancel.
            try await db.disableNetwork()
            let pending = Task { try await CloudTripQuery.page(db.collection(path + "/savedRoutes").limit(to: 10)) }
            try await Task.sleep(for: .milliseconds(50))
            let cancelStarted = ContinuousClock.now
            pending.cancel()
            await #expect(throws: CancellationError.self) { _ = try await pending.value }
            #expect(cancelStarted.duration(to: .now) < .seconds(1))
            try await db.enableNetwork()
        }
        print("TRIP PAGING records=\(count) initialReads=\(firstReads) initialTripBodies=\(firstTrips.count) initialJSONBytes=\(initialBytes) elapsed=\(started.duration(to: .now))")
        let retained = session.state?.baseline.trips
        await session.stopAndWait()
        #expect(await cloud.tripListenerCount() == 0)
        let reopened = try await LocalStore.open(directory: folder, uid: uid)
        #expect(try await reopened.readSnapshot().baseline.trips == retained)
        await reopened.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in options.delete { _ in continuation.resume() } }
        try FileManager.default.removeItem(at: folder)
    }

    private func windowAndActiveChanges(_ session: AccountSession, cloud: CloudUserClient, path: String) async throws {
        let repository = try #require(session.trips)
        _ = try await repository.openDraft(id: Self.id(199))
        try await eventually { await cloud.tripListenerCount() == 1 }
        let before = await cloud.documentReads
        try await Self.commit([Self.update(path + "/savedRoutes/" + Self.id(0),
            ["tripName": ["stringValue": "Archive changed elsewhere"]], mask: ["tripName"])])
        try await Task.sleep(for: .milliseconds(200))
        #expect(await cloud.documentReads == before) // Inactive archive is intentionally not subscribed.
        _ = try await repository.openDraft(id: Self.id(0))
        try await eventually {
            session.state?.baseline.trips.first { $0.id == Self.id(0) }?.fields["tripName"] == .string("Archive changed elsewhere")
        }
        #expect(await cloud.documentReads == before + 1)
        try await Self.commit([Self.update(path + "/savedRoutes/" + Self.id(200), Self.fields(200))])
        try await eventually { session.state?.tripLibrary?.recentIDs.first == Self.id(200) }
        #expect(session.state?.baseline.trips.contains { $0.id == Self.id(190) } == true)
        // Leaving the query window did not delete trip 190. Actual deletion is separately verified.
        try await Self.commit([["delete": Self.document(path + "/savedRoutes/" + Self.id(200))]])
        try await eventually { session.state?.baseline.trips.contains { $0.id == Self.id(200) } == false }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"),
          arguments: [false, true])
    func unsupportedOrderedDatesCannotEraseDownloadedHistory(malformed: Bool) async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let scope = UUID()
        let session = AccountAssembly.emulator(directory: folder, scope: scope).session
        let auth = try #require(session.auth)
        try await auth.email("dates-\(scope.uuidString)@example.test", password: "BarkTest123!", create: true)
        let app = try #require(FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)"))
        let uid = try #require(Auth.auth(app: app).currentUser?.uid)
        var fields = Self.fields(0)
        fields["createdAt"] = malformed ? ["stringValue": "invalid timestamp"] : nil
        try await Self.commit([
            Self.update("users/\(uid)", ["displayName": ["stringValue": "Date compatibility"]]),
            Self.update("users/\(uid)/savedRoutes/" + Self.id(0), fields)
        ])
        let store = try await LocalStore.open(directory: folder, uid: uid)
        var snapshot = PersonalSnapshot(uid: uid)
        snapshot.trips = [Self.record(0)]
        try await store.applyServerSnapshot(snapshot, sequence: store.beginRead())
        try await store.clearActiveTrip(expectedID: Self.id(0))
        await store.close()
        session.setForeground(true)
        session.connectivityChanged(true)
        try await eventually {
            malformed ? session.message != nil : session.state?.tripLibrary != nil
        }
        #expect(session.state?.baseline.trips == snapshot.trips)
        if malformed { #expect(session.state?.tripLibrary == nil) }
        // Missing ordered fields are excluded by Firestore: the production coverage gate is essential.
        else { #expect(session.state?.tripLibrary?.recentIDs.isEmpty == true) }
        await session.stopAndWait()
        try await Firestore.firestore(app: app).terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        try FileManager.default.removeItem(at: folder)
    }
    private static func id(_ index: Int) -> String { String(format: "trip-%05d", index) }
    private static func record(_ index: Int) -> SavedRecord {
        SavedRecord(id: id(index), fields: Trip(id: id(index), name: "Trip \(index)").content.object ?? [:])
    }
    private static func fields(_ index: Int) -> [String: Any] {
        ["tripName": ["stringValue": "Trip \(index)"],
         // Deliberately tied timestamps prove the document-ID tie breaker is stable.
         "createdAt": ["timestampValue": "2026-09-01T00:00:00Z"],
         "tripDays": ["arrayValue": ["values": [["mapValue": ["fields": [
            "nativeDayID": ["stringValue": "day"], "color": ["stringValue": "#9955ff"],
            "notes": ["stringValue": "Keep this note"], "stops": ["arrayValue": ["values": []]]]]]]]],
         "unknown": ["stringValue": "Preserve this too"]]
    }
    private static func document(_ path: String) -> String { "projects/demo-barkranger-ios/databases/(default)/documents/" + path }
    private static func update(_ path: String, _ fields: [String: Any], mask: [String]? = nil) -> [String: Any] {
        var value: [String: Any] = ["update": ["name": document(path), "fields": fields]]
        if let mask { value["updateMask"] = ["fieldPaths": mask] }
        return value
    }
    private static func commit(_ writes: [[String: Any]]) async throws {
        let url = try #require(URL(string: "http://127.0.0.1:8088/v1/projects/demo-barkranger-ios/databases/(default)/documents:commit"))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["writes": writes])
        let (_, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
    }
}
