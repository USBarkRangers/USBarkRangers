import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct SavedPlaceIndexTests {
    private func place(_ id: String, latitude: Double, longitude: Double) throws -> SavedPlace {
        try #require(
            SavedPlace(
                stop: .init(
                    id: id, placeIdentity: .custom(id), name: id,
                    coordinate: Coordinate(latitude: latitude, longitude: longitude)), subtitle: "Local"))
    }
    @Test func indexedViewportKeepsDateLineEdgesAndDoesNotDecodeOutsideNotes() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = SavedPlaceStore(directory: directory)
        let east = try place("east", latitude: 0, longitude: 179.5)
        let west = try place("west", latitude: 0, longitude: -179.5)
        var outside = try place("outside", latitude: 0, longitude: 0)
        outside.notes = "Private note must not enter marker data"
        try await store.save(east)
        try await store.save(west)
        try await store.save(outside)
        let crossing = SavedPlaceIndex.Region(
            latitude: 0, longitude: 180, latitudeDelta: 2, longitudeDelta: 4)
        let pins = try await store.pins(in: crossing)
        #expect(Set(pins.keys) == [east.id, west.id])
        let retained = try await store.pins(in: crossing, including: [outside.stop])
        #expect(retained.count == 3 && retained[outside.id]?.stop.notes.isEmpty == true)
        #expect(!String(decoding: try JSONEncoder().encode(retained), as: UTF8.self).contains(outside.notes))
        #expect(try await SavedPlaceStore(directory: directory).pins(in: crossing) == pins)
    }

    @Test func earlierFileIdentityAndPrivateTextSurviveIndexingAndInterruptedIndexUpdate() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var original = try place("original-stop", latitude: 41, longitude: -81)
        original.notes = "Original device note"
        var value = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        let oldID = String(repeating: "a", count: 64)
        value["id"] = oldID
        value.removeValue(forKey: "customPlaceID")
        let bytes = try JSONSerialization.data(withJSONObject: ["version": 1, "place": value])
        let file = directory.appendingPathComponent(oldID + ".json")
        try bytes.write(to: file)
        let decoded = try JSONDecoder().decode(
            SavedPlace.self, from: JSONSerialization.data(withJSONObject: value))
        let store = SavedPlaceStore(directory: directory)
        let restored = try #require(try await store.saved(decoded.stop))
        #expect(
            restored.id == oldID && restored.stop.id == "original-stop" && restored.notes == original.notes)
        #expect(try Data(contentsOf: file) == bytes)
        // Emulate process loss after dirty marker and before the matching index commit.
        let index = try SavedPlaceIndex(url: directory.appendingPathComponent("markers-v1.sqlite"))
        try index.markDirty()
        try index.begin()
        try index.remove(oldID)
        try index.finish()
        try index.markDirty()
        let reopened = SavedPlaceStore(directory: directory)
        #expect(try await reopened.saved(decoded.stop) == restored)
        #expect(try Data(contentsOf: file) == bytes)
    }

    @Test func tenThousandMarkersUseRegionalCandidatesWithoutAnArbitraryPinCap() throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let index = try SavedPlaceIndex(url: directory.appendingPathComponent("spatial.sqlite"))
        try index.beginRebuild()
        for row in 0..<100 {
            for column in 0..<100 {
                try index.put(
                    .init(
                        place("\(row)-\(column)", latitude: Double(row) - 50, longitude: Double(column) - 100)
                    ))
            }
        }
        try index.finish()
        let start = ContinuousClock.now
        let pins = try index.pins(in: .init(latitude: 0, longitude: -50, latitudeDelta: 2, longitudeDelta: 2))
        let elapsed = start.duration(to: .now)
        #expect(pins.count == 9)
        let world = try index.pins(
            in: .init(latitude: 0, longitude: 0, latitudeDelta: 180, longitudeDelta: 360))
        #expect(
            world.count == 10_000, "Dense views are complete; no arbitrary limit silently hides personal pins"
        )
        print(
            "SAVED_PLACE_SPATIAL: total=10000; viewport_rows=9; query=\(elapsed); viewport_bytes=\(try JSONEncoder().encode(pins).count)"
        )
    }
}
