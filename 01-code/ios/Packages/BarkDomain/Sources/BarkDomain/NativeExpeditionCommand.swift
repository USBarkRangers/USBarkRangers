import Foundation

public struct NativeExpeditionCommand: Encodable, Sendable {
    public let id: UUID
    public let createdAtMs: Int64
    public let action: NativeExpeditionAction
    public init(id: UUID, createdAtMs: Int64, action: NativeExpeditionAction) {
        self.id = id
        self.createdAtMs = createdAtMs
        self.action = action
    }
    enum CodingKeys: String, CodingKey {
        case version, operationID, createdAtMs, kind, expectedRevision, payload
    }
    enum PayloadKeys: String, CodingKey {
        case trailID, runID, expectedActiveRunID, activityID, meters, happenedAtMs, trailName
    }
    public func encode(to encoder: any Encoder) throws {
        try action.validate()
        try NativeRecordValidation.date(createdAtMs)
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(1, forKey: .version)
        try values.encode(id.uuidString.lowercased(), forKey: .operationID)
        try values.encode(createdAtMs, forKey: .createdAtMs)
        try values.encode(action.kind, forKey: .kind)
        try values.encode(action.expectedRevision, forKey: .expectedRevision)
        if case .record(let summary) = action {
            try values.encode(summary, forKey: .payload)
            return
        }
        var payload = values.nestedContainer(keyedBy: PayloadKeys.self, forKey: .payload)
        switch action {
        case .assign(let trail, let run, _, let previous):
            try payload.encode(trail, forKey: .trailID)
            try payload.encode(run, forKey: .runID)
            try payload.encode(previous, forKey: .expectedActiveRunID)
        case .edit(let id, _, let meters, let date, let name):
            try payload.encode(id, forKey: .activityID)
            try payload.encode(meters, forKey: .meters)
            try payload.encode(date, forKey: .happenedAtMs)
            try payload.encode(name, forKey: .trailName)
        case .remove(let id, _): try payload.encode(id, forKey: .activityID)
        case .claim(let id, _): try payload.encode(id, forKey: .runID)
        case .record: break
        }
    }
}

public struct NativeExpeditionOutcome: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable { case accepted, conflict }
    public struct Revisions: Codable, Equatable, Sendable {
        public let state: Int64
        public let selection: Int64
        public let progress: Int64
        public let activity: Int64
        public let run: Int64
        public let activityClaim: Int
    }
    public let version: Int
    public let operationID: UUID
    public let status: Status
    public let revisions: Revisions
    public func validate() throws {
        guard version == 1, (0...1).contains(revisions.activityClaim), revisions.selection <= revisions.state
        else {
            throw NativeRecordValidation.Failure.malformed
        }
        for revision in [
            revisions.state, revisions.selection, revisions.progress, revisions.activity, revisions.run,
        ] {
            try NativeRecordValidation.revision(revision, allowZero: true)
        }
    }
}
