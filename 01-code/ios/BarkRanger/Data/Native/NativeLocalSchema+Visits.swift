import Foundation
import SwiftData

extension NativeLocalSchema {
    @Model final class Progress {
        @Attribute(.unique) var key: String
        var revision: Int64
        var payload: Data
        init(revision: Int64, payload: Data) {
            key = "progress"
            self.revision = revision
            self.payload = payload
        }
    }
    @Model final class Visit {
        #Index<Visit>([\.isTombstone, \.happenedAtMs, \.id], [\.lastAccess], [\.siteID])
        @Attribute(.unique) var id: String
        var siteID: String
        var revision: Int64
        // Avoid Core Data's built-in `deleted` property/getter.
        var isTombstone: Bool
        var happenedAtMs: Int64
        var lastAccess: Date
        var payload: Data
        init(
            id: String, siteID: String, revision: Int64, isTombstone: Bool, happenedAtMs: Int64, payload: Data
        ) {
            self.id = id
            self.siteID = siteID
            self.revision = revision
            self.isTombstone = isTombstone
            self.happenedAtMs = happenedAtMs
            self.payload = payload
            lastAccess = Date()
        }
    }
    @Model final class PlaceProgress {
        #Index<PlaceProgress>([\.visited, \.id], [\.officialPlaceID])
        @Attribute(.unique) var id: String
        var officialPlaceID: String
        var revision: Int64
        var visitID: String?
        var visited: Bool
        var verified: Bool
        var payload: Data
        init(
            id: String, officialPlaceID: String, revision: Int64, visitID: String?, visited: Bool,
            verified: Bool, payload: Data
        ) {
            self.id = id
            self.officialPlaceID = officialPlaceID
            self.revision = revision
            self.visitID = visitID
            self.visited = visited
            self.verified = verified
            self.payload = payload
        }
    }
    @Model final class MarkerCursor {
        @Attribute(.unique) var key: String
        var request: Data
        init(request: Data) {
            key = "markers"
            self.request = request
        }
    }
}
