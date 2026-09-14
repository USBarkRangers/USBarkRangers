import Foundation

/// A sealed request. Encode once before its first submission; retries reuse these exact bytes and ID.
public struct NativeProfileCommand: Encodable, Equatable, Sendable {
    public let operationID: UUID
    public let createdAtMs: Int64
    public let expectedRevision: Int64
    public let edit: NativeProfileEdit

    public init(operationID: UUID, createdAtMs: Int64, expectedRevision: Int64, edit: NativeProfileEdit) {
        self.operationID = operationID
        self.createdAtMs = createdAtMs
        self.expectedRevision = expectedRevision
        self.edit = edit
    }

    public func encode(to encoder: any Encoder) throws {
        try edit.validate()
        guard (0...9_007_199_254_740_991).contains(expectedRevision),
            (0...9_007_199_254_740_991).contains(createdAtMs)
        else { throw NativeProfileEdit.Failure.invalid }
        var values = encoder.container(keyedBy: Keys.self)
        try values.encode(1, forKey: .version)
        try values.encode(operationID.uuidString.lowercased(), forKey: .operationID)
        try values.encode(createdAtMs, forKey: .createdAtMs)
        try values.encode(expectedRevision, forKey: .expectedRevision)
        try values.encode(edit.commandKind, forKey: .kind)
        var payload = values.nestedContainer(keyedBy: PayloadKeys.self, forKey: .payload)
        switch edit {
        case .bootstrap: break
        case .displayName(let name): try payload.encode(name, forKey: .displayName)
        case .mapStyle(let style): try payload.encode(style, forKey: .mapStyle)
        }
    }

    private enum Keys: String, CodingKey {
        case version, operationID, createdAtMs, expectedRevision, kind, payload
    }
    private enum PayloadKeys: String, CodingKey { case displayName, mapStyle }
}
