import BarkDomain
import Foundation
import SQLite3

/// Rebuildable device-only spatial index. JSON files remain the authored records.
/// R-tree overlap queries include both sides of the date line, with no hidden pin cap.
nonisolated final class SavedPlaceIndex {
    struct Pin: Codable, Equatable, Sendable, Identifiable {
        let id: String
        let stop: Trip.Stop
        let subtitle: String
        init(_ place: SavedPlace) {
            id = place.id
            stop = place.stop
            subtitle = place.subtitle
        }
    }
    struct Region: Equatable, Sendable {
        let south: Double
        let north: Double
        let west: Double
        let east: Double
        let allLongitudes: Bool
        init(latitude: Double, longitude: Double, latitudeDelta: Double, longitudeDelta: Double) {
            south = max(-90, latitude - abs(latitudeDelta) / 2)
            north = min(90, latitude + abs(latitudeDelta) / 2)
            func normalized(_ x: Double) -> Double {
                let value = (x + 180).truncatingRemainder(dividingBy: 360)
                return (value < 0 ? value + 360 : value) - 180
            }
            west = normalized(longitude - abs(longitudeDelta) / 2)
            east = normalized(longitude + abs(longitudeDelta) / 2)
            allLongitudes = abs(longitudeDelta) >= 360
        }
    }
    enum Failure: Error { case database, corrupt }
    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(url: URL) throws {
        guard
            sqlite3_open_v2(
                url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil)
                == SQLITE_OK
        else {
            if let db { sqlite3_close(db) }
            db = nil
            throw Failure.database
        }
        try execute("PRAGMA journal_mode=WAL")
        try execute("PRAGMA synchronous=FULL")
        try execute(
            "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), dirty INTEGER NOT NULL)")
        try execute(
            "CREATE TABLE IF NOT EXISTS pins (rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, identity TEXT NOT NULL, payload BLOB NOT NULL)"
        )
        try execute("CREATE INDEX IF NOT EXISTS pin_identity ON pins(identity)")
        try execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS spatial USING rtree(id, minLat, maxLat, minLon, maxLon)")
    }
    deinit { if let db { sqlite3_close(db) } }
    var needsRebuild: Bool {
        get throws {
            let statement = try prepare("SELECT dirty FROM state WHERE id=1")
            defer { sqlite3_finalize(statement) }
            let step = sqlite3_step(statement)
            guard step == SQLITE_ROW || step == SQLITE_DONE else { throw Failure.database }
            return step == SQLITE_DONE || sqlite3_column_int(statement, 0) != 0
        }
    }
    func markDirty() throws { try execute("INSERT OR REPLACE INTO state VALUES(1,1)") }
    func beginRebuild() throws {
        try markDirty()
        try execute("BEGIN IMMEDIATE")
        try execute("DELETE FROM spatial")
        try execute("DELETE FROM pins")
    }
    func finish() throws {
        try execute("INSERT OR REPLACE INTO state VALUES(1,0)")
        try execute("COMMIT")
    }
    func rollback() { try? execute("ROLLBACK") }
    func begin() throws { try execute("BEGIN IMMEDIATE") }
    func put(_ pin: Pin) throws {
        guard let coordinate = pin.stop.coordinate else { throw Failure.corrupt }
        let bytes = try JSONEncoder().encode(pin)
        let statement = try prepare(
            "INSERT INTO pins(id,identity,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET identity=excluded.identity,payload=excluded.payload"
        )
        defer { sqlite3_finalize(statement) }
        try bind(pin.id, to: statement, at: 1)
        try bind(pin.stop.placeIdentity.storageID, to: statement, at: 2)
        let code = bytes.withUnsafeBytes {
            sqlite3_bind_blob(statement, 3, $0.baseAddress, Int32($0.count), transient)
        }
        guard code == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw Failure.database }
        let point = try prepare("INSERT OR REPLACE INTO spatial SELECT rowid,?,?,?,? FROM pins WHERE id=?")
        defer { sqlite3_finalize(point) }
        sqlite3_bind_double(point, 1, coordinate.latitude)
        sqlite3_bind_double(point, 2, coordinate.latitude)
        sqlite3_bind_double(point, 3, coordinate.longitude)
        sqlite3_bind_double(point, 4, coordinate.longitude)
        try bind(pin.id, to: point, at: 5)
        guard sqlite3_step(point) == SQLITE_DONE else { throw Failure.database }
    }
    func remove(_ id: String) throws {
        for sql in [
            "DELETE FROM spatial WHERE id IN (SELECT rowid FROM pins WHERE id=?)",
            "DELETE FROM pins WHERE id=?",
        ] {
            let statement = try prepare(sql)
            defer { sqlite3_finalize(statement) }
            try bind(id, to: statement, at: 1)
            guard sqlite3_step(statement) == SQLITE_DONE else { throw Failure.database }
        }
    }
    func matching(identity: String) throws -> [Pin] {
        let statement = try prepare("SELECT payload FROM pins WHERE identity=? ORDER BY id LIMIT 2")
        defer { sqlite3_finalize(statement) }
        try bind(identity, to: statement, at: 1)
        return try decode(statement)
    }
    func pins(in region: Region) throws -> [Pin] {
        // R-tree coordinates are outward-rounded float32. Filter exact doubles after
        // the index query so a boundary candidate cannot appear on the wrong side.
        let longitude =
            region.allLongitudes
            ? "1"
            : region.west <= region.east
                ? "s.maxLon>=? AND s.minLon<=?" : "(s.maxLon>=? OR s.minLon<=?)"
        let statement = try prepare(
            "SELECT p.payload FROM spatial s JOIN pins p ON p.rowid=s.id WHERE s.maxLat>=? AND s.minLat<=? AND (\(longitude))"
        )
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_double(statement, 1, region.south)
        sqlite3_bind_double(statement, 2, region.north)
        if !region.allLongitudes {
            sqlite3_bind_double(statement, 3, region.west)
            sqlite3_bind_double(statement, 4, region.east)
        }
        return try decode(statement).filter {
            guard let point = $0.stop.coordinate, point.latitude >= region.south,
                point.latitude <= region.north
            else { return false }
            return region.allLongitudes
                || (region.west <= region.east
                    ? point.longitude >= region.west && point.longitude <= region.east
                    : point.longitude >= region.west || point.longitude <= region.east)
        }
    }
    private func decode(_ statement: OpaquePointer) throws -> [Pin] {
        var pins: [Pin] = []
        while true {
            try Task.checkCancellation()
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { return pins }
            guard step == SQLITE_ROW, let pointer = sqlite3_column_blob(statement, 0) else {
                throw Failure.database
            }
            let count = Int(sqlite3_column_bytes(statement, 0))
            guard count > 0, count <= 16_384 else { throw Failure.corrupt }
            pins.append(try JSONDecoder().decode(Pin.self, from: Data(bytes: pointer, count: count)))
        }
    }
    private func bind(_ value: String, to statement: OpaquePointer, at index: Int32) throws {
        guard value.withCString({ sqlite3_bind_text(statement, index, $0, -1, transient) }) == SQLITE_OK
        else { throw Failure.database }
    }
    private func prepare(_ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw Failure.database
        }
        return statement
    }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw Failure.database }
    }
}
