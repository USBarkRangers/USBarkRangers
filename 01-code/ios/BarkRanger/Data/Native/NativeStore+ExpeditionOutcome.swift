import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func acceptNativeExpeditionOutcome(
        _ outcome: NativeExpeditionOutcome, snapshot: NativeExpeditionSnapshot
    ) throws {
        try requireOpen()
        try outcome.validate()
        guard let row = try operation(outcome.operationID) else { return }
        let value = try expeditionOperation(outcome.operationID)
        try snapshot.validate(activityID: value.action.activityID, runID: value.selectedRunID)
        if snapshot.activityID != nil, let floor = try activityHistoryFloor(), snapshot.readTime < floor {
            // Do not dequeue authored data if the matching detail would be rejected
            // by the cache's stale-read fence. Replay the same sealed command instead.
            throw Failure.staleRead
        }
        let revisions = outcome.revisions
        guard row.state == "sealed", row.sealedBytes != nil,
            (snapshot.state?.revision ?? 0) >= revisions.state,
            (snapshot.state?.selectionRevision ?? 0) >= revisions.selection,
            (snapshot.progress?.revision ?? 0) >= revisions.progress,
            (snapshot.activity?.revision ?? 0) >= revisions.activity,
            snapshot.activityClaimed || revisions.activityClaim == 0
        else { throw Failure.invalidAcknowledgment }
        if revisions.run > 0 {
            guard let runID = value.selectedRunID,
                (snapshot.runs.first(where: { $0.id == runID })?.revision ?? 0) >= revisions.run
            else { throw Failure.invalidAcknowledgment }
        }
        let earlier = try expeditionQueue().prefix(while: { $0.id != outcome.operationID })
        guard !earlier.contains(where: { $0.keys.conflicts(with: value.keys) }) else {
            throw Failure.invalidAcknowledgment
        }
        if outcome.status == .accepted { try requireAcceptedExpeditionRevisions(outcome, value: value) }
        do {
            try stageExpeditionSnapshot(snapshot)
            if outcome.status == .accepted {
                modelContext.delete(row)
            } else {
                row.state = "conflict"
                row.failureCode = "conflict"
            }
            try stageActivityCacheRetention()
            try commit()  // Cache, permanent-identity evidence and dequeue are one transaction.
            var changes: Set<Change> = [.pending, .expedition, .activityHistory, .progress]
            if let id = value.action.activityID { changes.insert(.activity(id)) }
            if case .claim = value.action, outcome.status == .accepted { changes.insert(.completionClaimed) }
            publish(changes)
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    private func requireAcceptedExpeditionRevisions(
        _ outcome: NativeExpeditionOutcome, value: NativeExpeditionOperation
    ) throws {
        let revisions = outcome.revisions
        switch value.action {
        case .record:
            // Exact reimport is accepted without a write, including after deletion
            // and tombstone expiration. Its activity revision can legitimately be 0.
            guard revisions.activityClaim == 1 else { throw Failure.invalidAcknowledgment }
        case .edit(_, let expected, _, _, _), .remove(_, let expected):
            guard revisions.activityClaim == 1, revisions.activity == expected + 1 else {
                throw Failure.invalidAcknowledgment
            }
        case .assign(_, _, let expected, _):
            guard revisions.selection == expected + 1, revisions.run == 1 else {
                throw Failure.invalidAcknowledgment
            }
        case .claim(_, let expected):
            guard revisions.run == expected + 1 else { throw Failure.invalidAcknowledgment }
        }
    }
}
