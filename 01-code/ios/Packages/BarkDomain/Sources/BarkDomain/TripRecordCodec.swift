import Foundation

/// Temporary transport boundary while Phase 1 replaces the account adapters.
/// No raw record is retained by Trip/Day/Stop. Remove this bridge from the native runtime wiring.
public enum TripRecordCodec {
    public static func decode(_ record: SavedRecord) throws -> Trip {
        guard let days = record.fields["tripDays"]?.array else { throw Trip.Failure.malformed }
        let decoded = try days.enumerated().map { index, value -> Trip.Day in
            guard let fields = value.object, let stops = fields["stops"]?.array else {
                throw Trip.Failure.malformed
            }
            let id = fields["nativeDayID"]?.string ?? "\(record.id):day:\(index)"
            return Trip.Day(
                id: id, stops: try stops.enumerated().map {
                    try decodeStop($0.element, fallbackID: "\(id):stop:\($0.offset)")
                }, notes: try string(fields, "notes") ?? "", color: try string(fields, "color") ?? "#475569",
                date: try string(fields, "date"))
        }
        func bookend(_ key: String) throws -> Trip.Stop? {
            guard let value = record.fields[key], value != .null else { return nil }
            return try decodeStop(value, fallbackID: "\(record.id):\(key)")
        }
        return Trip(id: record.id, name: try string(record.fields, "tripName") ?? "Untitled trip",
            days: decoded, start: try bookend("tripStartNode"), end: try bookend("tripEndNode"))
    }

    public static func decodeStop(_ value: UserValue, fallbackID: String) throws -> Trip.Stop {
        guard let fields = value.object else { throw Trip.Failure.malformed }
        let id = try string(fields, "nativeStopID") ?? fallbackID
        let identity: PlaceIdentity
        if let park = try string(fields, "id") {
            identity = .official(.init(rawValue: park))
        } else if let provider = try string(fields, "placeId") {
            identity = .provider(name: "apple", id: provider)
        } else {
            identity = .custom(try string(fields, "customPlaceId") ?? id)
        }
        let coordinate = fields["lat"]?.number.flatMap { latitude in
            fields["lng"]?.number.flatMap { Coordinate(latitude: latitude, longitude: $0) }
        }
        return Trip.Stop(id: id, placeIdentity: identity,
            name: try string(fields, "name") ?? "Saved stop", coordinate: coordinate,
            state: try string(fields, "state") ?? "", city: try string(fields, "city"),
            category: try string(fields, "category").flatMap(ParkCategory.init(rawValue:)),
            arrivalTime: try string(fields, "arrivalTime"), visitMinutes: fields["visitMinutes"]?.number,
            notes: try string(fields, "notes") ?? "")
    }

    public static func encode(_ trip: Trip) -> SavedRecord {
        var fields: [String: UserValue] = [
            "tripName": .string(trip.name),
            "tripDays": .array(trip.days.map { day in
                var values: [String: UserValue] = [
                    "nativeDayID": .string(day.id), "notes": .string(day.notes),
                    "color": .string(day.color), "stops": .array(day.stops.map(encodeStop)),
                ]
                values["date"] = day.date.map(UserValue.string)
                return .object(values)
            }),
        ]
        fields["tripStartNode"] = trip.start.map(encodeStop)
        fields["tripEndNode"] = trip.end.map(encodeStop)
        return SavedRecord(id: trip.id, fields: fields)
    }

    private static func encodeStop(_ stop: Trip.Stop) -> UserValue {
        var fields: [String: UserValue] = ["nativeStopID": .string(stop.id), "name": .string(stop.name),
            "state": .string(stop.state), "notes": .string(stop.notes)]
        fields["id"] = stop.parkID.map { .string($0.rawValue) }
        fields["placeId"] = stop.applePlaceID.map(UserValue.string)
        fields["customPlaceId"] = stop.customPlaceID.map(UserValue.string)
        fields["lat"] = stop.coordinate.map { .number($0.latitude) }
        fields["lng"] = stop.coordinate.map { .number($0.longitude) }
        fields["city"] = stop.city.map(UserValue.string)
        fields["category"] = stop.category.map { .string($0.rawValue) }
        fields["arrivalTime"] = stop.arrivalTime.map(UserValue.string)
        fields["visitMinutes"] = stop.visitMinutes.map(UserValue.number)
        return .object(fields)
    }

    private static func string(_ fields: [String: UserValue], _ key: String) throws -> String? {
        guard let value = fields[key] else { return nil }
        guard let text = value.string else { throw Trip.Failure.malformed }
        return text
    }
}

extension Trip {
    public init(record: SavedRecord) throws { self = try TripRecordCodec.decode(record) }
    public var record: SavedRecord { TripRecordCodec.encode(self) }
    public var content: UserValue { record.tripContent }
}

extension SavedRecord {
    public var tripContent: UserValue {
        .object(fields.filter { !["createdAt", "updatedAt"].contains($0.key) })
    }
}
