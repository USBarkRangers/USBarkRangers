import Foundation

/// Immutable publication metadata. Revision order comes from the publisher, never download time.
public struct CatalogManifest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let revision: Int64
    public let publishedAt: String
    public let sourceRevision: String
    public let count: Int
    public let bytes: Int
    public let sha256: String
    public let path: String
}

public struct CatalogSnapshot: Codable, Sendable {
    public let schemaVersion: Int
    public let revision: Int64
    public let publishedAt: String
    public let sourceRevision: String
    public let parks: [Park]
    public let retiredParkIDs: [ParkID]

    public init(
        schemaVersion: Int = 1, revision: Int64, publishedAt: String, sourceRevision: String,
        parks: [Park], retiredParkIDs: [ParkID] = []
    ) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.publishedAt = publishedAt
        self.sourceRevision = sourceRevision
        self.parks = parks
        self.retiredParkIDs = retiredParkIDs
    }
    public func park(id: ParkID) -> Park? { parks.first { $0.matchesIdentity(id) } }
    public func resolveAlias(_ id: ParkID) -> ParkID? { park(id: id)?.id }
    public func isNewer(than other: Self) -> Bool { revision > other.revision }
}

public enum CatalogSource: String, Sendable { case bundle, saved, online }
