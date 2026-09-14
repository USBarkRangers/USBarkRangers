import Foundation

public struct NativeTripOutcome: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable { case accepted, conflict }
    public struct Revisions: Codable, Equatable, Sendable {
        public let trip: Int64
        public let metadata: Int64?
        public let notes: [String: Int64]?
        public init(trip: Int64, metadata: Int64? = nil, notes: [String: Int64]? = nil) {
            self.trip = trip
            self.metadata = metadata
            self.notes = notes
        }
    }
    public let version: Int
    public let operationID: UUID
    public let status: Status
    public let revisions: Revisions
    public let confirmation: NativeTripMetadata?
    public init(
        operationID: UUID, status: Status, revisions: Revisions, version: Int = 1,
        confirmation: NativeTripMetadata? = nil
    ) {
        self.operationID = operationID
        self.status = status
        self.revisions = revisions
        self.version = version
        self.confirmation = confirmation
    }
    public func validate() throws {
        guard version == 1, (0...9_007_199_254_740_991).contains(revisions.trip),
            revisions.metadata.map({ (1...9_007_199_254_740_991).contains($0) }) ?? true,
            revisions.notes.map({
                $0.count <= 502 && $0.values.allSatisfy({ (0...9_007_199_254_740_991).contains($0) })
            }) ?? true
        else { throw Trip.Failure.malformed }
        if let confirmation {
            try confirmation.validate()
            guard status == .accepted, confirmation.revision == revisions.metadata,
                confirmation.contentRevision == revisions.trip
            else { throw Trip.Failure.malformed }
        }
    }
}
