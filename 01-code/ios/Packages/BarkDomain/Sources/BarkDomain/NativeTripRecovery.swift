import Foundation

public struct NativeTripRecovery: Codable, Equatable, Sendable {
    public struct Query: Codable, Equatable, Sendable {
        public let version: Int
        public let tripID: String
        public let stopIDs: [String]
        public init(trip: Trip) {
            version = 1
            tripID = trip.id
            stopIDs = trip.allStops.map(\.id)
        }
    }
    public let version: Int
    public let tripID: String
    public let metadata: NativeTripMetadata?
    public let notes: [NativePlanningNote]
    public let readTime: NativeServerTime
    public init(
        tripID: String, metadata: NativeTripMetadata?, notes: [NativePlanningNote],
        readTime: NativeServerTime, version: Int = 1
    ) {
        self.version = version
        self.tripID = tripID
        self.metadata = metadata
        self.notes = notes
        self.readTime = readTime
    }
    public func validate(for query: Query) throws {
        guard version == 1, query.version == 1, tripID == query.tripID, notes.count <= 502,
            query.stopIDs.count <= 502, Set(query.stopIDs).count == query.stopIDs.count,
            Set(notes.map(\.id)).count == notes.count
        else { throw Trip.Failure.malformed }
        if let metadata {
            try metadata.validate()
            guard metadata.id == tripID, metadata.updatedAt <= readTime else { throw Trip.Failure.malformed }
        }
        let stops = Set(query.stopIDs)
        for note in notes {
            try note.validate()
            guard note.tripID == tripID, stops.contains(note.stopID), !note.deleted else {
                throw Trip.Failure.malformed
            }
        }
    }
}
