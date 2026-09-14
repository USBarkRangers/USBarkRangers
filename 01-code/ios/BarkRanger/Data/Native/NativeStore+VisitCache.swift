import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func acceptNativeVisit(_ snapshot: NativeVisitSnapshot) throws {
        try requireOpen()
        try snapshot.validate()
        do {
            try stageVisitSnapshot(snapshot)
            try stageVisitCacheRetention()
            try commit()
            publish([.visit(snapshot.visitID), .visitHistory, .markers, .progress])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func acceptNativeProgress(_ snapshot: NativeProgressSnapshot) throws {
        try requireOpen()
        try snapshot.validate()
        do {
            try stageProgress(snapshot.progress, readTime: snapshot.readTime)
            try commit()
            publish([.progress])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func acceptNativeVisitHistory(_ page: NativeVisitPage, after cursor: NativeVisitPage.Cursor?) throws {
        try requireOpen()
        try page.validate(after: cursor)
        do {
            for visit in page.items { try stageVisit(visit) }
            try stageVisitCacheRetention()
            try commit()
            publish([.visitHistory])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func stageVisitSnapshot(_ snapshot: NativeVisitSnapshot) throws {
        if let visit = snapshot.visit {
            try stageVisit(visit)
        } else if let row = try visitRow(snapshot.visitID),
            try decodeVisit(row).updatedAt <= snapshot.readTime
        {
            modelContext.delete(row)
        }
        if let marker = snapshot.placeProgress {
            try stagePlaceProgress(marker)
        }
        // A disappearing established slot/progress record is not a fresh account.
        // Retain the cache and surface recovery rather than resetting confirmed credit.
        else if let current = try nativePlaceProgress(siteID: snapshot.siteID),
            current.updatedAt <= snapshot.readTime
        {
            throw Failure.unavailable
        }
        try stageProgress(snapshot.progress, readTime: snapshot.readTime)
    }
    func stageProgress(_ value: NativeProgress?, readTime: NativeServerTime) throws {
        guard let value else {
            if let current = try nativeProgress(), current.updatedAt <= readTime { throw Failure.unavailable }
            return
        }
        try value.validate()
        let bytes = try JSONEncoder().encode(value)
        if let row = try progressRow() {
            guard row.revision < value.revision else {
                if row.revision == value.revision, try nativeProgress() != value { throw Failure.corrupt }
                return
            }
            row.revision = value.revision
            row.payload = bytes
        } else {
            modelContext.insert(NativeLocalSchema.Progress(revision: value.revision, payload: bytes))
        }
    }
    func stageVisit(_ value: NativeVisitRecord) throws {
        try value.validate()
        if !value.deleted, let marker = try nativePlaceProgress(siteID: value.siteID) {
            // A late history page cannot undo a newer marker/date/deletion observation.
            // J2 will deliberately distinguish historical repeat events from today's one active event.
            if marker.updatedAt > value.updatedAt
                || (marker.updatedAt == value.updatedAt && marker.visitID != value.id)
            {
                return
            }
        }
        let bytes = try JSONEncoder().encode(value)
        if let row = try visitRow(value.id) {
            guard row.revision < value.revision else {
                if row.revision == value.revision, try decodeVisit(row) != value { throw Failure.corrupt }
                return
            }
            guard row.siteID == value.siteID else { throw Failure.corrupt }
            row.revision = value.revision
            row.payload = bytes
            row.isTombstone = value.deleted
            row.happenedAtMs = value.details?.happenedAtMs ?? 0
            row.lastAccess = Date()
        } else {
            modelContext.insert(
                NativeLocalSchema.Visit(
                    id: value.id, siteID: value.siteID,
                    revision: value.revision, isTombstone: value.deleted,
                    happenedAtMs: value.details?.happenedAtMs ?? 0, payload: bytes))
        }
    }
    func stagePlaceProgress(_ value: NativePlaceProgress) throws {
        try value.validate()
        let bytes = try JSONEncoder().encode(value)
        if let row = try placeProgressRow(value.id) {
            guard row.revision < value.revision else {
                if row.revision == value.revision, try decodePlaceProgress(row) != value {
                    throw Failure.corrupt
                }
                return
            }
            row.officialPlaceID = value.officialPlaceID
            row.revision = value.revision
            row.visitID = value.visitID
            row.visited = value.visited
            row.verified = value.verified
            row.payload = bytes
        } else {
            modelContext.insert(
                NativeLocalSchema.PlaceProgress(
                    id: value.id, officialPlaceID: value.officialPlaceID,
                    revision: value.revision, visitID: value.visitID, visited: value.visited,
                    verified: value.verified, payload: bytes))
        }
        let siteID = value.id
        var query = FetchDescriptor<NativeLocalSchema.Visit>(
            predicate: #Predicate { !$0.isTombstone && $0.siteID == siteID })
        query.fetchLimit = 251
        for row in try modelContext.fetch(query) {
            let old = try decodeVisit(row)
            if old.updatedAt < value.updatedAt
                || (old.updatedAt == value.updatedAt && old.id != value.visitID)
            {
                modelContext.delete(row)  // Includes history fetched before this slot was cached.
            }
        }
    }
    func stageVisitCacheRetention() throws {
        var query = FetchDescriptor<NativeLocalSchema.Visit>(sortBy: [
            SortDescriptor(\.lastAccess, order: .reverse), SortDescriptor(\.id),
        ])
        query.fetchLimit = 751  // Existing budget plus the maximum 500-visit selected-set read.
        for row in try modelContext.fetch(query).dropFirst(250) { modelContext.delete(row) }
        // This is a reconstructible detail cache, not a 250-visit product/archive limit.
        // Durable visit intents must own their preimages independently of these rows.
    }
}
