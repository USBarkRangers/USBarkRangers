import Foundation

/// Explicit-choice recovery, never an automatic stale-write retry. Preserve the
/// original operation's meaning and order instead of flattening the chain to a patch.
public enum NativeVisitRecovery {
    public enum Failure: Error { case missingVisitNeedsPermission, freshLocationRequired, changedSelection }
    public struct Result: Sendable {
        public let change: NativeVisitChange?
        public let recreatedAsManual: Bool
        public let usesOriginalLocation: Bool
    }
    public static func rebase(
        _ original: NativeVisitChange, onto current: NativeVisitWorkingState,
        allowManualRecreation: Bool, newID: String = UUID().uuidString.lowercased()
    ) throws -> Result {
        try original.validate()
        guard current.siteID == original.intent.target.siteID,
            current.officialPlaceID == original.intent.target.officialPlaceID, !current.needsDetail
        else { throw Failure.changedSelection }
        let target = current.target(newID: newID)
        let before = current.draft
        let after: NativeVisitDraft?
        let edit: NativeVisitIntent.Edit
        var recreated = false
        var usesLocation = false
        switch original.intent.edit {
        case .remove:
            guard before != nil else {
                return .init(change: nil, recreatedAsManual: false, usesOriginalLocation: false)
            }
            after = nil
            edit = .remove
        case .mark(_, _, let proximity):
            if var existing = before {
                guard let proximity, !existing.verified else {
                    return .init(change: nil, recreatedAsManual: false, usesOriginalLocation: false)
                }
                existing.proximity = proximity
                after = existing
                usesLocation = true
            } else {
                guard let desired = original.after else { throw Failure.changedSelection }
                // An upgrade that lost its visit is a restoration, not a fresh check-in.
                // The UI must disclose that restoration creates a new manual event.
                recreated = original.before != nil
                if recreated, !allowManualRecreation { throw Failure.missingVisitNeedsPermission }
                after = desired.recovered(as: target.visitID, retainingProximity: !recreated)
                usesLocation = !recreated && proximity != nil
            }
            guard let after else { throw Failure.changedSelection }
            edit = .mark(
                happenedAtMs: after.happenedAtMs, timeZone: after.timeZone, proximity: after.proximity)
        case .changeDate(let at, let zone):
            if var existing = before {
                if existing.happenedAtMs == at, existing.timeZone == zone {
                    return .init(change: nil, recreatedAsManual: false, usesOriginalLocation: false)
                }
                existing.happenedAtMs = at
                existing.timeZone = zone
                after = existing
                edit = .changeDate(happenedAtMs: at, timeZone: zone)
            } else {
                guard allowManualRecreation else { throw Failure.missingVisitNeedsPermission }
                guard let desired = original.after else { throw Failure.changedSelection }
                after = desired.recovered(as: target.visitID, retainingProximity: false)
                edit = .mark(happenedAtMs: at, timeZone: zone, proximity: nil)
                recreated = true
            }
        }
        let change = NativeVisitChange(
            intent: .init(target: target, edit: edit), before: before, after: after)
        try change.validate()
        return .init(change: change, recreatedAsManual: recreated, usesOriginalLocation: usesLocation)
    }
}
