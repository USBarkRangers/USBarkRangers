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
