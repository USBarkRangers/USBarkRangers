import Foundation

/// A stable visit event, never keyed by a park or embedded in a profile. J2/J3: later
/// repeat events and participating dogs reference this identity without multiplying points.
public struct NativeVisitRecord: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let revision: Int64
    public let officialPlaceID: String
    public let siteID: String
    public let updatedAt: NativeServerTime
    public let details: Details?
    public var deleted: Bool { details == nil }

    public struct Details: Codable, Equatable, Sendable {
        public let name: String
        public let state: String
        public let stateCodes: [String]
        public let coordinate: Coordinate
        public let catalogRevision: Int64
        public let happenedAtMs: Int64
        public let timeZone: String
        public let recordedAt: NativeServerTime
        public let source: Source
        public let verified: Bool
        public let proximity: Proximity?
        public var happenedAt: Date { Date(timeIntervalSince1970: Double(happenedAtMs) / 1000) }
        public enum Source: String, Codable, Sendable { case manual }
        func validate() throws {
            guard !name.isEmpty, name.utf16.count <= 500, state.utf16.count <= 100,
                coordinate.latitude.isFinite, (-90...90).contains(coordinate.latitude),
                coordinate.longitude.isFinite, (-180...180).contains(coordinate.longitude),
                (0...253_402_300_799_999).contains(happenedAtMs), timeZone.utf8.count <= 100,
                TimeZone(identifier: timeZone) != nil, verified == (proximity != nil)
            else { throw NativeRecordValidation.Failure.malformed }
            try NativeRecordValidation.stateCodes(stateCodes)
            try NativeRecordValidation.revision(catalogRevision)
            try proximity?.validate()
        }
    }
    public struct Proximity: Codable, Equatable, Sendable {
        public let latitude: Double
        public let longitude: Double
        public let accuracy: Double
        public let timestampMs: Int64
        public init(fix: LocationFix) throws {
            latitude = fix.coordinate.latitude
            longitude = fix.coordinate.longitude
            accuracy = fix.accuracy
            let milliseconds = fix.date.timeIntervalSince1970 * 1000
            guard milliseconds.isFinite,
                (0...Double(NativeRecordValidation.maximumInteger)).contains(milliseconds)
            else { throw NativeRecordValidation.Failure.malformed }
            timestampMs = Int64(milliseconds)
            try validate()
        }
        public func validate() throws {
            guard latitude.isFinite, (-90...90).contains(latitude), longitude.isFinite,
                (-180...180).contains(longitude), accuracy.isFinite, (0...5000).contains(accuracy)
            else { throw NativeRecordValidation.Failure.malformed }
            try NativeRecordValidation.revision(timestampMs, allowZero: true)
        }
    }
    public func validate() throws {
        try NativeRecordValidation.identifier(id)
        try NativeRecordValidation.identifier(officialPlaceID)
        try NativeRecordValidation.identifier(siteID)
        try NativeRecordValidation.revision(revision)
        try details?.validate()
        if let details, details.recordedAt > updatedAt { throw NativeRecordValidation.Failure.malformed }
    }
    enum CodingKeys: String, CodingKey {
        case id, schemaVersion, revision, officialPlaceID, siteID, updatedAt, deleted
    }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        guard try values.decode(Int.self, forKey: .schemaVersion) == 1 else {
            throw NativeRecordValidation.Failure.malformed
        }
        id = try values.decode(String.self, forKey: .id)
        revision = try values.decode(Int64.self, forKey: .revision)
        officialPlaceID = try values.decode(String.self, forKey: .officialPlaceID)
        siteID = try values.decode(String.self, forKey: .siteID)
        updatedAt = try values.decode(NativeServerTime.self, forKey: .updatedAt)
        details = try values.decode(Bool.self, forKey: .deleted) ? nil : Details(from: decoder)
        try validate()
    }
    public func encode(to encoder: any Encoder) throws {
        try validate()
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(1, forKey: .schemaVersion)
        try values.encode(id, forKey: .id)
        try values.encode(revision, forKey: .revision)
        try values.encode(officialPlaceID, forKey: .officialPlaceID)
        try values.encode(siteID, forKey: .siteID)
        try values.encode(updatedAt, forKey: .updatedAt)
        try values.encode(deleted, forKey: .deleted)
        try details?.encode(to: encoder)
    }
}
