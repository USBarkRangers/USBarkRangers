import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func reviewTripConflict(
        id: String, draft: TripDraft?, snapshot: NativeTripSnapshot,
        recovery: NativeTripRecovery?
    ) throws -> NativeTripRepository.ConflictReview {
        try requireOpen()
        let pending = try tripOperations(id)
        guard let first = pending.first, ["conflict", "rejected"].contains(first.state),
            try currentNativeDraft(id: id) == draft,
            try metadataRow(id)?.revision ?? 0 == snapshot.metadata?.revision ?? 0
        else {
            throw Failure.invalidAcknowledgment
        }
        return .init(
            id: id, draft: draft,
            operationIDs: try pending.map {
                guard let id = UUID(uuidString: $0.id) else { throw Failure.corrupt }
                return id
            }, snapshot: snapshot, recovery: recovery)
    }
    struct TripResolution: Sendable {
        let draft: TripDraft?
        let operationID: UUID?
        let recoveredAsNewTrip: Bool
    }

    /// A user's explicit choice replaces the blocked chain with one new intent. Match the
    /// exact draft/metadata shown for that choice; never reinterpret it after another edit.
    func resolveTripConflict(
        id: String, keepLocal: Bool, expectedDraft: TripDraft?, metadataRevision: Int64,
        snapshot: NativeTripSnapshot, recovery: NativeTripRecovery?, now: Date = Date(),
        expectedOperationIDs: [UUID]
    ) throws -> TripResolution {
        try requireOpen()
        try snapshot.validate()
        let pending = try tripOperations(id)
        if pending.map(\.id) != expectedOperationIDs.map({ $0.uuidString.lowercased() }) {
            throw Failure.invalidAcknowledgment
        }
        guard let first = pending.first, let last = pending.last,
            ["conflict", "rejected"].contains(first.state),
            snapshot.tripID == id, snapshot.metadata?.revision ?? 0 == metadataRevision,
            try metadataRow(id)?.revision ?? 0 == metadataRevision,
            try currentNativeDraft(id: id) == expectedDraft
        else { throw Failure.invalidAcknowledgment }
        let latest = try JSONDecoder().decode(NativeTripIntent.self, from: last.intent)
        let replacement: NativeTripIntent?
        var chosen: TripDraft?
        var copied = false
        if keepLocal {
            try requireNativeTripEditing()
            switch latest {
            case .save(let submitted), .notes(let submitted):
                var working = expectedDraft ?? submitted
                if snapshot.metadata == nil || snapshot.metadata?.deleted == true {
                    // Do not reuse an expired/deleted identity or revive stale references.
                    // Preserve the user's text as a new trip; the caller reports this recovery.
                    working.trip = Trip(
                        name: working.trip.name, days: working.trip.days, start: working.trip.start,
                        end: working.trip.end)
                    working.nativeBase = .init()
                    copied = true
                } else {
                    guard let recovery, recovery.metadata == snapshot.metadata, let content = snapshot.content
                    else {
                        throw Failure.invalidAcknowledgment
                    }
                    try recovery.validate(for: .init(trip: working.trip))
                    let canonical = try content.workingCopy(
                        notes: Dictionary(uniqueKeysWithValues: snapshot.notes.map { ($0.id, $0) }))
                    working.nativeBase = .init(
                        contentRevision: content.revision,
                        notes: Dictionary(uniqueKeysWithValues: recovery.notes.map { ($0.id, $0) }),
                        contentFingerprint: try NativeTripBase.fingerprint(canonical))
                }
                chosen = working
                replacement = .save(working)
            case .delete:
                chosen = expectedDraft
                replacement =
                    snapshot.metadata?.deleted == false
                    ? .delete(tripID: id, contentRevision: snapshot.metadata?.contentRevision ?? 0) : nil
            }
        } else {
            replacement = nil
            if let content = snapshot.content {
                let notes = Dictionary(uniqueKeysWithValues: snapshot.notes.map { ($0.id, $0) })
                let trip = try content.workingCopy(notes: notes)
                chosen = TripDraft(
                    trip: trip,
                    nativeBase: .init(
                        contentRevision: content.revision, notes: notes,
                        contentFingerprint: try NativeTripBase.fingerprint(trip)))
            }
        }
        try replacement?.validate()
        let count = try modelContext.fetchCount(FetchDescriptor<NativeLocalSchema.PendingOperation>())
        guard count - pending.count + (replacement == nil ? 0 : 1) <= NativeSyncPolicy.queueLimit else { throw Failure.queueFull }
        do {
            try stageTripSnapshot(snapshot)
            for row in pending { modelContext.delete(row) }
            let operationID = try replacement.map { try insertTripIntent($0, predecessor: nil, now: now) }
            try stageResolvedDraft(chosen, replacingID: id)
            try stageCacheRetention()
            try commit()
            publish([
                .pending, .library, .draft(id), .trip(id), .selection,
                .draft(chosen?.id ?? id), .trip(chosen?.id ?? id),
            ])
            return TripResolution(draft: chosen, operationID: operationID, recoveredAsNewTrip: copied)
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    private func stageResolvedDraft(_ draft: TripDraft?, replacingID oldID: String) throws {
        let wasSelected = try selectionRow()?.tripID == oldID
        if let old = try draftRow(oldID) { modelContext.delete(old) }
        if let draft {
            let dirty = try NativeTripBase.fingerprint(draft.trip) != draft.nativeBase?.contentFingerprint
            modelContext.insert(
                NativeLocalSchema.Draft(
                    id: draft.id, editRevision: 1, title: draft.trip.name,
                    dayCount: draft.trip.days.count, stopCount: draft.trip.totalStops, dirty: dirty,
                    bytes: try JSONEncoder().encode(draft)))
            if wasSelected { try stageNativeSelection(tripID: draft.id, dayID: draft.activeDayID) }
        } else if wasSelected {
            try stageNativeSelection(tripID: nil, dayID: nil)
        }
    }
}
