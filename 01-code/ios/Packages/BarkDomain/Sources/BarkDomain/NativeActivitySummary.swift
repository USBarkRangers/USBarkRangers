import Foundation

/// Exact new-activity wire input, independent of mutable display corrections.
public struct NativeActivitySummary: Codable, Equatable, Sendable {
    public let activityID: String
    public let source: WalkSummary.Source
    public let startedAtMs: Int64
    public let endedAtMs: Int64
    public let meters: Double
    public let elapsedSeconds: Double
    public let runID: String?
    public init(_ walk: WalkSummary) throws {
        activityID = walk.id
        source = walk.source
        startedAtMs = try NativeRecordValidation.milliseconds(walk.startedAt)
        endedAtMs = try NativeRecordValidation.milliseconds(walk.endedAt)
        meters = walk.meters
        elapsedSeconds = walk.elapsedSeconds
        runID = walk.runID
        try validate()
    }
    public init(record: NativeActivityRecord) throws {
        try record.validate()
        guard let details = record.details else { throw NativeRecordValidation.Failure.malformed }
        activityID = record.id
        source = details.source
        startedAtMs = details.startedAtMs
        endedAtMs = details.endedAtMs
        meters = details.originalMeters
        elapsedSeconds = details.elapsedSeconds
        runID = details.runID
        try validate()
    }
    public func validate() throws {
        try NativeRecordValidation.uuid(activityID)
        if let runID { try NativeRecordValidation.uuid(runID) }
        try NativeRecordValidation.date(startedAtMs)
        try NativeRecordValidation.date(endedAtMs)
        let duration = Double(endedAtMs - startedAtMs) / 1000
        guard (0...604_800).contains(duration), meters.isFinite, meters > 0, meters <= 500_000,
            elapsedSeconds.isFinite, (0...(duration + 1)).contains(elapsedSeconds)
        else { throw NativeRecordValidation.Failure.malformed }
        if source == .manual {
            guard meters <= 15 * 1609.344 + 0.01 else { throw NativeRecordValidation.Failure.malformed }
        } else if elapsedSeconds <= 0 || meters / elapsedSeconds > 8.94 {
            throw NativeRecordValidation.Failure.malformed
        }
    }
    enum CodingKeys: String, CodingKey {
        case activityID, source, startedAtMs, endedAtMs, meters, elapsedSeconds, runID
    }
    public func encode(to encoder: any Encoder) throws {
        try validate()
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(activityID, forKey: .activityID)
        try values.encode(source, forKey: .source)
        try values.encode(startedAtMs, forKey: .startedAtMs)
        try values.encode(endedAtMs, forKey: .endedAtMs)
        try values.encode(meters, forKey: .meters)
        try values.encode(elapsedSeconds, forKey: .elapsedSeconds)
        try values.encode(runID, forKey: .runID)  // Explicit null is part of the command contract.
    }
}
