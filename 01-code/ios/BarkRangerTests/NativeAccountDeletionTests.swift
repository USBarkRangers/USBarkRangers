import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeAccountDeletionTests {
    @Test func deletionMarkerCanBeResumedThroughASymlinkedContainerPath() throws {
        let root = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let real = root.appendingPathComponent("Application Support")
        let alias = root.appendingPathComponent("container-alias")
        try FileManager.default.createDirectory(at: real, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: real)
        let request = NativeAccountRemovalFiles.Request(project: "demo-bark-native", uid: "deleted-owner")
        try NativeAccountRemovalFiles.retain(request, directory: alias)
        #expect(try NativeAccountRemovalFiles.pending(directory: alias) == [request])
        #expect(try NativeAccountRemovalFiles.pending(directory: real) == [request])
        try NativeAccountRemovalFiles.finish(request, directory: alias)
        #expect(try NativeAccountRemovalFiles.pending(directory: real).isEmpty)
    }

    @Test func deletionMarkerStillRequiresItsExactOwnerFilename() throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let request = NativeAccountRemovalFiles.Request(project: "demo-bark-native", uid: "delete-a")
        try NativeAccountRemovalFiles.retain(request, directory: folder)
        let markers = folder.appendingPathComponent("removals-v1")
        let original = try #require(FileManager.default.contentsOfDirectory(at: markers, includingPropertiesForKeys: nil).first)
        try FileManager.default.moveItem(at: original, to: markers.appendingPathComponent("wrong-owner.json"))
        var refused: [any Error] = []
        #expect(try NativeAccountRemovalFiles.pending(directory: folder, unreadable: { refused.append($0) }).isEmpty)
        #expect(refused.first as? NativeStore.Failure == .wrongScope)
        // Set aside once: it authorizes no erase and is not reported again.
        #expect(FileManager.default.fileExists(atPath: markers.appendingPathComponent("wrong-owner.json.unreadable").path))
        #expect(try NativeAccountRemovalFiles.pending(directory: folder, unreadable: { refused.append($0) }).isEmpty)
        #expect(refused.count == 1)
    }

    @Test func unreadableMarkerStrandsNeitherOtherCleanupsNorAnotherAccount() async throws {
        let f = try await NativeOfflineAccountFixture.make(signIn: false)
        await f.session.stopAndWait()
        let damaged = NativeAccountRemovalFiles.Request(project: "demo-bark-native", uid: "damaged-owner")
        let healthy = NativeAccountRemovalFiles.Request(project: "demo-bark-native", uid: "healthy-owner")
        let markers = f.directory.appendingPathComponent("removals-v1")
        try NativeAccountRemovalFiles.retain(damaged, directory: f.directory)
        let marker = try #require(FileManager.default.contentsOfDirectory(at: markers, includingPropertiesForKeys: nil).first)
        try Data("not a marker".utf8).write(to: marker)
        try NativeAccountRemovalFiles.retain(healthy, directory: f.directory)
        let store = try await NativeStore.open(directory: f.directory, project: healthy.project, uid: healthy.uid)
        await store.close()

        f.session.start()
        try await eventually { f.session.cleanupState == .ready && f.session.nativeTrips != nil }
        #expect(try NativeAccountRemovalFiles.pending(directory: f.directory).isEmpty)
        #expect(FileManager.default.fileExists(atPath: marker.appendingPathExtension("unreadable").path))
        #expect(!FileManager.default.fileExists(atPath: try NativeStore.scopeDirectory(directory: f.directory, project: healthy.project, uid: healthy.uid).path))

        f.auth.select("b")
        try await eventually { f.session.identity?.uid == "b" && f.session.nativeTrips != nil }
        try await f.close()
    }

    /// A build that forgot to wire the app's erase hook must not report the device clean.
    /// The marker survives, so a fixed build finishes the cleanup.
    @Test func cleanupWithoutTheEraseHookFailsRecoverablyInsteadOfFinishing() async throws {
        let f = try await NativeOfflineAccountFixture.make(signIn: false)
        await f.session.stopAndWait()
        let request = NativeAccountRemovalFiles.Request(project: "demo-bark-native", uid: "deleted-owner")
        try NativeAccountRemovalFiles.retain(request, directory: f.directory)
        let store = try await NativeStore.open(directory: f.directory, project: request.project, uid: request.uid)
        await store.close()
        let folder = try NativeStore.scopeDirectory(directory: f.directory, project: request.project, uid: request.uid)

        f.session.eraseAdditionalAccountData = nil
        f.session.start()
        try await eventually { f.session.cleanupState == .failed && f.session.nativeTrips != nil }
        #expect(try NativeAccountRemovalFiles.pending(directory: f.directory) == [request])
        #expect(FileManager.default.fileExists(atPath: folder.path))

        f.session.eraseAdditionalAccountData = { _ in }
        await f.session.retryCleanup()
        try await eventually { f.session.cleanupState == .ready }
        #expect(try NativeAccountRemovalFiles.pending(directory: f.directory).isEmpty)
        #expect(!FileManager.default.fileExists(atPath: folder.path))
        f.session.eraseAdditionalAccountData = nil
        try await f.close()
    }

    /// The reply was lost after the server accepted. The device erases nothing on its own
    /// suspicion; the server's word settles it, from whichever device the deletion came.
    @Test(arguments: ["deleting-profile", "missing-user"])
    func lostDeletionReplyIsSettledByTheServersWord(_ word: String) async throws {
        let f = try await NativeOfflineAccountFixture.make(deleteAccount: { _ in
            throw URLError(.networkConnectionLost)
        })
        let model = AccountModel(session: f.session)
        model.deleteAccount()
        await model.action?.value
        #expect(f.session.identity?.uid == "a" && f.session.profileState?.confirmed != nil)
        #expect(try NativeAccountRemovalFiles.pending(directory: f.directory).isEmpty)

        if word == "deleting-profile" {
            let store = try #require(f.session.nativeProfile?.store)
            try await store.acceptProfile(.init(revision: 2, displayName: "Ranger a", status: .deleting))
        } else {
            f.auth.select("a", removedByServer: true)
        }
        try await eventually {
            f.session.identity == nil && f.session.nativeTrips != nil && f.session.cleanupState == .ready
        }
        #expect(f.auth.currentUID == nil)
        #expect(try NativeAccountRemovalFiles.pending(directory: f.directory).isEmpty)
        #expect(!FileManager.default.fileExists(atPath: try NativeStore.scopeDirectory(directory: f.directory, project: "demo-bark-native", uid: "a").path))
        #expect(f.session.deletionMessage?.contains("Device data removed") == true)
        try await f.close()
    }

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
        // The notice belongs to the signed-out screen, not to whoever signs in next.
        f.auth.select("b")
        try await eventually { f.session.identity?.uid == "b" && f.session.nativeTrips != nil }
        #expect(f.session.deletionMessage == nil)
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
