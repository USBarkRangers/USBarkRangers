import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func markerChangesQuery() throws -> NativeChangeQuery {
        try requireOpen()
        guard let row = try markerCursorRow() else { return .init() }
        let value = try JSONDecoder().decode(NativeChangeQuery.self, from: row.request)
        try value.validate()
        return value
    }
    /// Page contents and cursor advance share one commit. Fixed server upper bound and
    /// inclusive next-scan overlap prevent same-timestamp skips or device-clock gaps.
    func acceptMarkerChanges(_ page: NativePlaceProgressChanges, requested: NativeChangeQuery) throws -> Bool
    {
        try requireOpen()
        try page.validate(for: requested)
        guard try markerChangesQuery() == requested else { return false }
        do {
            var changes: Set<Change> = [.markers, .visitHistory]
            for marker in page.items {
                let previous = try nativePlaceProgress(siteID: marker.id)
                if marker.revision > (previous?.revision ?? 0) {
                    // A remote date/replacement can invalidate a cached detail and
                    // reorder history. Only an open history screen refetches a page.
                    changes.insert(.visitHistoryReset)
                }
                if let id = previous?.visitID { changes.insert(.visit(id)) }
                if let id = marker.visitID { changes.insert(.visit(id)) }
            }
            for marker in page.items { try stagePlaceProgress(marker) }
            let next: NativeChangeQuery =
                page.next.map { .init(since: requested.since, upper: page.upper, after: $0) }
                ?? .init(since: page.upper)
            let bytes = try JSONEncoder().encode(next)
            if let row = try markerCursorRow() {
                row.request = bytes
            } else {
                modelContext.insert(NativeLocalSchema.MarkerCursor(request: bytes))
            }
            try commit()
            publish(changes)
            return true
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    private func markerCursorRow() throws -> NativeLocalSchema.MarkerCursor? {
        var query = FetchDescriptor<NativeLocalSchema.MarkerCursor>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1, rows.first == nil || rows.first?.key == "markers" else {
            throw Failure.corrupt
        }
        return rows.first
    }
}
