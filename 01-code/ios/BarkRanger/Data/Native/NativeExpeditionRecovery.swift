import BarkDomain
import Foundation

/// Rebase an explicitly reviewed dependency chain, not a generic JSON merge.
/// Activity identity, measurements and run attribution are never rewritten.
nonisolated enum NativeExpeditionRecovery {
    static func rebase(
        _ operations: [NativeExpeditionOperation], onto snapshot: NativeExpeditionSnapshot,
        failure: String?
    ) throws -> [NativeExpeditionOperation] {
        guard
            ![
                "activity-reused", "overlapping-activity", "unsupported-contract", "account-deleting",
                "invalid",
            ].contains(failure ?? "")
        else {
            throw NativeStore.Failure.unavailable
        }
        var activities: [String: NativeActivityDraft] = [:]
        for operation in operations {
            if let before = operation.beforeActivity, activities[before.id] == nil {
                activities[before.id] = before
            }
        }
        if let id = snapshot.activityID {
            activities[id] = try snapshot.activity.flatMap { try NativeActivityDraft(record: $0) }
        }
        var active = snapshot.state?.activeRunID
        var selection = snapshot.state?.selectionRevision ?? 0
        var revisions = Dictionary(uniqueKeysWithValues: snapshot.runs.map { ($0.id, $0.revision) })
        var miles = Dictionary(uniqueKeysWithValues: snapshot.runs.map { ($0.id, $0.miles) })
        var totals = Dictionary(uniqueKeysWithValues: snapshot.runs.map { ($0.id, $0.totalMiles) })
        var result: [NativeExpeditionOperation] = []
        for operation in operations {
            let next: NativeExpeditionOperation
            switch operation.action {
            case .record(let summary):
                if summary.activityID == snapshot.activityID, snapshot.activityClaimed {
                    guard let record = snapshot.activity, try NativeActivitySummary(record: record) == summary
                    else {
                        throw NativeStore.Failure.unavailable
                    }
                    continue  // The server already owns this exact import, including later corrections.
                }
                guard summary.runID == active else { throw NativeStore.Failure.unavailable }
                next = operation
                let after = try operation.afterActivity()
                activities[summary.activityID] = after
                if let active {
                    revisions[active, default: 0] += 1
                    miles[active, default: 0] += after?.miles ?? 0
                }
            case .edit(let id, _, _, _, _), .remove(let id, _):
                guard let before = activities[id] else { throw NativeStore.Failure.unavailable }
                let action: NativeExpeditionAction
                if case .edit(_, _, let meters, let date, let name) = operation.action {
                    action = .edit(
                        activityID: id, revision: before.revision, meters: meters, happenedAtMs: date,
                        trailName: name)
                } else {
                    action = .remove(activityID: id, revision: before.revision)
                }
                next = .init(action: action, beforeActivity: before)
                let after = try next.afterActivity()
                activities[id] = after
                if let active, before.summary.runID == active {
                    revisions[active, default: 0] += 1
                    miles[active, default: 0] += (after?.miles ?? 0) - before.miles
                }
            case .assign(let trailID, let id, _, _):
                guard revisions[id] == nil, let trail = try Trail.bundled().first(where: { $0.id == trailID })
                else {
                    throw NativeStore.Failure.unavailable
                }
                next = .init(
                    action: .assign(
                        trailID: trailID, runID: id, selectionRevision: selection, expectedActiveRunID: active
                    ))
                active = id
                selection += 1
                revisions[id] = 1
                miles[id] = 0
                totals[id] = trail.meters / 1609.344
            case .claim(let id, _):
                guard active == id, let revision = revisions[id], let distance = miles[id],
                    let total = totals[id], distance >= total
                else { throw NativeStore.Failure.unavailable }
                next = .init(action: .claim(runID: id, revision: revision))
                active = nil
                selection += 1
            }
            try next.validate()
            result.append(next)
        }
        return result
    }
}
