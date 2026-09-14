import Foundation

public enum NativeVisitOperation: Codable, Equatable, Sendable {
    public struct Keys: Codable, Equatable, Sendable {
        public let siteIDs: [String]
        public let isBulk: Bool
        public func validate() throws {
            guard (1...500).contains(siteIDs.count), siteIDs == siteIDs.sorted(),
                Set(siteIDs).count == siteIDs.count,
                isBulk || siteIDs.count == 1
            else { throw NativeRecordValidation.Failure.malformed }
            for id in siteIDs { try NativeRecordValidation.identifier(id) }
        }
    }
    case single(NativeVisitChange)
    case removeMany([NativeVisitChange])
    public var changes: [NativeVisitChange] {
        switch self {
        case .single(let change): [change]
        case .removeMany(let changes): changes
        }
    }
    public var isBulk: Bool { if case .removeMany = self { true } else { false } }
    public var siteIDs: [String] { changes.map { $0.intent.target.siteID }.sorted() }
    public var keys: Keys { .init(siteIDs: siteIDs, isBulk: isBulk) }
    public func validate() throws {
        let values = changes
        guard (1...500).contains(values.count), Set(siteIDs).count == values.count,
            Set(values.map { $0.intent.target.visitID }).count == values.count
        else { throw NativeRecordValidation.Failure.malformed }
        for change in values {
            try change.validate()
            if isBulk, change.intent.edit != .remove { throw NativeRecordValidation.Failure.malformed }
        }
    }
    public func commandBytes(id: UUID, createdAtMs: Int64) throws -> Data {
        try validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        switch self {
        case .single(let change):
            return try encoder.encode(
                NativeVisitCommand(operationID: id, createdAtMs: createdAtMs, intent: change.intent))
        case .removeMany(let changes):
            return try encoder.encode(BulkCommand(id: id, createdAtMs: createdAtMs, changes: changes))
        }
    }
    private struct BulkCommand: Encodable {
        let version = 1
        let operationID: String
        let createdAtMs: Int64
        let kind = "deleteVisits"
        let expectedRevision = 0
        let payload: Payload
        struct Payload: Encodable { let visits: [Item] }
        struct Item: Encodable {
            let visitID: String
            let officialPlaceID: String
            let expectedRevision: Int64
        }
        init(id: UUID, createdAtMs: Int64, changes: [NativeVisitChange]) throws {
            try NativeRecordValidation.revision(createdAtMs, allowZero: true)
            operationID = id.uuidString.lowercased()
            self.createdAtMs = createdAtMs
            payload = Payload(
                visits: changes.map {
                    .init(
                        visitID: $0.intent.target.visitID,
                        officialPlaceID: $0.intent.target.officialPlaceID,
                        expectedRevision: $0.intent.target.visitRevision)
                })
        }
    }
}

public struct NativeBulkVisitOutcome: Codable, Equatable, Sendable {
    public let version: Int
    public let operationID: UUID
    public let status: NativeVisitOutcome.Status
    public let revisions: Revisions
    public struct Revisions: Codable, Equatable, Sendable {
        public let visits: [String: Int64]
        public let places: [String: Int64]
        public let progress: Int64
    }
    public func validate() throws {
        guard version == 1, (1...500).contains(revisions.visits.count),
            (1...500).contains(revisions.places.count)
        else {
            throw NativeRecordValidation.Failure.malformed
        }
        try NativeRecordValidation.revision(revisions.progress, allowZero: true)
        for (id, revision) in Array(revisions.visits) + Array(revisions.places) {
            try NativeRecordValidation.identifier(id)
            try NativeRecordValidation.revision(revision, allowZero: true)
        }
    }
}
