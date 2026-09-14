import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func openNativeDraft(id: String?) throws -> TripDraft {
        try requireOpen()
        var draft: TripDraft
        let previous: TripDraft?
        if let id {
            previous = try currentNativeDraft(id: id)
            guard let value = try restorableNativeDraft(id: id) ?? cachedTrip(id: id) else {
                throw Failure.unavailable
            }
            draft = value
        } else {
            previous = nil
            draft = TripDraft(trip: Trip(), nativeBase: .init())
        }
        if !draft.trip.days.contains(where: { $0.id == draft.activeDayID }) {
            draft.activeDayID = draft.trip.days.first?.id
        }
        return try checkpointNativeDraft(draft, replacing: previous)
    }

    func clearNativeTrip(expectedID: String?) throws {
        try requireOpen()
        guard try selectionRow()?.tripID == expectedID else { throw TripDayEdit.Failure.changedDay }
        do {
            try stageNativeSelection(tripID: nil, dayID: nil)
            try commit()
            publish([.selection])
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    func editNativeDay(_ target: TripDayID, edit: TripDayEdit) throws {
        try requireOpen()
        guard let previous = try currentNativeDraft(id: target.tripID) else {
            throw TripDayEdit.Failure.missingDay
        }
        _ = try checkpointNativeDraft(edit.applying(to: previous, target: target), replacing: previous)
    }

    func addNativeStop(
        _ stop: Trip.Stop, aliases: Set<ParkID>, tripID: String?,
        destination: TripStopPolicy.Destination?, after: String?
    ) throws -> TripDraft {
        try requireNativeTripEditing()
        let previous: TripDraft?
        if let tripID {
            guard let draft = try currentNativeDraft(id: tripID) else { throw TripDayEdit.Failure.missingDay }
            previous = draft
        } else {
            previous = nil
        }
        var draft = previous ?? TripDraft(trip: Trip(), nativeBase: .init())
        guard let dayID = draft.activeDayID ?? draft.trip.days.first?.id else {
            throw TripDayEdit.Failure.missingDay
        }
        draft.trip = try TripStopPolicy.adding(
            stop, aliases: aliases, to: draft.trip, destination: destination ?? .day(dayID), after: after)
        return try checkpointNativeDraft(draft, replacing: previous)
    }

    func saveNativeTrip(id: String, matching expected: TripDraft) throws -> TripDraft {
        try requireOpen()
        guard let current = try currentNativeDraft(id: id), current.trip == expected.trip,
            current.activeDayID == expected.activeDayID
        else { throw TripDayEdit.Failure.changedDay }
        _ = try stageTripSave(current)
        return current
    }

    /// The confirmed delete action removes the displayed draft/selection and stages cloud
    /// deletion in one disk commit. It never depends on a later network callback to clear UI.
    func deleteNativeTrip(matching expectedDraft: TripDraft) throws {
        try requireNativeTripEditing()
        guard let draft = try currentNativeDraft(id: expectedDraft.id), draft.trip == expectedDraft.trip,
            draft.activeDayID == expectedDraft.activeDayID
        else { throw TripDayEdit.Failure.changedDay }
        guard let base = expectedDraft.nativeBase else { throw Failure.corrupt }
        try base.validate(tripID: draft.id)
        let pending = try tripOperations(draft.id)
        let last = try pending.last.map { try tripIntent($0) }
        let expected: Int64?
        if let last {
            guard last.savedDraft != nil else { throw Failure.unavailable }
            expected = last.resultContentRevision
        } else {
            // Delete the version this editor opened, not a later background metadata read.
            expected = base.contentRevision > 0 ? base.contentRevision : nil
        }
        let operation: NativeTripIntent? = expected.map { .delete(tripID: draft.id, contentRevision: $0) }
        if operation != nil {
            guard !isGuest else { throw Failure.queueFull }
            try requireQueueCapacity()
        }
        do {
            if let operation {
                _ = try insertTripIntent(operation, predecessor: pending.last?.id, now: Date())
            }
            if let row = try draftRow(draft.id) { modelContext.delete(row) }
            if try selectionRow()?.tripID == draft.id { try stageNativeSelection(tripID: nil, dayID: nil) }
            try commit()
            publish([.draft(draft.id), .trip(draft.id), .library, .selection, .pending])
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    func discardNativeDraft(id: String, matching expected: TripDraft) throws {
        try requireNativeTripEditing()
        guard expected.id == id, try currentNativeDraft(id: id) == expected else {
            throw TripDayEdit.Failure.changedDay
        }
        do {
            if let row = try draftRow(id) { modelContext.delete(row) }
            if try selectionRow()?.tripID == id { try stageNativeSelection(tripID: nil, dayID: nil) }
            // Submitted saves retain their own durable copy. Discarding a draft cannot cancel
            // an in-flight server write whose outcome is still unknown.
            try commit()
            publish([.draft(id), .selection, .library])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
