import BarkDomain

/// Stable-target itinerary transactions share the same atomic store as Planner checkpoints.
extension LocalStore {
    /// Selection only: retained trips remain available to both free and Premium accounts.
    func clearActiveTrip(expectedID: String?) throws {
        try Task.checkCancellation()
        var next = try readSnapshot()
        guard next.selectedTripID == expectedID else { throw TripDayEdit.Failure.changedDay }
        next.activeDraftID = nil
        next.activeTripCleared = true
        try save(next)
    }

    /// Restores the shared selection, caching an existing account trip only when necessary.
    func restoreActiveDraft() throws -> LegacyTripDraft? {
        try Task.checkCancellation()
        let state = try readSnapshot()
        guard let id = state.selectedTripID else { return nil }
        if let draft = state.drafts?.first(where: { $0.id == id }) { return draft }
        return try openTripDraft(id: id)
    }

    /// One confirmed deletion removes the draft and stages its account deletion in the same disk write.
    func deleteTrip(matching draft: LegacyTripDraft) throws {
        try Task.checkCancellation()
        try requireEditing(draft: true)
        var next = try readSnapshot()
        guard let current = next.drafts?.first(where: { $0.id == draft.id }),
            current.trip == draft.trip, current.activeDayID == draft.activeDayID
        else { throw TripDayEdit.Failure.changedDay }
        if let saved = next.visible.trips.first(where: { $0.id == draft.id }) {
            guard next.pending.count < 128 else { throw Failure.queueFull }
            next.pending.append(
                PendingMutation(
                    operation: UserMutation(
                        uid: next.baseline.uid, kind: .trip, expected: saved.tripContent,
                        value: .object(["id": .string(draft.id), "record": .null]))))
        }
        if next.selectedTripID == draft.id {
            next.activeDraftID = nil
            next.activeTripCleared = true
        }
        next.drafts?.removeAll { $0.id == draft.id }
        try save(next)
    }

    func openTripDraft(id: String?) throws -> LegacyTripDraft {
        try Task.checkCancellation()
        let state = try readSnapshot()
        var draft: LegacyTripDraft
        if let id, let saved = state.drafts?.first(where: { $0.id == id }) {
            draft = saved
        } else if let id, let record = state.visible.trips.first(where: { $0.id == id }) {
            draft = LegacyTripDraft(trip: try Trip(record: record), expected: record.tripContent)
        } else if id == nil {
            draft = LegacyTripDraft(trip: Trip())
        } else {
            throw Failure.invalidChange
        }
        if !draft.trip.days.contains(where: { $0.id == draft.activeDayID }) {
            draft.activeDayID = draft.trip.days.first?.id
        }
        try saveDraft(draft)
        return draft
    }

    func editDay(_ target: TripDayID, edit: TripDayEdit) throws {
        try Task.checkCancellation()
        let state = try readSnapshot()
        guard let draft = state.drafts?.first(where: { $0.id == target.tripID }) else {
            throw Failure.invalidChange
        }
        try saveDraft(edit.applying(to: draft, target: target))
    }

    /// An outstanding planner checkpoint cannot overwrite a newer map edit of the same draft.
    func checkpoint(_ draft: LegacyTripDraft, replacing expected: LegacyTripDraft?) throws -> LegacyTripDraft {
        try Task.checkCancellation()
        let current = try readSnapshot().drafts?.first { $0.id == draft.id }
        guard current?.trip == expected?.trip, current?.activeDayID == expected?.activeDayID else {
            throw TripDayEdit.Failure.changedDay
        }
        var next = draft
        if let current { next.expected = current.expected }
        try saveDraft(next)
        return next
    }
}
