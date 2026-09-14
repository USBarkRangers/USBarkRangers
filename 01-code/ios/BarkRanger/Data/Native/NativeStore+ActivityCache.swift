import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func acceptNativeExpedition(_ snapshot: NativeExpeditionSnapshot) throws {
        try requireOpen()
        try snapshot.validate(activityID: snapshot.activityID, runID: snapshot.runID)
        do {
            try stageExpeditionSnapshot(snapshot)
            try stageActivityCacheRetention()
            try commit()
            var changes: Set<Change> = [.expedition, .progress]
            if let id = snapshot.activityID { changes.formUnion([.activity(id), .activityHistory]) }
            publish(changes)
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func stageExpeditionSnapshot(_ snapshot: NativeExpeditionSnapshot) throws {
        try stageExpeditionState(snapshot.state, readTime: snapshot.readTime)
        try stageProgress(snapshot.progress, readTime: snapshot.readTime)
        for run in snapshot.runs { try stageVirtualRun(run) }
        if let id = snapshot.activityID {
            if snapshot.activityClaimed { try stageActivityClaim(id) }
            // A late point response is subject to the same stale-read barrier as a
            // history page, even if cache pressure has already evicted its tombstone.
            if let floor = try activityHistoryFloor(), snapshot.readTime < floor { return }
            if let activity = snapshot.activity {
                let previous = try nativeActivity(id: id)
                try stageActivity(activity)
                if activity.deleted || previous == nil || activity.revision > (previous?.revision ?? 0) {
                    try advanceActivityHistoryFloor(snapshot.readTime)
                }
            } else if let row = try activityRow(id), try decodeActivity(row).updatedAt <= snapshot.readTime {
                modelContext.delete(row)
                try advanceActivityHistoryFloor(snapshot.readTime)
            }
            if snapshot.activity == nil, snapshot.activityClaimed {
                try advanceActivityHistoryFloor(snapshot.readTime)
            }
        }
    }
    func stageExpeditionState(_ value: NativeExpeditionState?, readTime: NativeServerTime) throws {
        let current = try nativeExpeditionState()
        guard let value else {
            if let current, current.updatedAt <= readTime { throw Failure.unavailable }
            if current == nil, try expeditionRow() == nil {
                modelContext.insert(NativeLocalSchema.ExpeditionState(revision: 0, payload: Data("null".utf8)))
            }
            return
        }
        try value.validate()
        if let current {
            if value.revision < current.revision { return }
            if value.revision == current.revision {
                guard value == current else { throw Failure.corrupt }
                return
            }
            guard value.selectionRevision >= current.selectionRevision,
                value.selectionRevision != current.selectionRevision
                    || value.activeRunID == current.activeRunID
            else { throw Failure.corrupt }
        }
        let bytes = try JSONEncoder().encode(value)
        if let row = try expeditionRow() {
            row.revision = value.revision
            row.payload = bytes
        } else {
            modelContext.insert(NativeLocalSchema.ExpeditionState(revision: value.revision, payload: bytes))
        }
    }
    func stageActivity(_ value: NativeActivityRecord) throws {
        try value.validate()
        let bytes = try JSONEncoder().encode(value)
        if let row = try activityRow(value.id) {
            let previous = try decodeActivity(row)
            if value.revision < previous.revision { return }
            if value.revision == previous.revision {
                guard value == previous else { throw Failure.corrupt }
                return
            }
            guard !previous.deleted || value.deleted else { throw Failure.corrupt }
            if let old = previous.details, let next = value.details {
                guard old.source == next.source, old.startedAtMs == next.startedAtMs,
                    old.endedAtMs == next.endedAtMs,
                    old.originalMeters == next.originalMeters, old.elapsedSeconds == next.elapsedSeconds,
                    old.runID == next.runID, old.recordedAt == next.recordedAt
                else { throw Failure.corrupt }
            }
            row.revision = value.revision
            row.isTombstone = value.deleted
            row.happenedAtMs = value.details?.happenedAtMs ?? 0
            row.payload = bytes
            row.lastAccess = Date()
        } else {
            modelContext.insert(
                NativeLocalSchema.Activity(
                    id: value.id, revision: value.revision,
                    isTombstone: value.deleted, happenedAtMs: value.details?.happenedAtMs ?? 0, payload: bytes
                ))
        }
    }
    func stageVirtualRun(_ value: NativeVirtualRun) throws {
        try value.validate()
        let bytes = try JSONEncoder().encode(value)
        if let row = try virtualRunRow(value.id), let previous = try nativeVirtualRun(id: value.id) {
            if value.revision < previous.revision { return }
            if value.revision == previous.revision {
                guard value == previous else { throw Failure.corrupt }
                return
            }
            guard previous.trailID == value.trailID, previous.trailRevision == value.trailRevision,
                previous.name == value.name, previous.totalMiles == value.totalMiles,
                previous.createdAt == value.createdAt, previous.startedAtMs == value.startedAtMs,
                previous.status == .active
            else { throw Failure.corrupt }
            row.revision = value.revision
            row.payload = bytes
            row.lastAccess = Date()
        } else {
            modelContext.insert(
                NativeLocalSchema.VirtualRun(id: value.id, revision: value.revision, payload: bytes))
        }
    }
    func stageActivityClaim(_ id: String) throws {
        var query = FetchDescriptor<NativeLocalSchema.ActivityClaim>(predicate: #Predicate { $0.id == id })
        query.fetchLimit = 1
        if let row = try modelContext.fetch(query).first {
            row.lastAccess = Date()
        } else {
            modelContext.insert(NativeLocalSchema.ActivityClaim(id: id))
        }
    }
    func stageActivityCacheRetention() throws {
        var activities = FetchDescriptor<NativeLocalSchema.Activity>(sortBy: [
            SortDescriptor(\.lastAccess, order: .reverse), SortDescriptor(\.id),
        ])
        activities.fetchLimit = 351
        for row in try modelContext.fetch(activities).dropFirst(250) { modelContext.delete(row) }
        let active = try nativeExpeditionState()?.activeRunID ?? ""
        var runs = FetchDescriptor<NativeLocalSchema.VirtualRun>(
            predicate: #Predicate { $0.id != active },
            sortBy: [SortDescriptor(\.lastAccess, order: .reverse), SortDescriptor(\.id)])
        runs.fetchLimit = 68
        for row in try modelContext.fetch(runs).dropFirst(64) { modelContext.delete(row) }
        var claims = FetchDescriptor<NativeLocalSchema.ActivityClaim>(sortBy: [
            SortDescriptor(\.lastAccess, order: .reverse), SortDescriptor(\.id),
        ])
        claims.fetchLimit = 1101
        for row in try modelContext.fetch(claims).dropFirst(1000) { modelContext.delete(row) }
        // Reconstructible caches only. Pending commands/recording files own their source
        // values; 250 details / 64 old run contexts are not archive or UI limits.
    }
}
