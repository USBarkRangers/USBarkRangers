import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeAccountDeletionTests {
    @Test func acceptedDeletionDrainsWritersErasesOnlyItsAccountAndKeepsGuestAndOtherOwner() async throws {
        var requests: [String] = []
        let f = try await NativeOfflineAccountFixture.make(deleteAccount: { requests.append($0) })
        let other = try await NativeStore.open(directory: f.directory, project: "demo-bark-native", uid: "b")
        try await other.acceptProfile(.init(revision: 1, displayName: "Other owner"))
        await other.close()
        var cleaned: [String] = []
        f.session.eraseAdditionalAccountData = { uid in
            #expect(f.session.identity == nil)
            #expect(f.session.nativeProfile == nil)
            cleaned.append(uid)
        }
        let original = try #require(f.session.nativeProfile?.store)
        let model = AccountModel(session: f.session)
        model.deleteAccount()
        await model.action?.value
        try await eventually { f.session.identity == nil && f.session.nativeTrips != nil }
        #expect(requests == ["a"] && cleaned == ["a"])
        #expect(try NativeAccountRemovalFiles.pending(directory: f.directory).isEmpty)
        #expect(!FileManager.default.fileExists(atPath: try NativeStore.scopeDirectory(directory: f.directory, project: "demo-bark-native", uid: "a").path))
        #expect(FileManager.default.fileExists(atPath: try NativeStore.scopeDirectory(directory: f.directory, project: "demo-bark-native", uid: "b").path))
        await #expect(throws: NativeStore.Failure.closed) { try await original.profileView() }
        #expect(f.session.deletionMessage?.contains("Device data removed") == true)
        f.session.eraseAdditionalAccountData = nil
        try await f.close()
    }

    @Test func refusedRemoteDeletionKeepsLocalDataAndCreatesNoCleanupRequest() async throws {
        let f = try await NativeOfflineAccountFixture.make(deleteAccount: { _ in
            throw NativeCallableTransport.ServerFailure(reason: "recent-auth-required", retryAfterMs: nil)
        })
        let model = AccountModel(session: f.session)
        model.deleteAccount()
        await model.action?.value
        #expect(f.session.identity?.uid == "a")
        #expect(f.session.profileState?.confirmed?.displayName == "Ranger a")
        #expect(try NativeAccountRemovalFiles.pending(directory: f.directory).isEmpty)
        #expect(model.notice?.contains("Confirm your password") == true)
        try await f.close()
    }

    @Test func cleanupMarkerSurvivesFailureAndExactOwnerRemovalIsRepeatable() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let request = NativeAccountRemovalFiles.Request(project: "demo-bark-native", uid: "delete-a")
        try NativeAccountRemovalFiles.retain(request, directory: folder)
        #expect(try NativeAccountRemovalFiles.pending(directory: folder) == [request])
        for uid in ["delete-a", "keep-b"] {
            let store = try await NativeStore.open(directory: folder, project: request.project, uid: uid)
            await store.close()
            if uid == "delete-a" { try await store.eraseClosedAccount() }
        }
        try NativeAccountRemovalFiles.eraseClosedAccount(request, directory: folder)
        try NativeAccountRemovalFiles.eraseClosedAccount(request, directory: folder)
        #expect(try NativeAccountRemovalFiles.pending(directory: folder) == [request])
        #expect(FileManager.default.fileExists(atPath: try NativeStore.scopeDirectory(directory: folder, project: request.project, uid: "keep-b").path))
        try NativeAccountRemovalFiles.finish(request, directory: folder)
        #expect(try NativeAccountRemovalFiles.pending(directory: folder).isEmpty)
    }

    @Test func scopedPinErasureCannotRemoveRootOrAnotherAccount() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let root = SavedPlaceStore(directory: folder)
        let a = root.scoped(project: "demo-bark-native", uid: "a")
        let b = root.scoped(project: "demo-bark-native", uid: "b")
        let stop = Trip.Stop(id: "stop", placeIdentity: .custom("private-pin"), name: "Saved", coordinate: .init(latitude: 40, longitude: -75))
        let place = try #require(SavedPlace(stop: stop, subtitle: ""))
        try await a.save(place)
        try await b.save(place)
        await #expect(throws: SavedPlaceStore.Failure.self) { try await root.eraseAccountFiles() }
        try await a.eraseAccountFiles()
        #expect(try await a.saved(stop) == nil)
        #expect(try await b.saved(stop) == place)
    }
}
