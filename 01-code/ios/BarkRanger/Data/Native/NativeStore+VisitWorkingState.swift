import BarkDomain
import Foundation

extension NativeStore {
    struct VisitPendingChange {
        let entry: VisitQueueEntry
        let change: NativeVisitChange
    }
    func nativeVisitWorkingState(siteID: String, officialPlaceID: String) throws -> NativeVisitWorkingState {
        try requireOpen()
        let queue = try visitQueue()
        return try visitWorkingState(
            siteID: siteID, officialPlaceID: officialPlaceID,
            pending: visitPendingChanges(siteIDs: [siteID], queue: queue)[siteID],
            needsDecision: visitBlockedSites(queue).contains(siteID))
    }
    /// Decode each relevant intent at most once, including a 500-site bulk operation.
    /// Repeated per-site lookup would decode the same bulk body hundreds of times.
    func visitPendingChanges(siteIDs: Set<String>, queue: [VisitQueueEntry]) throws -> [String:
        VisitPendingChange]
    {
        var remaining = siteIDs
        var values: [String: VisitPendingChange] = [:]
        for entry in queue.reversed() where !remaining.isDisjoint(with: entry.keys.siteIDs) {
            let operation = try visitOperation(entry.id)
            for change in operation.changes where remaining.remove(change.intent.target.siteID) != nil {
                values[change.intent.target.siteID] = .init(entry: entry, change: change)
            }
            if remaining.isEmpty { break }
        }
        return values
    }
    func visitWorkingState(
        siteID: String, officialPlaceID: String, pending: VisitPendingChange?, needsDecision: Bool
    ) throws -> NativeVisitWorkingState {
        if let pending {
            let change = pending.change
            let target = change.intent.target
            return NativeVisitWorkingState(
                officialPlaceID: target.officialPlaceID, siteID: siteID, visitID: change.after?.id,
                visitRevision: change.after == nil ? 0 : target.visitRevision + 1,
                placeRevision: target.placeRevision + 1, draft: change.after,
                pendingOperationID: pending.entry.id, needsDecision: needsDecision)
        }
        let marker = try nativePlaceProgress(siteID: siteID)
        let record = try marker?.visitID.flatMap { try nativeVisit(id: $0) }
        var draft: NativeVisitDraft?
        if let record {
            guard record.id == marker?.visitID, record.siteID == siteID else { throw Failure.corrupt }
            // History and marker feeds have independent read times. A newer history
            // detail is valid but cannot supply the unseen slot preimage for an edit.
            // Request a consistent point read rather than calling that overlap corruption.
            if record.revision == marker?.visitRevision, !record.deleted {
                draft = NativeVisitDraft(record: record)
            }
        }
        return NativeVisitWorkingState(
            officialPlaceID: marker?.officialPlaceID ?? officialPlaceID, siteID: siteID,
            visitID: marker?.visitID, visitRevision: marker?.visitRevision ?? 0,
            placeRevision: marker?.revision ?? 0, draft: draft,
            pendingOperationID: nil, needsDecision: needsDecision)
    }
    func visitBlockedSites(_ queue: [VisitQueueEntry]) -> Set<String> {
        var blocked = Set<String>()
        for entry in queue where entry.needsDecision || !blocked.isDisjoint(with: entry.keys.siteIDs) {
            blocked.formUnion(entry.keys.siteIDs)
        }
        return blocked
    }
    func requireNativeVisitSelections(_ selected: [NativeVisitWorkingState]) throws {
        let queue = try visitQueue()
        let pending = try visitPendingChanges(siteIDs: Set(selected.map(\.siteID)), queue: queue)
        let blocked = visitBlockedSites(queue)
        for value in selected {
            let current = try visitWorkingState(
                siteID: value.siteID, officialPlaceID: value.officialPlaceID,
                pending: pending[value.siteID], needsDecision: blocked.contains(value.siteID))
            try requireVisitSelection(value, matching: current)
        }
    }
    private func requireVisitSelection(
        _ selected: NativeVisitWorkingState, matching current: NativeVisitWorkingState
    ) throws {
        // The detail cache may have been evicted since selection. Compare identity and
        // revisions, then check the captured body against any still-present body.
        guard current.officialPlaceID == selected.officialPlaceID, current.siteID == selected.siteID,
            current.visitID == selected.visitID, current.visitRevision == selected.visitRevision,
            current.placeRevision == selected.placeRevision,
            current.draft == nil || current.draft == selected.draft
        else { throw Failure.unavailable }
        guard !current.needsDecision else { throw VisitPolicy.Failure.unresolved }
    }
}
