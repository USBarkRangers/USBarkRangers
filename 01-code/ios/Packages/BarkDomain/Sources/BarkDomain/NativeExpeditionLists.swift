import Foundation

public struct NativeActivityClaims: Codable, Equatable, Sendable {
    public let version: Int
    public let activityIDs: [String]
    public let claimedIDs: [String]
    public let readTime: NativeServerTime
    public func validate(for requested: [String]) throws {
        guard version == 1, (1...100).contains(activityIDs.count), activityIDs == requested,
            Set(activityIDs).count == activityIDs.count, Set(claimedIDs).count == claimedIDs.count,
            Set(claimedIDs).isSubset(of: Set(activityIDs))
        else { throw NativeRecordValidation.Failure.malformed }
        for id in activityIDs { try NativeRecordValidation.uuid(id) }
    }
}
public struct NativeCompletedTrails: Codable, Equatable, Sendable {
    public struct Item: Codable, Equatable, Sendable, Identifiable {
        public let schemaVersion: Int
        public let id: String
        public let runID: String
        public let name: String
        public let trailRevision: Int64
        public let meters: Double
        public let completedAtMs: Int64
        public let updatedAt: NativeServerTime
        public func validate() throws {
            try NativeRecordValidation.identifier(id)
            try NativeRecordValidation.uuid(runID)
            try NativeRecordValidation.revision(trailRevision)
            try NativeRecordValidation.date(completedAtMs)
            guard schemaVersion == 1, !name.isEmpty, name.utf16.count <= 200,
                meters.isFinite, meters > 0
            else { throw NativeRecordValidation.Failure.malformed }
        }
    }
    public let version: Int
    public let items: [Item]
    public let readTime: NativeServerTime
    public func validate() throws {
        guard version == 1, items.count <= 100, Set(items.map(\.id)).count == items.count else {
            throw NativeRecordValidation.Failure.malformed
        }
        for item in items {
            try item.validate()
            guard item.updatedAt <= readTime else { throw NativeRecordValidation.Failure.malformed }
        }
    }
}
