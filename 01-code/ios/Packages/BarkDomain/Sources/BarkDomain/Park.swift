import Foundation

/// IDs are exact source strings. Never derive account history keys from coordinates or names.
public struct ParkID: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }
    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct SiteID: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }
    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }
    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct Coordinate: Hashable, Codable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public init?(latitude: Double, longitude: Double) {
        guard latitude.isFinite, longitude.isFinite, (-90...90).contains(latitude),
            (-180...180).contains(longitude)
        else { return nil }
        self.latitude = latitude
        self.longitude = longitude
    }
    private enum CodingKeys: String, CodingKey { case latitude, longitude }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let latitude = try values.decode(Double.self, forKey: .latitude)
        let longitude = try values.decode(Double.self, forKey: .longitude)
        guard let coordinate = Self(latitude: latitude, longitude: longitude) else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Invalid coordinates"))
        }
        self = coordinate
    }
}

public enum ParkCategory: String, Codable, CaseIterable, Sendable {
    case national = "National"
    case state = "State"
    case other = "Other"
}
public enum Swag: String, Codable, CaseIterable, Sendable {
    case tag = "Tag"
    case bandana = "Bandana"
    case certificate = "Certificate"
    case other = "Other"
}

/// Public catalog facts only. Personal visit flags and map objects never belong here.
public struct Park: Identifiable, Hashable, Codable, Sendable {
    public let id: ParkID
    public let siteID: SiteID
    public let name: String
    public let state: String
    public let stateCodes: [String]
    public let coordinate: Coordinate
    public let category: ParkCategory
    public let sourceType: String
    public let swag: Swag
    public let swagCost: String
    public let info: String
    public let entranceFees: String
    public let swagLocation: String
    public let approvedTrails: String
    public let restrictions: String
    public let hazards: String
    public let extraSwag: String
    public let websites: [URL]
    public let pictures: [URL]
    public let videos: [URL]
    public let aliases: [ParkID]
    public let isRetired: Bool

    public init(
        id: ParkID, siteID: SiteID, name: String, coordinate: Coordinate,
        state: String = "", stateCodes: [String] = [], category: ParkCategory = .other,
        sourceType: String = "", swag: Swag = .other, swagCost: String = "", info: String = "",
        entranceFees: String = "", swagLocation: String = "", approvedTrails: String = "",
        restrictions: String = "", hazards: String = "", extraSwag: String = "",
        websites: [URL] = [], pictures: [URL] = [], videos: [URL] = [], aliases: [ParkID] = [],
        isRetired: Bool = false
    ) {
        self.id = id
        self.siteID = siteID
        self.name = name
        self.coordinate = coordinate
        self.state = state
        self.stateCodes = stateCodes
        self.category = category
        self.sourceType = sourceType
        self.swag = swag
        self.swagCost = swagCost
        self.info = info
        self.entranceFees = entranceFees
        self.swagLocation = swagLocation
        self.approvedTrails = approvedTrails
        self.restrictions = restrictions
        self.hazards = hazards
        self.extraSwag = extraSwag
        self.websites = websites
        self.pictures = pictures
        self.videos = videos
        self.aliases = aliases
        self.isRetired = isRetired
    }
    public func matchesIdentity(_ candidate: ParkID) -> Bool {
        id == candidate || aliases.contains(candidate)
    }
    public var displayLocation: String { state.isEmpty ? name : "\(name), \(state)" }
}
