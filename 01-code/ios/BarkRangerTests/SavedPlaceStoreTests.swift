import BarkDomain
import CryptoKit
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct SavedPlaceStoreTests {
    private func place(name: String = "Hinckley", appleID: String? = "hinckley") throws -> SavedPlace {
        var stop = Trip.Stop(
            name: name, coordinate: try #require(Coordinate(latitude: 41.24, longitude: -81.75)))
        if let appleID { stop.placeIdentity = .provider(name: "apple", id: appleID) }
        return try #require(SavedPlace(stop: stop, subtitle: "Ohio"))
    }

    @Test func repeatedSavesRelaunchAndRemovalPreserveLocalNotesAndNeverExpire() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SavedPlaceStore(directory: directory)
        var bookmark = try place()
        bookmark.notes = "Local journal note"
        let saved = try await store.save(bookmark)
        let again = try await store.save(place())
        #expect(saved == again)
        #expect(bookmark.stop.notes.isEmpty, "Adding to a trip must not upload device-only notes")
        #expect(
            try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        // File age is not a cleanup policy; a future process must still restore this record.
        let file = try #require(
            FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first {
                $0.pathExtension == "json"
            })
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 0)], ofItemAtPath: file.path)
        let relaunched = SavedPlaceStore(directory: directory)
        #expect(try await relaunched.saved(bookmark.stop) == saved)
        try await relaunched.remove(bookmark.id)
        #expect(try await SavedPlaceStore(directory: directory).saved(bookmark.stop) == nil)
    }

    @Test func identityDeduplicatesSearchUUIDsButKeepsDifferentPlacesAndRejectsParks() throws {
        let a = try place()
        let b = try place(name: "Hinckley Township")
        #expect(a.id == b.id, "Apple identity survives different result titles and fresh stop UUIDs")
        #expect(try a.id != place(appleID: "different").id)
        #expect(
            try place(appleID: nil).id != place(name: " HINCKLEY ", appleID: nil).id,
            "Independent arbitrary pins must not be merged by name/coordinates")
        var park = a.stop
        park.placeIdentity = .official(.init(rawValue: "catalog-park"))
        #expect(SavedPlace(stop: park, subtitle: "") == nil)
    }

    @Test func savedCoordinateKeepsExistingTripMembershipWithoutCopyingTripNotes() throws {
        var stop = Trip.Stop(name: "Home", coordinate: try #require(Coordinate(latitude: 41, longitude: -81)))
        stop.notes = "Account-backed trip note"
        let bookmark = try #require(SavedPlace(stop: stop, subtitle: "Ohio"))
        let trip = Trip(days: [.init(stops: [stop])])
        #expect(TripStopPolicy.membership(of: bookmark.stop, in: trip)?.stopID == stop.id)
        #expect(bookmark.notes.isEmpty && bookmark.stop.notes.isEmpty)
        let restored = try JSONDecoder().decode(SavedPlace.self, from: JSONEncoder().encode(bookmark))
        #expect(TripStopPolicy.membership(of: restored.stop, in: trip)?.stopID == stop.id)
    }

    @Test func corruptOrFutureDataIsPreservedAndCannotBeSilentlyOverwritten() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("unknown.json")
        let original = Data(#"{"version":99,"future":"Do not overwrite"}"#.utf8)
        try original.write(to: file)
        let store = SavedPlaceStore(directory: directory)
        await #expect(throws: (any Error).self) { try await store.save(place()) }
        #expect(try Data(contentsOf: file) == original)
        #expect(
            try FileManager.default.contentsOfDirectory(atPath: directory.path).filter {
                $0.hasSuffix(".json")
            } == ["unknown.json"])
    }

    @Test func failedWriteDoesNotPublishSuccessOrDismissTheSelectedPlace() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        // A regular file at the exact account folder makes adoption fail before any
        // native write. The account is Premium, so this is not a permission rejection.
        let accounts = directory.appendingPathComponent("accounts-v1")
        try FileManager.default.createDirectory(at: accounts, withIntermediateDirectories: true)
        let key = SHA256.hash(data: Data("demo-bark-native:account:a".utf8))
            .map { String(format: "%02x", $0) }.joined()
        let blocked = accounts.appendingPathComponent(key)
        try Data("keep".utf8).write(to: blocked)
        let fixture = try await NativeOfflineAccountFixture.make()
        let model = SavedPlacesModel(store: SavedPlaceStore(directory: directory), account: fixture.session)
        await model.waitForPending()
        #expect(model.canEdit)  // Exercise a storage failure, not the Premium permission guard.
        model.save(try place())
        await model.waitForPending()
        #expect(model.places.isEmpty && model.message != nil && !model.isWorking)
        var dismissed = false
        model.remove(try place()) { dismissed = true }
        await model.waitForPending()
        #expect(!dismissed && model.message != nil)
        #expect(try Data(contentsOf: blocked) == Data("keep".utf8))
        try await fixture.close()
    }
}
