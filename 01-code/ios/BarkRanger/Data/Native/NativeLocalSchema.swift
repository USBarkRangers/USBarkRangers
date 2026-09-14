import Foundation
import SwiftData

/// Independent entity rows and durable operations, not a serialized account object.
/// J1–J5: new journal/media entities get their own rows. Never cache-evict drafts or pending intents.
nonisolated enum NativeLocalSchema: VersionedSchema {
    static var versionIdentifier: Schema.Version { .init(1, 2, 0) }
    static var models: [any PersistentModel.Type] {
        [
            Metadata.self, Profile.self, Entitlement.self, PendingOperation.self,
            TripMetadata.self, TripContent.self, PlanningNote.self, Draft.self, Selection.self,
            TripCursor.self, TripRebuild.self, DraftImport.self,
            Progress.self, Visit.self, PlaceProgress.self, MarkerCursor.self,
            ExpeditionState.self, Activity.self, VirtualRun.self, CompletedTrail.self, ActivityClaim.self,
            ActivityCursor.self, SavedPin.self, SavedPinCursor.self,
        ]
    }

    @Model final class Metadata {
        @Attribute(.unique) var key: String
        var sequence: Int64
        init(scope: String) {
            key = scope
            sequence = 0
        }
    }

    @Model final class Profile {
        @Attribute(.unique) var key: String
        var revision: Int64
        var payload: Data
        init(revision: Int64, payload: Data) {
            key = "profile"
            self.revision = revision
            self.payload = payload
        }
    }

    @Model final class PendingOperation {
        #Index<PendingOperation>([\.entityKey, \.sequence], [\.predecessor])
        @Attribute(.unique) var id: String
        // Do not use `entity`: Core Data treats that key path as model metadata.
        var entityKey: String
        var sequence: Int64
        var createdAtMs: Int64
        var intent: Data
        var listSummary: Data?
        var draftFingerprint: String?
        var predecessor: String?
        var expectedRevision: Int64?
        var sealedBytes: Data?
        var state: String
        var failureCode: String?
        var attempts: Int
        var nextAttemptAt: Date

        init(
            id: String, entityKey: String, sequence: Int64, createdAtMs: Int64, intent: Data,
            predecessor: String?, expectedRevision: Int64?
        ) {
            self.id = id
            self.entityKey = entityKey
            self.sequence = sequence
            self.createdAtMs = createdAtMs
            self.intent = intent
            self.predecessor = predecessor
            self.expectedRevision = expectedRevision
            state = "queued"
            attempts = 0
            nextAttemptAt = .distantPast
        }
    }

    @Model final class Entitlement {
        @Attribute(.unique) var key: String
        var revision: Int64
        var payload: Data
        init(revision: Int64, payload: Data) {
            key = "entitlement"
            self.revision = revision
            self.payload = payload
        }
    }

    @Model final class TripMetadata {
        #Index<TripMetadata>([\.createdSeconds, \.createdNanos, \.id], [\.updatedAt, \.id])
        @Attribute(.unique) var id: String
        var revision: Int64
        var contentRevision: Int64
        var createdAt: Date
        var createdSeconds: Int64
        var createdNanos: Int32
        var updatedAt: Date
        // `deleted` is NSManagedObject lifecycle metadata, not a safe persistent key.
        var isTombstone: Bool
        var payload: Data
        init(
            id: String, revision: Int64, contentRevision: Int64, createdSeconds: Int64, createdNanos: Int32,
            createdAt: Date, updatedAt: Date, isTombstone: Bool, payload: Data
        ) {
            self.id = id
            self.revision = revision
            self.contentRevision = contentRevision
            self.createdSeconds = createdSeconds
            self.createdNanos = createdNanos
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.isTombstone = isTombstone
            self.payload = payload
        }
    }

    @Model final class TripContent {
        #Index<TripContent>([\.lastAccess])
        @Attribute(.unique) var id: String
        var revision: Int64
        var bytes: Data
        // Additive optional field: old detail has unknown freshness, not an invented
        // current revision. Lightweight upgrade preserves all drafts and sealed intents.
        var readStamp: Data? = nil
        var byteCount: Int
        var lastAccess: Date
        init(id: String, revision: Int64, bytes: Data) {
            self.id = id
            self.revision = revision
            self.bytes = bytes
            byteCount = bytes.count
            lastAccess = Date()
        }
    }

    @Model final class PlanningNote {
        #Index<PlanningNote>([\.tripID, \.id])
        @Attribute(.unique) var id: String
        var tripID: String
        var revision: Int64
        var bytes: Data
        init(id: String, tripID: String, revision: Int64, bytes: Data) {
            self.id = id
            self.tripID = tripID
            self.revision = revision
            self.bytes = bytes
        }
    }

    @Model final class Draft {
        #Index<Draft>([\.updatedAt, \.id], [\.dirty])
        @Attribute(.unique) var id: String
        var editRevision: Int64
        var title: String
        var dayCount: Int
        var stopCount: Int
        var dirty: Bool
        var updatedAt: Date
        var bytes: Data
        var transferOwner: String?
        init(
            id: String, editRevision: Int64, title: String, dayCount: Int, stopCount: Int, dirty: Bool,
            bytes: Data
        ) {
            self.id = id
            self.editRevision = editRevision
            self.title = title
            self.dirty = dirty
            self.dayCount = dayCount
            self.stopCount = stopCount
            self.bytes = bytes
            updatedAt = Date()
        }
    }

    /// Receipt for a local guest handoff, not a cloud operation or another draft copy.
    @Model final class DraftImport {
        @Attribute(.unique) var id: String
        init(_ id: String) { self.id = id }
    }

    @Model final class Selection {
        @Attribute(.unique) var key: String
        var tripID: String?
        var dayID: String?
        init(tripID: String?, dayID: String?) {
            key = "selection"
            self.tripID = tripID
            self.dayID = dayID
        }
    }

    @Model final class TripCursor {
        @Attribute(.unique) var key: String
        var request: Data
        var rebuilding: Bool
        init(request: Data, rebuilding: Bool) {
            key = "trips"
            self.request = request
            self.rebuilding = rebuilding
        }
    }

    /// A bounded unpublished cache generation. Never contains drafts or pending intents.
    @Model final class TripRebuild {
        #Index<TripRebuild>([\.createdSeconds, \.createdNanos, \.id])
        @Attribute(.unique) var id: String
        var createdSeconds: Int64
        var createdNanos: Int32
        var payload: Data
        init(id: String, createdSeconds: Int64, createdNanos: Int32, payload: Data) {
            self.id = id
            self.createdSeconds = createdSeconds
            self.createdNanos = createdNanos
            self.payload = payload
        }
    }
}
