import Foundation

/// A projection over an existing visit record. Unknown fields survive date and evidence edits.
public struct Visit: Equatable, Sendable, Identifiable {
    public let id: String
    public var fields: [String: UserValue]
    public var parkID: String? { fields["id"]?.string }
    public var visitedAt: Date? { fields["ts"]?.date }
    public var name: String { fields["name"]?.string ?? "Saved park" }
    public var verified: Bool { fields["verified"]?.bool == true }
    public var record: UserValue { .object(fields) }
    public var coordinate: Coordinate? {
        guard let lat = fields["lat"]?.number, let lng = fields["lng"]?.number else { return nil }
        return Coordinate(latitude: lat, longitude: lng)
    }
    public init(record: UserValue, fallbackID: String) {
        fields = record.object ?? [:]
        id = fields["id"]?.string ?? fallbackID
    }
    public init(parkID: String?, visitedAt: Date?) {
        id = parkID ?? "unresolved"
        fields = [:]
        if let parkID { fields["id"] = .string(parkID) }
        if let visitedAt { fields["ts"] = .number(visitedAt.timeIntervalSince1970 * 1000) }
    }
    public static func records(in profile: UserProfile) -> [Visit] {
        (profile.fields["visitedPlaces"]?.array ?? []).enumerated().map {
            Visit(record: $0.element, fallbackID: "unresolved-\($0.offset)")
        }
    }
}

/// Retain accuracy and time so proximity policy can reject a stale or imprecise location.
public struct LocationFix: Equatable, Sendable {
    public let coordinate: Coordinate
    public let accuracy: Double
    public let date: Date
    public init(coordinate: Coordinate, accuracy: Double, date: Date) {
        self.coordinate = coordinate
        self.accuracy = accuracy
        self.date = date
    }
}

extension Coordinate {
    public func distance(to other: Coordinate) -> Double {
        let radians = Double.pi / 180
        let latitudeDelta = (other.latitude - latitude) * radians
        let longitudeDelta = (other.longitude - longitude) * radians
        let a =
            pow(sin(latitudeDelta / 2), 2)
            + cos(latitude * radians) * cos(other.latitude * radians) * pow(sin(longitudeDelta / 2), 2)
        return 6_371_000 * 2 * atan2(sqrt(max(0, a)), sqrt(max(0, 1 - a)))
    }
}
