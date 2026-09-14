import Foundation
import SwiftData

extension NativeLocalSchema {
    @Model final class ExpeditionState {
        @Attribute(.unique) var key: String
        var revision: Int64
        var payload: Data
        init(revision: Int64, payload: Data) {
            key = "expedition"
            self.revision = revision
            self.payload = payload
        }
    }
    @Model final class Activity {
        #Index<Activity>([\.isTombstone, \.happenedAtMs, \.id], [\.lastAccess])
        @Attribute(.unique) var id: String
        var revision: Int64
        var isTombstone: Bool
        var happenedAtMs: Int64
        var lastAccess: Date
        var payload: Data
        init(id: String, revision: Int64, isTombstone: Bool, happenedAtMs: Int64, payload: Data) {
            self.id = id
            self.revision = revision
            self.isTombstone = isTombstone
            self.happenedAtMs = happenedAtMs
            self.payload = payload
            lastAccess = Date()
        }
    }
    @Model final class VirtualRun {
        #Index<VirtualRun>([\.lastAccess])
        @Attribute(.unique) var id: String
        var revision: Int64
        var payload: Data
        var lastAccess: Date
        init(id: String, revision: Int64, payload: Data) {
            self.id = id
            self.revision = revision
            self.payload = payload
            lastAccess = Date()
        }
    }
    @Model final class CompletedTrail {
        @Attribute(.unique) var id: String
        var payload: Data
        init(id: String, payload: Data) {
            self.id = id
            self.payload = payload
        }
    }
    @Model final class ActivityClaim {
        #Index<ActivityClaim>([\.lastAccess])
        @Attribute(.unique) var id: String
        var lastAccess: Date
        init(id: String) {
            self.id = id
            lastAccess = Date()
        }
    }
    @Model final class ActivityCursor {
        @Attribute(.unique) var key: String
        var request: Data?
        var historyFloor: Data?
        init() { key = "activities" }
    }
}
