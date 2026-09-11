import BarkDomain
import CoreFoundation
import FirebaseFirestore
import Foundation

/// The only SDK/current-format conversion boundary. Unknown fields survive; incomplete reads fail closed.
nonisolated struct CloudUserDecoder {
    enum Failure: Error { case malformed, incomplete }
    static func value(_ raw: Any) throws -> UserValue {
        switch raw {
        case is NSNull: return .null
        case let v as Timestamp:
            return .object([
                "seconds": .number(Double(v.seconds)), "nanoseconds": .number(Double(v.nanoseconds)),
            ])
        case let v as Date: return .number(v.timeIntervalSince1970 * 1000)
        case let v as NSNumber:
            if CFGetTypeID(v) == CFBooleanGetTypeID() { return .bool(v.boolValue) }
            guard v.doubleValue.isFinite else { throw Failure.malformed }
            return .number(v.doubleValue)
        case let v as String: return .string(v)
        case let v as [Any]: return .array(try v.map(value))
        case let v as [String: Any]: return .object(try v.mapValues(value))
        case let v as GeoPoint:
            return .object([
                "_type": .string("geopoint"), "latitude": .number(v.latitude),
                "longitude": .number(v.longitude),
            ])
        case let v as DocumentReference:
            return .object(["_type": .string("reference"), "path": .string(v.path)])
        case let v as Data:
            return .object(["_type": .string("bytes"), "base64": .string(v.base64EncodedString())])
        default: throw Failure.malformed
        }
    }
    static func decode(
        uid: String, user: [String: Any], trips: [SavedRecord],
        achievements: [SavedRecord], now: Date = Date()
    ) throws -> PersonalSnapshot {
        guard let fields = try value(user).object else { throw Failure.malformed }
        for key in ["visitedPlaces", "completed_expeditions", "completedExpeditions"] {
            if let field = fields[key], field != .null, field.array == nil { throw Failure.incomplete }
        }
        for key in ["settings", "entitlement", "virtual_expedition"] {
            if let field = fields[key], field != .null, field.object == nil { throw Failure.incomplete }
        }
        var unresolved: [String] = []
        for (index, visit) in (fields["visitedPlaces"]?.array ?? []).enumerated() {
            if Self.visit(visit).parkID?.isEmpty != false {
                unresolved.append(
                    "Visit \(index + 1) has an unresolved identity; its original record is retained.")
            }
        }
        for record in trips {
            if (try? trip(record)) == nil {
                unresolved.append("A saved trip has an unrecognized layout; its original record is retained.")
            }
        }
        return PersonalSnapshot(
            uid: uid, profile: UserProfile(fields: fields), trips: trips,
            achievements: achievements, unresolved: unresolved, confirmedAt: now)
    }
    static func receipt(_ raw: Any) throws -> MutationReceipt {
        let data = try JSONEncoder().encode(value(raw))
        return try JSONDecoder().decode(MutationReceipt.self, from: data)
    }
    static func visit(_ record: UserValue) -> Visit {
        Visit(parkID: record.object?["id"]?.string, visitedAt: record.object?["ts"]?.date)
    }
    static func trip(_ record: SavedRecord) throws -> Trip {
        guard let days = record.fields["tripDays"]?.array else { throw Failure.malformed }
        return Trip(
            id: record.id, name: record.fields["tripName"]?.string,
            days: try days.map { day in
                guard let fields = day.object, let stops = fields["stops"]?.array else {
                    throw Failure.malformed
                }
                return Trip.Day(notes: fields["notes"]?.string, stops: stops)
            })
    }
    static func expedition(_ record: UserValue, completed: Bool) -> Expedition {
        let fields = record.object ?? [:]
        return Expedition(
            trailID: fields[completed ? "id" : "active_trail"]?.string,
            distanceMeters: meters(fromStoredMiles: fields[completed ? "miles" : "miles_logged"]),
            completedAt: fields["date_completed"]?.date)
    }
    static func meters(fromStoredMiles value: UserValue?) -> Double? {
        guard let miles = value?.number ?? value?.string.flatMap(Double.init), miles.isFinite, miles >= 0
        else { return nil }
        return miles * 1609.344
    }
}
