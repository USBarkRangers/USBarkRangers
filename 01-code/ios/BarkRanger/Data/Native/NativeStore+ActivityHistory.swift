import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func activityChangesQuery() throws -> NativeChangeQuery? {
        try requireOpen()
        guard let data = try activityCursorRow()?.request else { return nil }
        let value = try JSONDecoder().decode(NativeChangeQuery.self, from: data)
        try value.validate()
        return value
    }
    /// False means this response predates accepted deletion/reconciliation evidence.
    /// The caller must refresh instead of advancing a history cursor from that page.
    func acceptNativeActivityHistory(
        _ page: NativeActivityPage, after cursor: NativeActivityPage.Cursor?, bootstrap: Bool = false
    ) throws -> Bool {
        try requireOpen()
        try page.validate(after: cursor)
        if let floor = try activityHistoryFloor(), page.readTime < floor { return false }
        if bootstrap, cursor != nil { throw Failure.invalidAcknowledgment }
        let existingCursor = try activityChangesQuery()
        let replacingHistory = bootstrap && existingCursor != nil
        do {
            if bootstrap {
                // Seed only the first history page, not every historical activity. Other
                // clean pages remain remotely pageable; pending work keeps its own source.
                var query = FetchDescriptor<NativeLocalSchema.Activity>()
                query.fetchLimit = 251
                let incoming = Set(page.items.map(\.id))
                for row in try modelContext.fetch(query) where !incoming.contains(row.id) {
                    if try decodeActivity(row).updatedAt <= page.readTime { modelContext.delete(row) }
                }
            }
            for item in page.items { try stageActivity(item) }
            if bootstrap {
                let row = try activityCursorRow() ?? NativeLocalSchema.ActivityCursor()
                if row.modelContext == nil { modelContext.insert(row) }
                row.request = try JSONEncoder().encode(NativeChangeQuery(since: page.readTime))
                try advanceActivityHistoryFloor(page.readTime)
            }
            try stageActivityCacheRetention()
            try commit()
            publish(replacingHistory ? [.activityHistory, .activityHistoryReset] : [.activityHistory])
            return true
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func acceptNativeActivityClaims(_ claims: NativeActivityClaims, requested: [String]) throws {
        try requireOpen()
        try claims.validate(for: requested)
        do {
            for id in claims.claimedIDs { try stageActivityClaim(id) }
            try stageActivityCacheRetention()
            try commit()
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func advanceActivityHistoryFloor(_ value: NativeServerTime) throws {
        if let previous = try activityHistoryFloor(), value <= previous { return }
        let row = try activityCursorRow() ?? NativeLocalSchema.ActivityCursor()
        if row.modelContext == nil { modelContext.insert(row) }
        row.historyFloor = try JSONEncoder().encode(value)
    }
    func activityHistoryFloor() throws -> NativeServerTime? {
        try activityCursorRow()?.historyFloor.map {
            try JSONDecoder().decode(NativeServerTime.self, from: $0)
        }
    }
    func activityCursorRow() throws -> NativeLocalSchema.ActivityCursor? {
        var query = FetchDescriptor<NativeLocalSchema.ActivityCursor>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1, rows.first == nil || rows.first?.key == "activities" else {
            throw Failure.corrupt
        }
        return rows.first
    }
}
