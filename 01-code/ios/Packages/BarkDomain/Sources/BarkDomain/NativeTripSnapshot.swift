import Foundation

/// A single bounded, consistent selected-trip read. Library pages use metadata alone.
public struct NativeTripSnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let tripID: String
    public let metadata: NativeTripMetadata?
    public let content: NativeTripContent?
    public let notes: [NativePlanningNote]
    public let readTime: NativeServerTime
    public init(
        tripID: String, metadata: NativeTripMetadata?, content: NativeTripContent?,
        notes: [NativePlanningNote],
        readTime: NativeServerTime, version: Int = 1
    ) {
        self.tripID = tripID
        self.metadata = metadata
        self.content = content
        self.notes = notes
        self.readTime = readTime
        self.version = version
    }
    public func validate() throws {
        guard version == 1, !tripID.isEmpty, notes.count <= 502 else { throw Trip.Failure.malformed }
        if let metadata {
            try metadata.validate()
            guard metadata.id == tripID, metadata.updatedAt <= readTime else { throw Trip.Failure.malformed }
        }
        if metadata == nil || metadata?.deleted == true {
            guard content == nil, notes.isEmpty else { throw Trip.Failure.malformed }
            return
        }
        guard let content, content.tripID == tripID, content.revision == metadata?.contentRevision,
            Set(notes.map(\.id)).count == notes.count, Set(content.noteIDs) == Set(notes.map(\.id))
        else { throw Trip.Failure.malformed }
        _ = try content.workingCopy(notes: Dictionary(uniqueKeysWithValues: notes.map { ($0.id, $0) }))
    }
}
