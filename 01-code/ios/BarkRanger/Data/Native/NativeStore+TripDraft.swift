import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func checkpointNativeDraft(_ draft: TripDraft, replacing expected: TripDraft?) throws -> TripDraft {
        try requireOpen()
        try draft.trip.validate(allowEmptyName: true)
        let current = try currentNativeDraft(id: draft.id)
        guard current?.trip == expected?.trip, current?.activeDayID == expected?.activeDayID else {
            throw TripDayEdit.Failure.changedDay
        }
        // Acknowledging our own save may advance only the stored preimage while typing.
        // Match editable content, then carry that acknowledged base into this checkpoint.
        var draft = draft
        draft.nativeBase = current?.nativeBase ?? draft.nativeBase
        guard let base = draft.nativeBase else { throw Failure.corrupt }
        try base.validate(tripID: draft.id)
        let dirty = try nativeDraftIsDirty(draft)
        if current?.trip != draft.trip && dirty { try requireNativeTripEditing() }
        do {
            let selection = try nativeSelection()
            let row = try draftRow(draft.id)
            let summaryChanged =
                row == nil || row?.title != draft.trip.name
                || row?.dayCount != draft.trip.days.count || row?.stopCount != draft.trip.totalStops
            let bytes = try JSONEncoder().encode(draft)
            if let row {
                guard row.editRevision < Int64.max else { throw Failure.corrupt }
                row.bytes = bytes
                row.editRevision += 1
                row.title = draft.trip.name
                row.dirty = dirty
                if summaryChanged || selection.tripID != draft.id { row.updatedAt = Date() }
                row.dayCount = draft.trip.days.count
                row.stopCount = draft.trip.totalStops
            } else {
                modelContext.insert(
                    NativeLocalSchema.Draft(
                        id: draft.id, editRevision: 1, title: draft.trip.name,
                        dayCount: draft.trip.days.count, stopCount: draft.trip.totalStops, dirty: dirty,
                        bytes: bytes))
            }
            try stageNativeSelection(tripID: draft.id, dayID: draft.activeDayID)
            // Rebalance on selection changes or a new clean editor copy, not every
            // keystroke in a protected dirty draft.
            if selection.tripID != draft.id || (!dirty && current == nil) {
                try stageCleanDraftRetention(selected: draft.id)
            }
            try commit()
            var changes: Set<Change> = [.draft(draft.id), .tripEditor]
            if summaryChanged || selection.tripID != draft.id { changes.insert(.tripDrafts) }
            if selection.tripID != draft.id || selection.dayID != draft.activeDayID {
                changes.insert(.selection)
            }
            publish(changes)
            return draft
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    func requireNativeTripEditing() throws {
        try requireOpen()
        if isGuest { return }
        guard try readEntitlement()?.permitsEditing(at: Date()) == true,
            try profileView().confirmed?.status == .active
        else { throw Failure.unavailable }
    }

    func nativeSelection() throws -> (tripID: String?, dayID: String?) {
        try requireOpen()
        let value = try selectionRow()
        return (value?.tripID, value?.dayID)
    }

    /// Local working selection. The caller owns its transaction and publication.
    func stageNativeSelection(tripID: String?, dayID: String?) throws {
        guard tripID != nil || dayID == nil else { throw Failure.corrupt }
        if let row = try selectionRow() {
            if row.tripID != tripID { row.tripID = tripID }
            if row.dayID != dayID { row.dayID = dayID }
        } else {
            modelContext.insert(NativeLocalSchema.Selection(tripID: tripID, dayID: dayID))
        }
    }

    func selectionRow() throws -> NativeLocalSchema.Selection? {
        var query = FetchDescriptor<NativeLocalSchema.Selection>()
        query.fetchLimit = 2
        let values = try modelContext.fetch(query)
        guard values.count <= 1, values.first == nil || values.first?.key == "selection" else {
            throw Failure.corrupt
        }
        return values.first
    }
}
