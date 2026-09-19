import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func confirmedTripSnapshot(_ outcome: NativeTripOutcome) throws -> NativeTripSnapshot? {
        try requireOpen()
        guard outcome.status == .accepted, outcome.confirmation != nil,
            let row = try operation(outcome.operationID), row.state == "sealed", row.sealedBytes != nil
        else { return nil }
        let intent = try tripIntent(row)
        guard row.expectedRevision == intent.baseRevision
        else { throw Failure.corrupt }
        if case .notes = intent {
            return try intent.confirmedSnapshot(
                outcome, cached: cachedTrip(id: intent.tripID),
                cachedMetadata: tripCacheStamp(intent.tripID)?.metadata)
        }
        return try intent.confirmedSnapshot(outcome, cached: nil, cachedMetadata: nil)
    }

    func acceptTripOutcome(_ outcome: NativeTripOutcome, snapshot: NativeTripSnapshot) throws {
        try requireOpen()
        try outcome.validate()
        try snapshot.validate()
        guard let row = try operation(outcome.operationID) else { return }
        guard row.entityKey == "trip:\(snapshot.tripID)", row.state == "sealed", row.sealedBytes != nil,
            let expected = row.expectedRevision
        else { throw Failure.invalidAcknowledgment }
        let intent = try tripIntent(row)
        guard intent.tripID == snapshot.tripID, expected == intent.baseRevision,
            (snapshot.metadata?.contentRevision ?? 0) >= outcome.revisions.trip
        else {
            throw Failure.invalidAcknowledgment
        }
        if outcome.status == .accepted {
            guard outcome.revisions.trip == intent.resultContentRevision,
                let revision = outcome.revisions.metadata,
                (snapshot.metadata?.revision ?? 0) >= revision
            else { throw Failure.invalidAcknowledgment }
            if let draft = intent.savedDraft {
                let payload = try NativeTripSave(trip: draft.trip, baseNotes: draft.nativeBase?.notes ?? [:])
                guard let notes = outcome.revisions.notes,
                    payload.notes.allSatisfy({ notes[$0.id] == $0.expectedRevision + 1 })
                else { throw Failure.invalidAcknowledgment }
            }
        }
        do {
            try stageTripSnapshot(snapshot)
            if outcome.status == .conflict {
                row.state = "conflict"
                row.failureCode = "conflict"
            } else {
                let pending = try tripOperations(intent.tripID)
                guard pending.first?.id == row.id else { throw Failure.corrupt }
                if let child = pending.dropFirst().first {
                    guard child.state == "queued", child.sealedBytes == nil else { throw Failure.corrupt }
                    child.predecessor = nil
                    child.expectedRevision = outcome.revisions.trip
                    let next = try tripIntent(child)
                    guard next.baseRevision == outcome.revisions.trip else {
                        throw Failure.invalidAcknowledgment
                    }
                }
                modelContext.delete(row)
                try stageAcknowledgedDraft(intent, snapshot: snapshot, hasChild: pending.count > 1)
            }
            try stageCacheRetention()
            var changes: Set<Change> = [
                .library, .trip(intent.tripID), .draft(intent.tripID), .selection, .pending,
            ]
            if let value = try tripCacheStamp(intent.tripID)?.metadata, value.deleted {
                changes.insert(.tripDeleted(value.id, value.revision))
            }
            try commit()  // Cache, acknowledgment, draft preimage and dependency advance are one transaction.
            publish(changes)
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    private func stageAcknowledgedDraft(
        _ intent: NativeTripIntent, snapshot: NativeTripSnapshot, hasChild: Bool
    ) throws {
        guard let row = try draftRow(intent.tripID), var current = try currentNativeDraft(id: intent.tripID)
        else { return }
        if let saved = intent.savedDraft {
            if current.trip == saved.trip, !hasChild {
                guard let canonical = try cachedTrip(id: intent.tripID) else {
                    let metadata = try metadataRow(intent.tripID)
                    let stamp = try tripCacheStamp(intent.tripID)
                    let removed =
                        metadata?.isTombstone
                        ?? stamp.map { $0.metadata == nil || $0.metadata?.deleted == true }
                        ?? (snapshot.metadata == nil || snapshot.metadata?.deleted == true)
                    if removed {
                        // Confirmed deletion, not merely stale/evicted detail.
                        modelContext.delete(row)
                        if try selectionRow()?.tripID == intent.tripID {
                            try stageNativeSelection(tripID: nil, dayID: nil)
                        }
                    } else {
                        // A newer metadata read overtook this acknowledgment. Keep our
                        // accepted preimage until its matching full detail arrives.
                        current.nativeBase = try intent.projectedBase(for: current.trip)
                        row.dirty = try nativeDraftIsDirty(current)
                        row.bytes = try JSONEncoder().encode(current)
                    }
                    return
                }
                // No later local edit exists. Follow confirmed content, preserving device day selection.
                let selectedDay = current.activeDayID
                current = canonical
                if current.trip.days.contains(where: { $0.id == selectedDay }) {
                    current.activeDayID = selectedDay
                }
            } else {
                current.nativeBase = try intent.projectedBase(for: current.trip)
            }
            row.dirty = try nativeDraftIsDirty(current)
            row.bytes = try JSONEncoder().encode(current)
            row.title = current.trip.name
            row.dayCount = current.trip.days.count
            row.stopCount = current.trip.totalStops
        } else {
            // Deleting a saved trip must not erase unsaved local work made during its request.
            if !row.dirty { modelContext.delete(row) }
        }
    }

    func rejectTripOperation(_ id: UUID, code: String) throws {
        try requireOpen()
        guard NativeMailroom.rejectionCodes.contains(code), let row = try operation(id),
            row.entityKey.hasPrefix("trip:"), row.state == "sealed"
        else { throw Failure.corrupt }
        do {
            row.state = "rejected"
            row.failureCode = code
            try commit()
            publish([.pending, .library, .trip(String(row.entityKey.dropFirst(5)))])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
