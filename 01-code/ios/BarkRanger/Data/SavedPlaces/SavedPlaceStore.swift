import BarkDomain
import Foundation

/// Sole device-bookmark writer. Authored JSON is untouched during indexing; the
/// spatial index can be rebuilt after an interrupted mutation. No TTL or account cleanup.
/// J1: device bookmarks/notes never become account uploads without an explicit future move.
actor SavedPlaceStore {
    enum Failure: Error { case invalidRecord, ambiguousIdentity }
    private struct Record: Codable {
        let version: Int
        let place: SavedPlace
    }
    private let directory: URL
    private var index: SavedPlaceIndex?
    init(directory: URL) { self.directory = directory }

    func prepare() throws {
        if let index, try !index.needsRebuild { return }
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var protected = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try protected.setResourceValues(values)
        let value = try index ?? SavedPlaceIndex(url: directory.appendingPathComponent("markers-v1.sqlite"))
        index = value
        guard try value.needsRebuild else { return }
        do {
            try value.beginRebuild()
            let files = try FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: nil)
            for file in files where file.pathExtension == "json" {
                try Task.checkCancellation()
                try value.put(.init(read(file.deletingPathExtension().lastPathComponent)))
            }
            try value.finish()
        } catch {
            value.rollback()
            throw error
        }
    }
    func pins(in region: SavedPlaceIndex.Region, including stops: [Trip.Stop] = []) throws -> [String:
        SavedPlaceIndex.Pin]
    {
        try prepare()
        guard let index else { throw Failure.invalidRecord }
        var result = Dictionary(uniqueKeysWithValues: try index.pins(in: region).map { ($0.id, $0) })
        for stop in stops {
            for pin in try index.matching(identity: stop.placeIdentity.storageID) { result[pin.id] = pin }
        }
        return result
    }
    func saved(_ stop: Trip.Stop) throws -> SavedPlace? {
        try prepare()
        guard let index else { throw Failure.invalidRecord }
        let pins = try index.matching(identity: stop.placeIdentity.storageID)
        guard pins.count <= 1 else { throw Failure.ambiguousIdentity }
        return try pins.first.map { try read($0.id) }
    }
    @discardableResult func save(_ place: SavedPlace) throws -> SavedPlace {
        try prepare()
        if let existing = try saved(place.stop) { return existing }
        guard place.id == SavedPlace.identity(for: place.stop), let index else { throw Failure.invalidRecord }
        try Task.checkCancellation()
        try index.markDirty()
        // Mark-before-write: a crash after either commit recovers from files, never
        // a falsely clean index. Repeat saves retain note/date and original identity.
        try JSONEncoder().encode(Record(version: 1, place: place)).write(
            to: file(place.id),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        do {
            try index.begin()
            try index.put(.init(place))
            try index.finish()
        } catch {
            index.rollback()
            throw error
        }
        return place
    }
    func remove(_ id: String) throws {
        try prepare()
        guard let index else { throw Failure.invalidRecord }
        guard id.count == 64, id.allSatisfy({ "0123456789abcdef".contains($0) }) else {
            throw Failure.invalidRecord
        }
        if !FileManager.default.fileExists(atPath: file(id).path) { return }
        _ = try read(id)
        try Task.checkCancellation()
        try index.markDirty()
        try FileManager.default.removeItem(at: file(id))
        do {
            try index.begin()
            try index.remove(id)
            try index.finish()
        } catch {
            index.rollback()
            throw error
        }
    }
    private func read(_ id: String) throws -> SavedPlace {
        guard id.count == 64, id.allSatisfy({ "0123456789abcdef".contains($0) }) else {
            throw Failure.invalidRecord
        }
        let record = try JSONDecoder().decode(Record.self, from: Data(contentsOf: file(id)))
        // Earlier v1 files used another hash. Preserve file/stop identities; add the
        // current lookup key to the rebuildable index instead of silently rekeying.
        guard record.version == 1, record.place.id == id,
            record.place.stop.placeIdentity.isValid, !record.place.name.isEmpty
        else { throw Failure.invalidRecord }
        return record.place
    }
    private func file(_ id: String) -> URL { directory.appendingPathComponent(id + ".json") }
}
