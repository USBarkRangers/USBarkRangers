import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func nativeProgress() throws -> NativeProgress? {
        try requireOpen()
        guard let row = try progressRow() else { return nil }
        let value = try JSONDecoder().decode(NativeProgress.self, from: row.payload)
        try value.validate()
        guard row.key == "progress", row.revision == value.revision else { throw Failure.corrupt }
        return value
    }
    func nativeVisit(id: String) throws -> NativeVisitRecord? {
        try requireOpen()
        return try visitRow(id).map(decodeVisit)
    }
    func nativePlaceProgress(siteID: String) throws -> NativePlaceProgress? {
        try requireOpen()
        return try placeProgressRow(siteID).map(decodePlaceProgress)
    }
    func nativeVisitHistory(before cursor: NativeVisitPage.Cursor? = nil) throws -> [NativeVisitRecord] {
        try requireOpen()
        let at = cursor?.happenedAtMs ?? Int64.max
        let id = cursor?.id ?? "~"
        var query = FetchDescriptor<NativeLocalSchema.Visit>(
            predicate: #Predicate {
                !$0.isTombstone && ($0.happenedAtMs < at || ($0.happenedAtMs == at && $0.id < id))
            },
            sortBy: [SortDescriptor(\.happenedAtMs, order: .reverse), SortDescriptor(\.id, order: .reverse)])
        query.fetchLimit = 50
        return try modelContext.fetch(query).map(decodeVisit)
    }
    /// Current official-site marker facts only, not history, notes or private journal pins.
    func nativeMarkers(after id: String = "") throws -> [NativePlaceProgress] {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.PlaceProgress>(
            predicate: #Predicate {
                $0.visited && $0.id > id
            }, sortBy: [SortDescriptor(\.id)])
        query.fetchLimit = 100
        return try modelContext.fetch(query).map(decodePlaceProgress)
    }
    func progressRow() throws -> NativeLocalSchema.Progress? {
        var query = FetchDescriptor<NativeLocalSchema.Progress>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1 else { throw Failure.corrupt }
        return rows.first
    }
    func visitRow(_ id: String) throws -> NativeLocalSchema.Visit? {
        var query = FetchDescriptor<NativeLocalSchema.Visit>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 1
        return try modelContext.fetch(query).first
    }
    func placeProgressRow(_ id: String) throws -> NativeLocalSchema.PlaceProgress? {
        var query = FetchDescriptor<NativeLocalSchema.PlaceProgress>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 1
        return try modelContext.fetch(query).first
    }
    func decodeVisit(_ row: NativeLocalSchema.Visit) throws -> NativeVisitRecord {
        let value = try JSONDecoder().decode(NativeVisitRecord.self, from: row.payload)
        try value.validate()
        guard row.id == value.id, row.revision == value.revision, row.siteID == value.siteID,
            row.isTombstone == value.deleted, row.happenedAtMs == (value.details?.happenedAtMs ?? 0)
        else { throw Failure.corrupt }
        return value
    }
    func decodePlaceProgress(_ row: NativeLocalSchema.PlaceProgress) throws -> NativePlaceProgress {
        let value = try JSONDecoder().decode(NativePlaceProgress.self, from: row.payload)
        try value.validate()
        guard row.id == value.id, row.revision == value.revision,
            row.officialPlaceID == value.officialPlaceID,
            row.visitID == value.visitID, row.visited == value.visited, row.verified == value.verified
        else { throw Failure.corrupt }
        return value
    }
}
