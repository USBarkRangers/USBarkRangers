import BarkDomain
import Foundation

/// Concrete adventure transactions on the existing store actor. No second queue or persistence owner.
extension LocalStore {
    func addStop(
        _ stop: Trip.Stop, aliases: Set<ParkID>, tripID: String?,
        destination: TripStopPolicy.Destination?, after: String?
    ) throws -> LegacyTripDraft {
        try Task.checkCancellation()
        try requireEditing(draft: true)
        let state = try readSnapshot()
        var draft: LegacyTripDraft
        if let tripID {
            guard let current = state.drafts?.first(where: { $0.id == tripID }) else {
                throw TripDayEdit.Failure.missingDay
            }
            draft = current
        } else {
            draft = LegacyTripDraft(trip: Trip())
        }
        guard let dayID = draft.activeDayID ?? draft.trip.days.first?.id else {
            throw TripDayEdit.Failure.missingDay
        }
        draft.trip = try TripStopPolicy.adding(
            stop, aliases: aliases, to: draft.trip,
            destination: destination ?? .day(dayID), after: after)
        try saveDraft(draft)
        return draft
    }
    func markVisit(park: Park, catalog: CatalogSnapshot, fix: LocationFix?, now: Date) throws {
        let snapshot = try readSnapshot().visible
        if let operation = try VisitPolicy.mark(
            park: park, snapshot: snapshot, catalog: catalog, fix: fix, now: now)
        {
            try stage(operation)
        }
    }
    func removeVisits(_ ids: Set<String>) throws {
        if let operation = try VisitPolicy.remove(ids: ids, snapshot: readSnapshot().visible) {
            try stage(operation)
        }
    }
    func changeVisitDate(id: String, date: Date) throws {
        try stage(VisitPolicy.changeDate(id: id, date: date, snapshot: readSnapshot().visible))
    }
    func saveDraft(_ draft: LegacyTripDraft) throws {
        try draft.trip.validate(allowEmptyName: true)
        var next = try readSnapshot()
        // Selecting a day/trip or caching an existing account trip remains available read-only.
        let existing = next.drafts?.first { $0.id == draft.id }
        let cachedAccountTrip =
            existing == nil
            && next.visible.trips.contains { $0.id == draft.id && $0.tripContent == draft.trip.content }
        if existing?.trip != draft.trip && !cachedAccountTrip { try requireEditing(draft: true) }
        var drafts = next.drafts ?? []
        drafts.removeAll { $0.id == draft.id }
        guard existing != nil || cachedAccountTrip || drafts.count < 20 else { throw Failure.queueFull }
        drafts.append(draft)
        next.drafts = drafts
        next.activeDraftID = draft.id
        next.activeTripCleared = nil
        try save(next)
    }
    func discardDraft(id: String) throws {
        try requireEditing(draft: true)
        var next = try readSnapshot()
        next.drafts?.removeAll { $0.id == id }
        if next.activeDraftID == id { next.activeDraftID = next.drafts?.last?.id }
        try save(next)
    }
    @discardableResult func saveTrip(id: String, matching: LegacyTripDraft? = nil) throws -> LegacyTripDraft {
        let state = try readSnapshot()
        try requireEditing()
        guard let draft = state.drafts?.first(where: { $0.id == id }) else { throw Failure.invalidChange }
        if let matching,
            matching.id != draft.id || matching.trip != draft.trip
                || matching.activeDayID != draft.activeDayID
        {
            throw TripDayEdit.Failure.changedDay
        }
        try draft.trip.validate()
        let operation = UserMutation(
            uid: state.baseline.uid, kind: .trip, expected: draft.expected,
            value: .object(["id": .string(id), "record": draft.trip.content]))
        // An editor retains the content it opened. Do not quietly rebase over a later remote edit.
        var next = state
        guard next.pending.count < 128 else { throw Failure.queueFull }
        if operation.content(in: state.visible) == draft.trip.content { return draft }
        next.pending.append(PendingMutation(operation: operation))
        if let index = next.drafts?.firstIndex(where: { $0.id == id }) {
            next.drafts?[index].expected = draft.trip.content
        }
        try save(next)
        var saved = draft
        saved.expected = draft.trip.content
        return saved
    }
    func deleteTrip(id: String) throws {
        let state = try readSnapshot()
        guard let trip = state.visible.trips.first(where: { $0.id == id }) else { return }
        try stage(
            UserMutation(
                uid: state.baseline.uid, kind: .trip, expected: trip.tripContent,
                value: .object(["id": .string(id), "record": .null])))
    }
    func recordActivity(now: Date = Date(), timeZone: TimeZone = .current) throws {
        let state = try readSnapshot()
        let day = AchievementPolicy.dayKey(now, timeZone: timeZone)
        guard state.baseline.profile.fields["lastStreakDate"]?.string != day,
            !state.pending.contains(where: {
                $0.operation.kind == .activity && $0.operation.value.object?["day"]?.string == day
            })
        else { return }
        try stage(
            UserMutation(
                uid: state.baseline.uid, kind: .activity, expected: .null,
                value: .object(["day": .string(day), "timeZone": .string(timeZone.identifier)]), now: now))
    }
    private func stage(_ operation: UserMutation) throws {
        // Queued canceled work must stop before the atomic write, even when it already crossed an adapter.
        try Task.checkCancellation()
        try requireEditing()
        var next = try readSnapshot()
        guard operation.uid == next.baseline.uid else { throw Failure.wrongAccount }
        guard next.pending.count < 128 else { throw Failure.queueFull }
        guard operation.expected == operation.content(in: next.visible) else { throw Failure.invalidChange }
        if operation.kind != .activity, operation.applying(to: next.visible) == next.visible { return }
        next.pending.append(PendingMutation(operation: operation))
        try save(next)
    }
    func resolveAdventure(_ pending: PendingMutation, keepLocal: Bool) throws {
        var next = try readSnapshot()
        // Include transitively overlapping batches so resolution never leaves an intent with a stale base.
        var entities = pending.operation.entityKeys
        var overlapping = Set<String>()
        var previousCount = -1
        while previousCount != overlapping.count {
            previousCount = overlapping.count
            for item in next.pending where !entities.isDisjoint(with: item.operation.entityKeys) {
                entities.formUnion(item.operation.entityKeys)
                overlapping.insert(item.id)
            }
        }
        let local = next.visible
        next.pending.removeAll { overlapping.contains($0.id) }
        if keepLocal {
            try requireEditing()
            var operation = pending.operation
            switch operation.kind {
            case .visits:
                var expected: [String: UserValue] = [:]
                var value: [String: UserValue] = [:]
                for entity in entities where entity.hasPrefix("visit:") {
                    let id = String(entity.dropFirst(6))
                    expected[id] =
                        Visit.records(in: next.baseline.profile).first { $0.parkID == id }?.record ?? .null
                    value[id] = Visit.records(in: local.profile).first { $0.parkID == id }?.record ?? .null
                }
                operation = UserMutation(
                    uid: next.baseline.uid, kind: .visits, expected: .object(expected), value: .object(value))
            case .trip:
                guard let id = operation.value.object?["id"]?.string else { throw Failure.invalidChange }
                let record = local.trips.first { $0.id == id }
                operation = operation.replacingValue(
                    .object(["id": .string(id), "record": record?.tripContent ?? .null]),
                    expected: operation.content(in: next.baseline))
            case .activity: operation = operation.replacingValue(operation.value, expected: .null)
            case .profile, .mapStyle, .expedition: throw Failure.invalidChange
            }
            next.pending.append(PendingMutation(operation: operation))
        }
        if pending.operation.kind == .trip, let id = pending.operation.value.object?["id"]?.string,
            let index = next.drafts?.firstIndex(where: { $0.id == id })
        {
            let expected = pending.operation.content(in: next.visible)
            next.drafts?[index].expected = expected
        }
        try save(next)
    }
}
