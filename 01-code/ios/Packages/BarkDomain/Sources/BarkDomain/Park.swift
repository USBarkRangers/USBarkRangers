import Foundation

/// Existing canonical identity, preserved exactly. Never derive it from a row/name.
public struct ParkID: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// Physical-site identity remains distinct from a park record's identity.
public struct SiteID: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// Framework-independent geographic degrees; impossible coordinates cannot be made.
public struct Coordinate: Hashable, Sendable {
    public let latitude: Double
    public let longitude: Double

    public init?(latitude: Double, longitude: Double) {
        guard latitude.isFinite, longitude.isFinite,
              (-90...90).contains(latitude), (-180...180).contains(longitude)
        else { return nil }
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// Minimal immutable contract. Publication fields and validation arrive in phase 2.
public struct Park: Identifiable, Hashable, Sendable {
    public let id: ParkID
    public let siteID: SiteID
    public let name: String
    public let coordinate: Coordinate

    public init(id: ParkID, siteID: SiteID, name: String, coordinate: Coordinate) {
        self.id = id
        self.siteID = siteID
        self.name = name
        self.coordinate = coordinate
    }
}
