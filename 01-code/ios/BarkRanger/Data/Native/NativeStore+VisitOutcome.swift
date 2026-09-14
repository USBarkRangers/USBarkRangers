import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func acceptNativeVisitOutcome(_ outcome: NativeVisitOutcome, selection: NativeVisitSelection) throws {
        try requireOpen()
        try outcome.validate()
        guard try operation(outcome.operationID) != nil else { return }
        let value = try visitOperation(outcome.operationID)
        guard case .single(let change) = value else { throw Failure.invalidAcknowledgment }
        try applyVisitOutcome(
            id: outcome.operationID, status: outcome.status, value: value, selection: selection,
            visitRevisions: [change.intent.target.visitID: outcome.revisions.visit],
            placeRevisions: [change.intent.target.siteID: outcome.revisions.placeProgress],
            progressRevision: outcome.revisions.progress)
    }
    func acceptNativeBulkVisitOutcome(_ outcome: NativeBulkVisitOutcome, selection: NativeVisitSelection)
        throws
    {
        try requireOpen()
        try outcome.validate()
        guard try operation(outcome.operationID) != nil else { return }
        let value = try visitOperation(outcome.operationID)
        guard value.isBulk else { throw Failure.invalidAcknowledgment }
        try applyVisitOutcome(
            id: outcome.operationID, status: outcome.status, value: value, selection: selection,
            visitRevisions: outcome.revisions.visits, placeRevisions: outcome.revisions.places,
            progressRevision: outcome.revisions.progress)
    }
    private func applyVisitOutcome(
        id: UUID, status: NativeVisitOutcome.Status, value: NativeVisitOperation,
        selection: NativeVisitSelection, visitRevisions: [String: Int64], placeRevisions: [String: Int64],
        progressRevision: Int64
    ) throws {
        let references = value.changes.map { NativeVisitReference(target: $0.intent.target) }
        try selection.validate(for: references)
        guard let row = try operation(id), row.state == "sealed", row.sealedBytes != nil,
            Set(visitRevisions.keys) == Set(references.map(\.visitID)),
            Set(placeRevisions.keys) == Set(references.map(\.siteID)),
            (selection.progress?.revision ?? 0) >= progressRevision
        else { throw Failure.invalidAcknowledgment }
        let queue = try visitQueue()
        let precedingSites = Set(queue.prefix(while: { $0.id != id }).flatMap { $0.keys.siteIDs })
        guard precedingSites.isDisjoint(with: value.siteIDs) else { throw Failure.invalidAcknowledgment }
        let visits = Dictionary(uniqueKeysWithValues: selection.visits.map { ($0.id, $0) })
        let places = Dictionary(uniqueKeysWithValues: selection.places.map { ($0.id, $0) })
        for change in value.changes {
            let target = change.intent.target
            guard let visitRevision = visitRevisions[target.visitID],
                let placeRevision = placeRevisions[target.siteID],
                (visits[target.visitID]?.revision ?? 0) >= visitRevision,
                (places[target.siteID]?.revision ?? 0) >= placeRevision
            else {
                throw Failure.invalidAcknowledgment
            }
            if status == .accepted {
                guard visitRevision == target.visitRevision + 1, placeRevision == target.placeRevision + 1
                else {
                    throw Failure.invalidAcknowledgment
                }
            }
        }
        do {
            try stageVisitSelection(selection)
            if status == .accepted {
                modelContext.delete(row)
            } else {
                row.state = "conflict"
                row.failureCode = "conflict"
            }
            try stageVisitCacheRetention()
            try commit()  // Canonical cache and receipt acknowledgment move together.
            publish(
                Set(references.map { .visit($0.visitID) }).union([
                    .pending, .markers, .visitHistory, .progress,
                ]))
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
