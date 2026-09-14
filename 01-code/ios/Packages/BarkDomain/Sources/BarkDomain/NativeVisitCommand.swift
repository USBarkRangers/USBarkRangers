import Foundation

public struct NativeVisitCommand: Encodable, Sendable {
    public let operationID: UUID
    public let createdAtMs: Int64
    public let intent: NativeVisitIntent
    public init(operationID: UUID, createdAtMs: Int64, intent: NativeVisitIntent) {
        self.operationID = operationID
        self.createdAtMs = createdAtMs
        self.intent = intent
    }
    public func encode(to encoder: any Encoder) throws {
        try intent.validate()
        try NativeRecordValidation.revision(createdAtMs, allowZero: true)
        var values = encoder.container(keyedBy: Keys.self)
        try values.encode(1, forKey: .version)
        try values.encode(operationID.uuidString.lowercased(), forKey: .operationID)
        try values.encode(createdAtMs, forKey: .createdAtMs)
        try values.encode(intent.target.visitRevision, forKey: .expectedRevision)
        var payload = values.nestedContainer(keyedBy: Payload.self, forKey: .payload)
        try payload.encode(intent.target.visitID, forKey: .visitID)
        try payload.encode(intent.target.officialPlaceID, forKey: .officialPlaceID)
        switch intent.edit {
        case .mark(let at, let zone, let proximity):
            try values.encode("markVisit", forKey: .kind)
            try payload.encode(intent.target.placeRevision, forKey: .expectedPlaceRevision)
            try payload.encode(at, forKey: .happenedAtMs)
            try payload.encode(zone, forKey: .timeZone)
            try payload.encodeIfPresent(proximity, forKey: .proximity)
        case .changeDate(let at, let zone):
            try values.encode("updateVisitDate", forKey: .kind)
            try payload.encode(at, forKey: .happenedAtMs)
            try payload.encode(zone, forKey: .timeZone)
        case .remove:
            try values.encode("deleteVisit", forKey: .kind)
        }
    }
    private enum Keys: String, CodingKey {
        case version, operationID, createdAtMs, expectedRevision, kind, payload
    }
    private enum Payload: String, CodingKey {
        case visitID, officialPlaceID, expectedPlaceRevision, happenedAtMs, timeZone, proximity
    }
}

public struct NativeVisitOutcome: Codable, Equatable, Sendable {
    public let version: Int
    public let operationID: UUID
    public let status: Status
    public let revisions: Revisions
    public enum Status: String, Codable, Sendable { case accepted, conflict }
    public struct Revisions: Codable, Equatable, Sendable {
        public let visit: Int64
        public let placeProgress: Int64
        public let progress: Int64
    }
    public func validate() throws {
        guard version == 1 else { throw NativeRecordValidation.Failure.malformed }
        try NativeRecordValidation.revision(revisions.visit, allowZero: true)
        try NativeRecordValidation.revision(revisions.placeProgress, allowZero: true)
        try NativeRecordValidation.revision(revisions.progress, allowZero: true)
    }
}
