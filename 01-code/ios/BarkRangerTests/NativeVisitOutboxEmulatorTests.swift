import BarkDomain
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor struct NativeVisitOutboxEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func offlineEditsReplayLostReplyAndRemoveASelectionAtomically() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let (app, auth, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let user = try await auth.createUser(
            withEmail: "\(UUID().uuidString)@native.invalid", password: UUID().uuidString
        ).user
        let profile = try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: user.uid)
        let failSave = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: user.uid,
            beforeSave: { if failSave.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        let profileSync = NativeProfileSync(store: store, cloud: profile)
        #expect(try await profileSync.synchronize() == .current)
        try await NativeEmulatorFixture.seedAccess(uid: user.uid, app: app)
        #expect(try await profileSync.synchronize() == .current)
        let parkA = Park(
            id: .init(rawValue: "00275387-3771-4533-ae24-2cf3e053384c"),
            siteID: .init(rawValue: "00275387-3771-4533-ae24-2cf3e053384c"), name: "Cedar Hill State Park",
            coordinate: try #require(Coordinate(latitude: 32.6194734, longitude: -96.9837294)),
            state: "Texas", stateCodes: ["TX"])
        let parkB = Park(
            id: .init(rawValue: "0086df89-51b0-4b60-9e9e-1ef4999ccc06"),
            siteID: .init(rawValue: "0086df89-51b0-4b60-9e9e-1ef4999ccc06"),
            name: "Point au Roche State Park",
            coordinate: try #require(Coordinate(latitude: 44.7855126, longitude: -73.3805056)),
            state: "New York", stateCodes: ["NY"])
        let now = Date()
        let zone = try #require(TimeZone(identifier: "UTC"))
        let firstID = try #require(try await store.markNativeVisit(park: parkA, now: now, timeZone: zone))
        let repository = NativeVisitRepository(store: store, cloud: nil)
        let firstSelection = try await repository.workingState(park: parkA)
        let a = try #require(firstSelection.draft)
        try await repository.changeDate(
            selected: firstSelection, date: now.addingTimeInterval(-86_400), timeZone: zone)
        let edited = try await repository.workingState(park: parkA)
        try await repository.mark(park: parkB)
        let secondSelection = try await repository.workingState(park: parkB)
        let b = try #require(secondSelection.draft)
        try await repository.remove([edited, secondSelection])
        #expect(try await store.visitQueue().count == 4)
        let first = try #require(try await store.nextVisitSubmission())
        #expect(first.submission.id == firstID)
        let transport = try NativeCallableTransport(uid: user.uid, auth: auth)
        let cloud = NativeVisitCloud(transport: transport)
        let firstOutcome = try await cloud.submit(first.submission)
        #expect(firstOutcome.status == .accepted)
        let confirmed = try NativeVisitSelection(
            snapshot: await cloud.visit(id: a.id, officialPlaceID: a.officialPlaceID))
        failSave.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await store.acceptNativeVisitOutcome(firstOutcome, selection: confirmed)
        }
        #expect(try await store.visitQueue().count == 4)
        #expect(try await store.nativeProgress() == nil)
        #expect(try await store.nativeVisit(id: a.id) == nil)
        failSave.withLock { $0 = false }
        // The process exits before recording that reply. The durable envelope must survive unchanged.
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: user.uid,
            beforeSave: { if failSave.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) } })
        #expect(try await reopened.nextVisitSubmission()?.submission == first.submission)
        let sync = NativeVisitSync(store: reopened, cloud: cloud)
        let result = try await sync.synchronize()
        #expect(result.pendingCount == 0 && !result.needsDecision && result.retryAt == nil)
        #expect(try await reopened.nativeProgress()?.sites == 0)
        #expect(try await reopened.nativeVisitHistory().isEmpty)
        #expect(try await reopened.nativeVisit(id: a.id)?.revision == 3)
        #expect(try await reopened.nativeVisit(id: b.id)?.revision == 2)
        #expect(try await reopened.nativeVisit(id: a.id)?.deleted == true)
        let references = [
            NativeVisitReference(target: edited.target()),
            NativeVisitReference(target: secondSelection.target()),
        ]
        let selected = try await cloud.selection(references)
        #expect(selected.visits.count == 2 && selected.visits.allSatisfy(\.deleted))
        #expect(selected.places.allSatisfy { !$0.visited && $0.visitRevision == nil })
        #expect(selected.progress?.sites == 0)
        try await verifyRemoteDeletionRecovery(
            store: reopened, cloud: cloud, sync: sync, park: parkA,
            setFailure: { value in failSave.withLock { $0 = value } })
        await sync.stop()
        await profileSync.stop()
        await reopened.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }
}
