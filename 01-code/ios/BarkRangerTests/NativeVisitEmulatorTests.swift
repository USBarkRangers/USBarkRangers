import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeVisitEmulatorTests {
    private struct StageFailure: Error, CustomStringConvertible {
        let stage: String
        let cause: any Error
        var description: String { "\(stage): \(cause)" }
    }
    private func stage<T>(_ name: String, _ work: () async throws -> T) async throws -> T {
        do { return try await work() } catch { throw StageFailure(stage: name, cause: error) }
    }
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func actualSDKVisitCommandsTypedReadsAndMarkerCacheAgree() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let user = try await auth.createUser(
            withEmail: "\(UUID().uuidString)@native.invalid", password: UUID().uuidString
        ).user
        let profile = try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: user.uid)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: user.uid)
        let sync = NativeProfileSync(store: store, cloud: profile)
        #expect(try await sync.synchronize() == .current)
        try await NativeEmulatorFixture.seedAccess(uid: user.uid, app: app)
        #expect(try await sync.synchronize() == .current)
        let transport = try NativeCallableTransport(uid: user.uid, auth: auth)
        let cloud = NativeVisitCloud(transport: transport)
        let parkID = "00275387-3771-4533-ae24-2cf3e053384c"
        let visitID = UUID().uuidString.lowercased()
        let at = Int64(Date().timeIntervalSince1970 * 1000)
        func intent(_ edit: NativeVisitIntent.Edit, revision: Int64 = 0) -> NativeVisitIntent {
            .init(
                target: .init(
                    visitID: visitID, officialPlaceID: parkID, siteID: parkID,
                    visitRevision: revision, placeRevision: revision), edit: edit)
        }
        func submission(_ intent: NativeVisitIntent) throws -> NativeStore.Submission {
            let id = UUID()
            let command = NativeVisitCommand(
                operationID: id, createdAtMs: Int64(Date().timeIntervalSince1970 * 1000), intent: intent)
            return .init(id: id, bytes: try JSONEncoder().encode(command), attempts: 0)
        }
        let empty = try await cloud.visit(id: visitID, officialPlaceID: parkID)
        try await store.acceptNativeVisit(empty)
        #expect(try await store.nativeProgress() == nil)
        let mark = try submission(
            intent(.mark(happenedAtMs: at, timeZone: "America/New_York", proximity: nil)))
        let accepted = try await cloud.submit(mark)
        #expect(accepted.status == .accepted && accepted.revisions.visit == 1)
        #expect(try await cloud.submit(mark) == accepted)
        let first = try await cloud.visit(id: visitID, officialPlaceID: parkID)
        try await stage("cache first visit") { try await store.acceptNativeVisit(first) }
        #expect(try await store.nativeVisit(id: visitID)?.details?.name == "Cedar Hill State Park")
        #expect(try await store.nativeVisit(id: visitID)?.details?.happenedAtMs == at)
        #expect(try await store.nativeProgress()?.points == 1)
        let originalQuery = try await store.markerChangesQuery()
        let initialMarkers = try await cloud.markers(originalQuery)
        #expect(try await store.acceptMarkerChanges(initialMarkers, requested: originalQuery))
        #expect(try await store.nativeMarkers().map(\.visitID) == [visitID])
        let initialPage = try await cloud.history()
        try await store.acceptNativeVisitHistory(initialPage, after: nil)
        let fix = LocationFix(
            coordinate: try #require(Coordinate(latitude: 32.6194734, longitude: -96.9837294)), accuracy: 20,
            date: Date())
        let upgrade = try submission(
            intent(
                .mark(
                    happenedAtMs: at, timeZone: "America/New_York",
                    proximity: .init(fix: fix)), revision: 1))
        #expect(try await cloud.submit(upgrade).revisions.visit == 2)
        let verified = try await cloud.visit(id: visitID, officialPlaceID: parkID)
        try await stage("cache verified visit") { try await store.acceptNativeVisit(verified) }
        #expect(try await store.nativeProgress()?.points == 2)
        #expect(try await store.nativeVisit(id: visitID)?.details?.verified == true)
        try await stage("late original visit") { try await store.acceptNativeVisit(first) }
        try await stage("late missing visit") { try await store.acceptNativeVisit(empty) }
        #expect(try await store.nativeVisit(id: visitID)?.revision == 2)
        #expect(try await store.nativeProgress()?.points == 2)
        let encoded = try JSONEncoder().encode(try #require(verified.visit))
        #expect(try JSONDecoder().decode(NativeVisitRecord.self, from: encoded) == verified.visit)
        let deletion = try submission(intent(.remove, revision: 2))
        #expect(try await cloud.submit(deletion).revisions.visit == 3)
        let query = try await store.markerChangesQuery()
        #expect(
            try await stage("deleted marker update") {
                try await store.acceptMarkerChanges(cloud.markers(query), requested: query)
            })
        #expect(try await store.nativeMarkers().isEmpty)
        #expect(try await store.nativeVisitHistory().isEmpty)
        try await stage("late history page") {
            try await store.acceptNativeVisitHistory(initialPage, after: nil)
        }
        #expect(try await store.nativeVisitHistory().isEmpty)  // Known remote deletion beats an older page.
        let deleted = try await cloud.visit(id: visitID, officialPlaceID: parkID)
        try await stage("cache deleted visit") { try await store.acceptNativeVisit(deleted) }
        #expect(try await store.nativeVisit(id: visitID)?.deleted == true)
        #expect(try await store.nativeProgress()?.points == 0)
        try await stage("refresh final progress") { try await store.acceptNativeProgress(cloud.progress()) }
        let finalQuery = try await store.markerChangesQuery()
        await store.close()
        let reopened = try await stage("reopen visit store") {
            try await NativeStore.open(
                directory: directory, project: "demo-bark-native", uid: user.uid)
        }
        #expect(try await reopened.markerChangesQuery() == finalQuery)
        #expect(try await reopened.nativeVisit(id: visitID)?.deleted == true)
        try auth.signOut()
        await #expect(throws: NativeCallableTransport.Failure.accountChanged) { try await cloud.progress() }
        await transport.close()
        await sync.stop()
        await reopened.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }
}
