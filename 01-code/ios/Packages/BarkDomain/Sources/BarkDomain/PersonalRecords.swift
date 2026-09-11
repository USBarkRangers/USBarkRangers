import Foundation

/// Read projections of current server records. The original snapshot remains the persisted authority.
public struct Visit: Equatable, Sendable {
    public let parkID: String?
    public let visitedAt: Date?
    public init(parkID: String?, visitedAt: Date?) {
        self.parkID = parkID
        self.visitedAt = visitedAt
    }
}

public struct Trip: Equatable, Sendable {
    public struct Day: Equatable, Sendable {
        public let notes: String?
        public let stops: [UserValue]
        public init(notes: String?, stops: [UserValue]) {
            self.notes = notes
            self.stops = stops
        }
    }
    public let id: String
    public let name: String?
    public let days: [Day]
    public init(id: String, name: String?, days: [Day]) {
        self.id = id
        self.name = name
        self.days = days
    }
}

public struct Expedition: Equatable, Sendable {
    public let trailID: String?
    public let distanceMeters: Double?
    public let completedAt: Date?
    public init(trailID: String?, distanceMeters: Double?, completedAt: Date?) {
        self.trailID = trailID
        self.distanceMeters = distanceMeters
        self.completedAt = completedAt
    }
}
