import Foundation

/// Recoverable authored values. Revision may include earlier queued changes; this is
/// not a fabricated server record and carries no invented server timestamp.
public struct NativeActivityDraft: Codable, Equatable, Sendable, Identifiable {
    public let summary: NativeActivitySummary
    public let revision: Int64
    public let miles: Double
    public let happenedAtMs: Int64
    public let trailName: String
    public var id: String { summary.activityID }
    public var meters: Double { miles * 1609.344 }

    public init?(record: NativeActivityRecord) throws {
        guard let details = record.details else { return nil }
        summary = try NativeActivitySummary(record: record)
        revision = record.revision
        miles = details.miles
        happenedAtMs = details.happenedAtMs
        trailName = details.trailName
        try validate()
    }
    public init(summary: NativeActivitySummary, trailName: String) throws {
        self.summary = summary
        revision = 1
        miles = (summary.meters / 1609.344 * 100).rounded() / 100
        happenedAtMs = summary.endedAtMs
        self.trailName = trailName
        try validate()
    }
    private init(
        summary: NativeActivitySummary, revision: Int64, miles: Double,
        happenedAtMs: Int64, trailName: String
    ) {
        self.summary = summary
        self.revision = revision
        self.miles = miles
        self.happenedAtMs = happenedAtMs
        self.trailName = trailName
    }
    public func corrected(meters: Double, happenedAtMs: Int64, trailName: String) throws -> Self {
        let cap = summary.source == .manual ? 15 * 1609.344 : summary.meters
        guard meters.isFinite, meters >= 0, meters <= cap + 0.01,
            revision < NativeRecordValidation.maximumInteger
        else { throw NativeRecordValidation.Failure.malformed }
        let value = Self(
            summary: summary, revision: revision + 1, miles: meters / 1609.344,
            happenedAtMs: happenedAtMs, trailName: trailName)
        try value.validate()
        return value
    }
    public func validate() throws {
        try summary.validate()
        try NativeRecordValidation.revision(revision)
        try NativeRecordValidation.date(happenedAtMs)
        let cap = summary.source == .manual ? 15 * 1609.344 : summary.meters
        let initial = (summary.meters / 1609.344 * 100).rounded() / 100 * 1609.344
        guard miles.isFinite, miles >= 0, meters <= max(cap + 0.01, initial),
            !trailName.isEmpty, trailName.utf16.count <= 200
        else { throw NativeRecordValidation.Failure.malformed }
    }
}
