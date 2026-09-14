import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    @discardableResult func stageNativeVisitOperation(_ value: NativeVisitOperation, now: Date = Date())
        throws -> UUID
    {
        try requireOpen()
        guard !isGuest, try readEntitlement()?.permitsEditing(at: now) == true,
            try profileView().confirmed?.status == .active
        else { throw Failure.unavailable }
        try value.validate()
        let queue = try visitQueue()
        let preceding = try visitPendingChanges(siteIDs: Set(value.siteIDs), queue: queue)
        for change in value.changes {
            try requireVisitPreimage(change, previous: preceding[change.intent.target.siteID]?.change)
        }
        guard try modelContext.fetchCount(FetchDescriptor<NativeLocalSchema.PendingOperation>()) < 128 else {
            throw Failure.queueFull
        }
        do {
            let id = try insertVisitOperation(value, now: now)
            try commit()
            publish(
                Set(value.changes.map { .visit($0.intent.target.visitID) }).union([
                    .pending, .markers, .visitHistory,
                ]))
            return id
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func insertVisitOperation(_ value: NativeVisitOperation, now: Date, id: UUID = UUID()) throws -> UUID {
        try value.validate()
        let milliseconds = try NativeVisitDraft.milliseconds(now)
        guard try operation(id) == nil else { throw Failure.corrupt }
        let bytes = try JSONEncoder().encode(value)
        guard bytes.count <= 1_000_000,
            try value.commandBytes(id: id, createdAtMs: milliseconds).count <= 400_000
        else {
            throw Failure.queueFull
        }
        let row = NativeLocalSchema.PendingOperation(
            id: id.uuidString.lowercased(), entityKey: "visits",
            sequence: try nextNativeSequence(), createdAtMs: milliseconds, intent: bytes, predecessor: nil,
            expectedRevision: nil)
        row.listSummary = try JSONEncoder().encode(value.keys)
        modelContext.insert(row)
        return id
    }
    private func requireVisitPreimage(_ change: NativeVisitChange, previous: NativeVisitChange?) throws {
        let target = change.intent.target
        if let prior = previous {
            guard
                prior.after == change.before, target.placeRevision == prior.intent.target.placeRevision + 1,
                target.visitRevision == (prior.after == nil ? 0 : prior.intent.target.visitRevision + 1),
                prior.after == nil || target.visitID == prior.intent.target.visitID
            else { throw Failure.unavailable }
        } else {
            let marker = try nativePlaceProgress(siteID: target.siteID)
            guard target.placeRevision == (marker?.revision ?? 0),
                target.visitRevision == (marker?.visitRevision ?? 0),
                marker?.visitID == change.before?.id
            else { throw Failure.unavailable }
            if let before = change.before, let cached = try nativeVisit(id: before.id) {
                guard NativeVisitDraft(record: cached) == before, cached.revision == target.visitRevision
                else { throw Failure.unavailable }
            }
        }
    }
}
