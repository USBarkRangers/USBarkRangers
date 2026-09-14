import Foundation

/// A summary carries no raw GPS or Health samples. Stable source IDs survive retries and imports.
public struct WalkSummary: Codable, Equatable, Sendable, Identifiable {
    public enum Source: String, Codable, CaseIterable, Sendable { case gps, pedometer, health, manual }
    public let id: String
    public let source: Source
    public let startedAt: Date
    public let endedAt: Date
    public let meters: Double
    public let elapsedSeconds: Double
    public let runID: String?
    public init(
        id: String = UUID().uuidString.lowercased(), source: Source, startedAt: Date,
        endedAt: Date, meters: Double, elapsedSeconds: Double, runID: String? = nil
    ) {
        self.id = id
        self.source = source
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.meters = meters
        self.elapsedSeconds = elapsedSeconds
        self.runID = runID
    }
    public var value: UserValue {
        .object([
            "id": .string(id), "source": .string(source.rawValue),
            "startedAt": .number(startedAt.timeIntervalSince1970 * 1000),
            "endedAt": .number(endedAt.timeIntervalSince1970 * 1000),
            "meters": .number(meters), "elapsedSeconds": .number(elapsedSeconds),
            "runID": runID.map(UserValue.string) ?? .null,
        ])
    }
}

/// Read existing records without rebuilding/dropping fields this version does not understand.
public struct WalkHistoryRecord: Identifiable, Equatable, Sendable {
    public let fields: [String: UserValue]
    public let id: String
    public init(fields: [String: UserValue], index: Int) {
        self.fields = fields
        let timestamp = fields["ts"]?.number.flatMap { value -> Int64? in
            guard value.isFinite, value >= 0, value < Double(Int64.max) else { return nil }
            return Int64(value)
        }
        id = fields["id"]?.string ?? timestamp.map { "legacy-\($0)" } ?? "unresolved-\(index)"
    }
    public var date: Date? { fields["ts"]?.date }
    public var meters: Double { (fields["miles"]?.expeditionNumber ?? 0) * 1609.344 }
    public var trailName: String { fields["trailName"]?.string ?? "General Walk" }
    public var source: String { fields["type"]?.string ?? "Historical walk" }
    public var editable: Bool { date != nil && fields["miles"]?.expeditionNumber != nil }
    public var pointMiles: Double {
        if let explicit = fields["pointMiles"]?.number { return max(0, explicit) }
        return source.lowercased().contains("manual") ? 0 : max(0, meters / 1609.344)
    }
}
