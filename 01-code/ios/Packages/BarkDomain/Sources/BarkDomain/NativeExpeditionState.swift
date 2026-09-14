import Foundation

/// Small current selection and lifetime totals, without a walk/history array.
/// Selection revision changes only on assignment/completion, not every logged mile.
public struct NativeExpeditionState: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let revision: Int64
    public let selectionRevision: Int64
    public let activeRunID: String?
    public let lifetimeMiles: Double
    public let updatedAt: NativeServerTime
    public var lifetimeMeters: Double { lifetimeMiles * 1609.344 }
    public func validate() throws {
        guard schemaVersion == 1, lifetimeMiles.isFinite,
            (0...Double(NativeRecordValidation.maximumInteger)).contains(lifetimeMiles)
        else { throw NativeRecordValidation.Failure.malformed }
        try NativeRecordValidation.revision(revision)
        try NativeRecordValidation.revision(selectionRevision, allowZero: true)
        guard selectionRevision <= revision else { throw NativeRecordValidation.Failure.malformed }
        if let activeRunID { try NativeRecordValidation.uuid(activeRunID) }
    }
}

public struct NativeVirtualRun: Codable, Equatable, Sendable, Identifiable {
    public enum Status: String, Codable, Sendable { case active, abandoned, completed }
    public let schemaVersion: Int
    public let id: String
    public let revision: Int64
    public let trailID: String
    public let trailRevision: Int64
    public let name: String
    public let totalMiles: Double
    public let miles: Double
    public let status: Status
    public let startedAtMs: Int64
    public let createdAt: NativeServerTime
    public let updatedAt: NativeServerTime
    public let completedAtMs: Int64?
    public let completedAt: NativeServerTime?
    public let completionPoints: Int?
    public var meters: Double { miles * 1609.344 }
    public var totalMeters: Double { totalMiles * 1609.344 }
    public var fraction: Double { min(1, max(0, miles / totalMiles)) }
    public func validate() throws {
        try NativeRecordValidation.uuid(id)
        try NativeRecordValidation.identifier(trailID)
        try NativeRecordValidation.revision(revision)
        try NativeRecordValidation.revision(trailRevision)
        try NativeRecordValidation.date(startedAtMs)
        guard schemaVersion == 1, !name.isEmpty, name.utf16.count <= 200,
            miles.isFinite, (0...Double(NativeRecordValidation.maximumInteger)).contains(miles),
            totalMiles.isFinite, totalMiles > 0, totalMiles <= Double(NativeRecordValidation.maximumInteger),
            createdAt <= updatedAt
        else { throw NativeRecordValidation.Failure.malformed }
        if status == .completed {
            guard let completedAtMs, let completedAt, completedAt <= updatedAt,
                completionPoints == 1, miles >= totalMiles
            else { throw NativeRecordValidation.Failure.malformed }
            try NativeRecordValidation.date(completedAtMs)
        } else if completedAtMs != nil || completedAt != nil || completionPoints != nil {
            throw NativeRecordValidation.Failure.malformed
        }
    }
}
