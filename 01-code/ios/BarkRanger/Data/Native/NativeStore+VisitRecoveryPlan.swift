import BarkDomain
import Foundation

extension NativeStore {
    struct VisitRecoveryPlan: Sendable {
        struct Operation: Sendable {
            let id: UUID
            let value: NativeVisitOperation
            let createdAt: Date
            let usesOriginalLocation: Bool
        }
        let operations: [Operation]
        let finalStates: [String: NativeVisitWorkingState]
        let manuallyRecreatedSiteIDs: Set<String>
        func needsFreshLocation(at now: Date) -> Bool {
            operations.contains {
                $0.usesOriginalLocation && $0.createdAt < now.addingTimeInterval(-NativeSyncPolicy.acceptanceWindow)
            }
        }
    }
    /// The review displays the exact proposed effect; commit consumes this same plan.
    /// Another device's existing visit may make a queued manual mark a no-op while a
    /// following date correction still applies. Never label the original draft as the
    /// recovery result when those values differ.
    func planVisitRecovery(
        group: VisitConflictGroup, selection: NativeVisitSelection, now: Date
    ) throws -> VisitRecoveryPlan {
        var working = conflictWorkingStates(selection)
        var operations: [VisitRecoveryPlan.Operation] = []
        var recreated = Set<String>()
        for entry in group.entries {
            let original = try visitOperation(entry.id)
            guard let row = try operation(entry.id) else { throw Failure.corrupt }
            var rebased: [NativeVisitChange] = []
            var usesLocation = false
            for change in original.changes {
                let site = change.intent.target.siteID
                guard let current = working[site] else { throw Failure.corrupt }
                let result = try NativeVisitRecovery.rebase(
                    change, onto: current, allowManualRecreation: true)
                if let replacement = result.change { rebased.append(replacement) }
                if result.recreatedAsManual { recreated.insert(site) }
                usesLocation = usesLocation || result.usesOriginalLocation
            }
            guard !rebased.isEmpty else { continue }
            let value: NativeVisitOperation = original.isBulk ? .removeMany(rebased) : .single(rebased[0])
            let id = UUID()
            let created = usesLocation ? Date(timeIntervalSince1970: Double(row.createdAtMs) / 1000) : now
            operations.append(
                .init(id: id, value: value, createdAt: created, usesOriginalLocation: usesLocation))
            for change in rebased {
                let target = change.intent.target
                working[target.siteID] = .init(
                    officialPlaceID: target.officialPlaceID, siteID: target.siteID,
                    visitID: change.after?.id,
                    visitRevision: change.after == nil ? 0 : target.visitRevision + 1,
                    placeRevision: target.placeRevision + 1, draft: change.after,
                    pendingOperationID: id, needsDecision: false)
            }
        }
        return .init(operations: operations, finalStates: working, manuallyRecreatedSiteIDs: recreated)
    }
    private func conflictWorkingStates(_ selection: NativeVisitSelection) -> [String: NativeVisitWorkingState]
    {
        let records = Dictionary(uniqueKeysWithValues: selection.visits.map { ($0.id, $0) })
        let markers = Dictionary(uniqueKeysWithValues: selection.places.map { ($0.id, $0) })
        return Dictionary(
            uniqueKeysWithValues: selection.requests.map { reference in
                let marker = markers[reference.siteID]
                let draft = marker?.visitID.flatMap { records[$0] }.flatMap(NativeVisitDraft.init)
                return (
                    reference.siteID,
                    .init(
                        officialPlaceID: marker?.officialPlaceID ?? reference.officialPlaceID,
                        siteID: reference.siteID,
                        visitID: marker?.visitID, visitRevision: marker?.visitRevision ?? 0,
                        placeRevision: marker?.revision ?? 0, draft: draft, pendingOperationID: nil,
                        needsDecision: false)
                )
            })
    }
}
