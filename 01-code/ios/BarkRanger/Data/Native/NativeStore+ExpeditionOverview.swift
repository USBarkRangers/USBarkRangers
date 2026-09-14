import BarkDomain
import Foundation

extension NativeStore {
    struct ExpeditionOverview: Equatable, Sendable {
        var state: NativeExpeditionState?
        var hasConfirmedSelection = false
        var activeRun: NativeVirtualRun?
        var selectionRevision: Int64 = 0
        var runID: String?
        var pendingTrailID: String?
        var pendingIDs: [UUID] = []
        var conflicts: [UUID] = []
        var runHasPendingChanges = false
        var selectionBlocked = false
    }

    /// Only current selection and queue metadata. Pending work never gets added to
    /// a newer confirmed total: a lost acknowledgment cannot count a walk twice.
    func nativeExpeditionOverview() throws -> ExpeditionOverview {
        let state = try nativeExpeditionState()
        let run = try state?.activeRunID.flatMap { try nativeVirtualRun(id: $0) }
        var value = ExpeditionOverview(
            state: state, activeRun: run,
            selectionRevision: state?.selectionRevision ?? 0, runID: state?.activeRunID)
        value.hasConfirmedSelection = try expeditionRow() != nil
        let queue = try expeditionQueue()
        for entry in queue {
            value.pendingIDs.append(entry.id)
            if entry.needsDecision { value.conflicts.append(entry.id) }
            // Only selection writers affect selection. An unrelated historical edit
            // must not disable recording or replace the current trail.
            guard entry.keys.writes.contains("selection") else { continue }
            value.selectionBlocked = value.selectionBlocked || entry.needsDecision
            switch try expeditionOperation(entry.id).action {
            case .assign(let trailID, let runID, let expected, _):
                if expected >= value.selectionRevision {
                    value.selectionRevision = expected + 1
                    value.runID = runID
                    value.pendingTrailID = trailID
                    value.activeRun = nil
                }
            case .claim(let runID, _):
                if value.runID == runID {
                    value.selectionRevision += 1
                    value.runID = nil
                    value.pendingTrailID = nil
                    value.activeRun = nil
                }
            default: break
            }
        }
        if let id = value.runID {
            value.runHasPendingChanges = queue.contains { $0.keys.writes.contains("run:\(id)") }
        }
        return value
    }

    func assignNativeTrail(_ trail: Trail, matching selection: ExpeditionOverview) throws {
        let current = try nativeExpeditionOverview()
        guard current.hasConfirmedSelection, !current.selectionBlocked, current.runID == selection.runID,
            current.selectionRevision == selection.selectionRevision,
            try Trail.bundled().contains(trail)
        else { throw Failure.unavailable }
        _ = try stageNativeExpeditionOperation(
            .init(
                action: .assign(
                    trailID: trail.id,
                    runID: UUID().uuidString.lowercased(), selectionRevision: current.selectionRevision,
                    expectedActiveRunID: current.runID)))
    }

    func claimNativeRun(_ selected: NativeVirtualRun) throws {
        let current = try nativeExpeditionOverview()
        guard current.activeRun == selected, !current.runHasPendingChanges,
            !current.selectionBlocked, selected.fraction >= 1
        else { throw Failure.unavailable }
        _ = try stageNativeExpeditionOperation(
            .init(action: .claim(runID: selected.id, revision: selected.revision)))
    }
}
