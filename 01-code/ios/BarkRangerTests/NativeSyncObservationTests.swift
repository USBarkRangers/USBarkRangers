import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

/// Real Firebase listeners against an explicitly local demo project. Unique accounts isolate each case.
@MainActor struct NativeSyncObservationTests {
    @Test(
        .enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"),
        arguments: [393, 5_000])
    func changedDocumentsStayBoundedAndReconnectPreservesData(_ visits: Int) async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let scope = UUID()
        let assembly = AccountAssembly.emulator(directory: folder, scope: scope)
        let session = assembly.session
        let auth = try #require(session.auth)
        try await auth.email("sync-\(scope.uuidString)@example.test", password: "BarkTest123!", create: true)
        let app = try #require(FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)"))
        let uid = try #require(Auth.auth(app: app).currentUser?.uid)
        let userPath = "users/\(uid)"
        let premium: [String: Any] = [
            "mapValue": [
                "fields": [
                    "premium": ["booleanValue": true], "status": ["stringValue": "active"],
                ]
            ]
        ]
        let placeValues = (0..<visits).map { index in
            [
                "mapValue": [
                    "fields": [
                        "id": ["stringValue": "retained-\(index)"],
                        "name": ["stringValue": "Retained park \(index)"],
                    ]
                ]
            ]
        }
        var writes = [
            Self.update(
                userPath,
                [
                    "displayName": ["stringValue": "Original"], "entitlement": premium,
                    "visitedPlaces": ["arrayValue": ["values": placeValues]],
                    "unknownField": ["stringValue": "Preserve"],
                ])
        ]
        for index in 0..<10 {
            writes.append(
                Self.update(
                    userPath + "/savedRoutes/trip-\(index)",
                    [
                        "tripName": ["stringValue": "Trip \(index)"],
                        "createdAt": ["timestampValue": "2026-09-01T00:00:00Z"],
                        "tripDays": [
                            "arrayValue": [
                                "values": [
                                    [
                                        "mapValue": [
                                            "fields": [
                                                "color": ["stringValue": "#CC55FF"],
                                                "notes": ["stringValue": "Preserved note"],
                                                "stops": ["arrayValue": ["values": []]],
                                            ]
                                        ]
                                    ]
                                ]
                            ]
                        ],
                    ]))
        }
        for index in 0..<65 {
            writes.append(
                Self.update(
                    userPath + "/achievements/history-\(index)",
                    [
                        "tier": ["stringValue": "honor"], "unknown": ["stringValue": "Original history"],
                    ]))
        }
        try await Self.commit(writes)
        session.setForeground(true)
        session.connectivityChanged(true)
        try await eventually(timeout: .seconds(20)) { session.state?.baseline.confirmedAt != nil }
        let cloud = try #require(session.cloud as? CloudUserClient)
        await session.waitForSync()
        #expect(await cloud.documentReads == 76)
        #expect(session.state?.baseline.visitCount == visits)
        for _ in 0..<12 {
            session.setForeground(true)
            session.connectivityChanged(true)
            await session.waitForSync()
        }
        #expect(await cloud.documentReads == 76)
        try await Self.commit([
            Self.update(userPath, ["displayName": ["stringValue": "Other device"]], mask: ["displayName"])
        ])
        try await eventually { session.state?.baseline.profile.displayName == "Other device" }
        #expect(await cloud.documentReads == 77)
        try await Self.commit([
            Self.update(
                userPath + "/savedRoutes/trip-0", ["tripName": ["stringValue": "Remote trip"]],
                mask: ["tripName"])
        ])
        try await eventually {
            session.state?.baseline.trips.first { $0.id == "trip-0" }?.fields["tripName"]
                == .string("Remote trip")
        }
        #expect(await cloud.documentReads == 78)
        try await Self.commit([["delete": Self.document(userPath + "/savedRoutes/trip-9")]])
        try await eventually { session.state?.baseline.trips.count == 9 }
        #expect(session.state?.baseline.achievements.count == 65)
        #expect(session.state?.baseline.profile.fields["unknownField"] == .string("Preserve"))
        let beforeAward = await cloud.documentReads
        try await Self.commit([
            Self.update(
                userPath + "/achievements/history-0", ["tier": ["stringValue": "verified"]], mask: ["tier"])
        ])
        try await eventually {
            session.state?.baseline.achievements.first { $0.id == "history-0" }?.fields["tier"]
                == .string("verified")
        }
        #expect(await cloud.documentReads == beforeAward + 1)

        let record = try #require(session.state?.baseline.trips.first { $0.id == "trip-0" })
        var trip = try Trip(record: record)
        trip.name = "Native edited trip"
        let repository = try #require(session.trips)
        let draft = LegacyTripDraft(trip: trip, expected: record.tripContent)
        try await repository.saveDraft(draft)
        let beforeSave = await cloud.documentReads
        try await repository.save(id: draft.id)
        await session.waitForSync()
        try await eventually(timeout: .seconds(20)) { session.state?.pending.isEmpty == true }
        #expect(
            session.state?.baseline.trips.first { $0.id == draft.id }?.fields["tripName"]
                == .string("Native edited trip"))
        let saveReads = await cloud.documentReads - beforeSave
        #expect(saveReads >= 1 && saveReads <= 3)

        try await Self.commit([
            Self.update(
                userPath,
                [
                    "entitlement": [
                        "mapValue": [
                            "fields": [
                                "premium": ["booleanValue": false], "status": ["stringValue": "expired"],
                            ]
                        ]
                    ]
                ], mask: ["entitlement"])
        ])
        try await eventually { !session.dataAccess.canEditAccount }
        #expect(session.state?.baseline.trips.count == 9 && session.state?.baseline.visitCount == visits)
        await #expect(throws: LocalStore.Failure.unavailableAccess) {
            try await repository.save(id: draft.id)
        }
        try await Self.commit([Self.update(userPath, ["entitlement": premium], mask: ["entitlement"])])
        try await eventually { session.dataAccess.canEditAccount }
        session.setForeground(false)
        await session.waitForSync()
        try await Self.commit([
            Self.update(userPath, ["displayName": ["stringValue": "While away"]], mask: ["displayName"])
        ])
        session.setForeground(true)
        await session.waitForSync()
        try await eventually(timeout: .seconds(20)) {
            session.state?.baseline.profile.displayName == "While away"
        }
        #expect(
            session.state?.baseline.visitCount == visits && session.state?.baseline.achievements.count == 65)
        print(
            "LIVE SYNC visits=\(visits) initialReads=76 idleRefreshReads=0 userChangeReads=1 tripChangeReads=1 awardChangeReads=1 saveReads=\(saveReads)"
        )
        await session.stopAndWait()
        try await Firestore.firestore(app: app).terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        try FileManager.default.removeItem(at: folder)
    }

    private static func document(_ path: String) -> String {
        "projects/demo-barkranger-ios/databases/(default)/documents/" + path
    }
    private static func update(_ path: String, _ fields: [String: Any], mask: [String]? = nil) -> [String:
        Any]
    {
        var value: [String: Any] = ["update": ["name": document(path), "fields": fields]]
        if let mask { value["updateMask"] = ["fieldPaths": mask] }
        return value
    }
    private static func commit(_ writes: [[String: Any]]) async throws {
        let url = try #require(
            URL(
                string:
                    "http://127.0.0.1:8088/v1/projects/demo-barkranger-ios/databases/(default)/documents:commit"
            ))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer owner", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["writes": writes])
        let (_, response) = try await URLSession.shared.data(for: request)
        #expect((response as? HTTPURLResponse)?.statusCode == 200)
    }
}
