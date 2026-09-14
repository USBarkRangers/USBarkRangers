import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func nativeExpeditionState() throws -> NativeExpeditionState? {
        try requireOpen()
        guard let row = try expeditionRow() else { return nil }
        // Revision zero is local cache metadata for a confirmed absent resource,
        // not a fabricated NativeExpeditionState or an optimistic server revision.
        if row.revision == 0 {
            guard row.key == "expedition", row.payload == Data("null".utf8) else { throw Failure.corrupt }
            return nil
        }
        let value = try JSONDecoder().decode(NativeExpeditionState.self, from: row.payload)
        try value.validate()
        guard row.key == "expedition", row.revision == value.revision else { throw Failure.corrupt }
        return value
    }
    func nativeActivity(id: String) throws -> NativeActivityRecord? {
        try requireOpen()
        return try activityRow(id).map(decodeActivity)
    }
    func nativeVirtualRun(id: String) throws -> NativeVirtualRun? {
        try requireOpen()
        guard let row = try virtualRunRow(id) else { return nil }
        let value = try JSONDecoder().decode(NativeVirtualRun.self, from: row.payload)
        try value.validate()
        guard row.id == value.id, row.revision == value.revision else { throw Failure.corrupt }
        return value
    }
    func nativeActivityHistory(before cursor: NativeActivityPage.Cursor? = nil) throws
        -> [NativeActivityRecord]
    {
        try requireOpen()
        let at = cursor?.happenedAtMs ?? Int64.max
        let id = cursor?.id ?? "~"
        var query = FetchDescriptor<NativeLocalSchema.Activity>(
            predicate: #Predicate {
                !$0.isTombstone && ($0.happenedAtMs < at || ($0.happenedAtMs == at && $0.id < id))
            },
            sortBy: [SortDescriptor(\.happenedAtMs, order: .reverse), SortDescriptor(\.id, order: .reverse)])
        query.fetchLimit = 50
        return try modelContext.fetch(query).map(decodeActivity)
    }
    func knownNativeActivityIDs(_ ids: Set<String>) throws -> Set<String> {
        try requireOpen()
        guard ids.count <= 100 else { throw Failure.unavailable }
        let requested = Array(ids)
        var query = FetchDescriptor<NativeLocalSchema.ActivityClaim>(
            predicate: #Predicate { requested.contains($0.id) })
        query.fetchLimit = 101
        return Set(try modelContext.fetch(query).map(\.id))
    }
    func expeditionRow() throws -> NativeLocalSchema.ExpeditionState? {
        var query = FetchDescriptor<NativeLocalSchema.ExpeditionState>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1 else { throw Failure.corrupt }
        return rows.first
    }
    func activityRow(_ id: String) throws -> NativeLocalSchema.Activity? {
        var query = FetchDescriptor<NativeLocalSchema.Activity>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 1
        return try modelContext.fetch(query).first
    }
    func virtualRunRow(_ id: String) throws -> NativeLocalSchema.VirtualRun? {
        var query = FetchDescriptor<NativeLocalSchema.VirtualRun>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 1
        return try modelContext.fetch(query).first
    }
    func decodeActivity(_ row: NativeLocalSchema.Activity) throws -> NativeActivityRecord {
        let value = try JSONDecoder().decode(NativeActivityRecord.self, from: row.payload)
        try value.validate()
        guard row.id == value.id, row.revision == value.revision, row.isTombstone == value.deleted,
            row.happenedAtMs == (value.details?.happenedAtMs ?? 0)
        else { throw Failure.corrupt }
        return value
    }
}
