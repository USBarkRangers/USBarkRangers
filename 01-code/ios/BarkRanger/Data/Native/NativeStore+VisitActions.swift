import BarkDomain
import Foundation

extension NativeStore {
    /// Marking is a current-status action. Date edits/removals instead use an explicit
    /// captured selection below; none of these paths rebuild the account's history.
    @discardableResult func markNativeVisit(
        park: Park, fix: LocationFix? = nil, now: Date = Date(), timeZone: TimeZone = .current
    ) throws -> UUID? {
        try requireOpen()
        guard !park.isRetired else { throw VisitPolicy.Failure.retired }
        if let fix { try VisitPolicy.evaluateProximity(park: park, fix: fix, now: now) }
        let current = try nativeVisitWorkingState(
            siteID: park.siteID.rawValue, officialPlaceID: park.id.rawValue)
        guard !current.needsDecision else { throw VisitPolicy.Failure.unresolved }
        if current.visitID != nil, fix == nil { return nil }
        guard !current.needsDetail else { throw Failure.unavailable }
        if current.draft?.verified == true { return nil }
        let target = current.target()
        var after: NativeVisitDraft
        if let before = current.draft {
            after = before
            after.proximity = try fix.map(NativeVisitRecord.Proximity.init)
        } else {
            after = try NativeVisitDraft(
                park: park, id: target.visitID, now: now, timeZone: timeZone, fix: fix)
        }
        let intent = NativeVisitIntent(
            target: target,
            edit: .mark(
                happenedAtMs: after.happenedAtMs, timeZone: after.timeZone, proximity: after.proximity))
        return try stageNativeVisitOperation(
            .single(.init(intent: intent, before: current.draft, after: after)), now: now)
    }
    @discardableResult func changeNativeVisitDate(
        selected: NativeVisitWorkingState, date: Date, timeZone: TimeZone, now: Date = Date()
    ) throws -> UUID? {
        try requireOpen()
        guard date <= now.addingTimeInterval(60) else { throw VisitPolicy.Failure.invalidDate }
        let milliseconds = try NativeVisitDraft.milliseconds(date)
        try requireNativeVisitSelections([selected])
        guard let before = selected.draft else { throw VisitPolicy.Failure.unresolved }
        if before.happenedAtMs == milliseconds, before.timeZone == timeZone.identifier { return nil }
        var after = before
        after.happenedAtMs = milliseconds
        after.timeZone = timeZone.identifier
        return try stageNativeVisitOperation(
            .single(
                .init(
                    intent: .init(
                        target: selected.target(),
                        edit: .changeDate(happenedAtMs: milliseconds, timeZone: timeZone.identifier)),
                    before: before, after: after)), now: now)
    }
    @discardableResult func removeNativeVisits(
        selected: [NativeVisitWorkingState], now: Date = Date()
    ) throws -> UUID? {
        try requireOpen()
        if selected.isEmpty { return nil }
        guard selected.count <= 500, Set(selected.map(\.siteID)).count == selected.count else {
            throw VisitPolicy.Failure.unresolved
        }
        try requireNativeVisitSelections(selected)
        let changes = try selected.map { value -> NativeVisitChange in
            guard let before = value.draft else { throw VisitPolicy.Failure.unresolved }
            return .init(intent: .init(target: value.target(), edit: .remove), before: before, after: nil)
        }
        // One selection remains one atomic command, including offline and retry paths.
        let operation: NativeVisitOperation = changes.count == 1 ? .single(changes[0]) : .removeMany(changes)
        return try stageNativeVisitOperation(operation, now: now)
    }
}
