import BarkDomain
import Foundation
import SwiftData

/// First installed native schema. One account document atomically contains baseline and concrete outbox.
nonisolated enum LocalSchema: VersionedSchema {
    static var versionIdentifier: Schema.Version { .init(1, 0, 0) }
    static var models: [any PersistentModel.Type] { [AccountRecord.self] }

    @Model final class AccountRecord {
        @Attribute(.unique) var uid: String
        var payload: Data
        init(uid: String, payload: Data) {
            self.uid = uid
            self.payload = payload
        }
    }
}

/// Version the encoded payload independently of SwiftData's unchanged account-record schema.
/// Unversioned Phase 3 bytes are v0; never infer a fresh account from unreadable saved data.
nonisolated enum PersonalPayload {
    enum Failure: Error { case unsupportedVersion, unreadable }
    private struct Envelope: Codable {
        let version: Int
        let state: PersonalState
        private enum CodingKeys: String, CodingKey { case version }
        init(_ state: PersonalState) {
            version = 4
            self.state = state
        }
        init(from decoder: any Decoder) throws {
            let fields = try decoder.container(keyedBy: CodingKeys.self)
            if fields.contains(.version) {
                version = try fields.decode(Int.self, forKey: .version)
                guard (1...4).contains(version) else { throw Failure.unsupportedVersion }
            } else {
                version = 0
            }
            state = try PersonalState(from: decoder)
        }
        func encode(to encoder: any Encoder) throws {
            // Keep root fields for lossless upgrades; older builds must not misread a partial trip library.
            try state.encode(to: encoder)
            var fields = encoder.container(keyedBy: CodingKeys.self)
            try fields.encode(version, forKey: .version)
        }
    }
    static func decode(_ bytes: Data) throws -> PersonalState {
        do { return try JSONDecoder().decode(Envelope.self, from: bytes).state } catch let failure as Failure
        { throw failure } catch { throw Failure.unreadable }
    }
    static func encode(_ state: PersonalState) throws -> Data {
        try JSONEncoder().encode(Envelope(state))
    }
}
