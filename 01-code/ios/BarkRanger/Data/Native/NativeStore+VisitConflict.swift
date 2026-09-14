import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    struct VisitResolution: Sendable {
        let replacementIDs: [UUID]
        let manuallyRecreatedSiteIDs: Set<String>
    }
    enum VisitChoice: Sendable {
        case keepRemote
        case keepLocal(allowManualRecreation: Bool)
    }
    func resolveVisitConflict(
        _ review: VisitConflictReview, choice: VisitChoice, now: Date = Date()
    ) throws -> VisitResolution {
        try requireOpen()
        guard try visitConflictGroup(review.group.rootID) == review.group else {
            throw Failure.invalidAcknowledgment
        }
        try requireCurrentVisitSelection(review.selection, siteIDs: review.group.siteIDs)
        let selected: [VisitRecoveryPlan.Operation]
        let recreated: Set<String>
        switch choice {
        case .keepRemote:
            selected = []
            recreated = []
        case .keepLocal(let allowRecreation):
            guard !isGuest, try readEntitlement()?.permitsEditing(at: now) == true,
                try profileView().confirmed?.status == .active
            else { throw Failure.unavailable }
            recreated = review.localPlan.manuallyRecreatedSiteIDs
            if !allowRecreation, !recreated.isEmpty {
                throw NativeVisitRecovery.Failure.missingVisitNeedsPermission
            }
            if review.localPlan.needsFreshLocation(at: now) {
                throw NativeVisitRecovery.Failure.freshLocationRequired
            }
            selected = review.localPlan.operations
        }
        var changes: Set<Change> = [.pending, .markers, .visitHistory, .progress]
        do {
            try stageVisitSelection(review.selection)
            for entry in review.group.entries {
                let original = try visitOperation(entry.id)
                guard let row = try operation(entry.id) else { throw Failure.corrupt }
                for change in original.changes { changes.insert(.visit(change.intent.target.visitID)) }
                modelContext.delete(row)
            }
            for planned in selected {
                // Commit the reviewed IDs and original observation time, not a newly
                // recomputed action or GPS fix. All replacements are one local commit.
                _ = try insertVisitOperation(planned.value, now: planned.createdAt, id: planned.id)
                for change in planned.value.changes { changes.insert(.visit(change.intent.target.visitID)) }
            }
            try stageVisitCacheRetention()
            try commit()
            publish(changes)
            return .init(replacementIDs: selected.map(\.id), manuallyRecreatedSiteIDs: recreated)
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
