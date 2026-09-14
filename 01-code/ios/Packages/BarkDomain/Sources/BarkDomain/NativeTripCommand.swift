import Foundation

public struct NativeTripCommand: Encodable, Sendable {
    public let operationID: UUID
    public let createdAtMs: Int64
    public let expectedRevision: Int64
    public let intent: NativeTripIntent
    public init(operationID: UUID, createdAtMs: Int64, expectedRevision: Int64, intent: NativeTripIntent) {
        self.operationID = operationID
        self.createdAtMs = createdAtMs
        self.expectedRevision = expectedRevision
        self.intent = intent
    }
    public func encode(to encoder: any Encoder) throws {
        try intent.validate()
        guard (0...9_007_199_254_740_991).contains(createdAtMs), expectedRevision == intent.baseRevision
        else {
            throw Trip.Failure.malformed
        }
        var values = encoder.container(keyedBy: Keys.self)
        try values.encode(1, forKey: .version)
        try values.encode(operationID.uuidString.lowercased(), forKey: .operationID)
        try values.encode(createdAtMs, forKey: .createdAtMs)
        try values.encode(expectedRevision, forKey: .expectedRevision)
        switch intent {
        case .save(let draft):
            guard let base = draft.nativeBase else { throw Trip.Failure.malformed }
            try values.encode("saveTrip", forKey: .kind)
            try values.encode(NativeTripSave(trip: draft.trip, baseNotes: base.notes), forKey: .payload)
        case .notes(let draft):
            guard let notes = try NativeTripNotes(draft: draft) else { throw Trip.Failure.malformed }
            try values.encode("saveTripNotes", forKey: .kind)
            try values.encode(notes, forKey: .payload)
        case .delete(let id, _):
            try values.encode("deleteTrip", forKey: .kind)
            try values.encode(["tripID": id], forKey: .payload)
        }
    }
    private enum Keys: String, CodingKey {
        case version, operationID, createdAtMs, expectedRevision, kind, payload
    }
}
