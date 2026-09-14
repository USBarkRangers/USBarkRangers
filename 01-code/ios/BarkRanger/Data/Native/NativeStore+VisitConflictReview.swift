import BarkDomain
import Foundation

extension NativeStore {
    struct VisitConflictGroup: Equatable, Sendable {
        let rootID: UUID
        let entries: [VisitQueueEntry]
        let references: [NativeVisitReference]
        var siteIDs: Set<String> { Set(references.map(\.siteID)) }
    }
    struct VisitConflictReview: Sendable {
        struct Site: Sendable {
            let siteID: String
            let local: NativeVisitDraft?
            let remote: NativeVisitDraft?
            let proposed: NativeVisitDraft?
        }
        let group: VisitConflictGroup
        let selection: NativeVisitSelection
        let sites: [Site]
        let localPlan: VisitRecoveryPlan
    }
    /// Bulk operations connect their participating sites. The user's choice covers
    /// that explicit connected group, not unrelated queued work. An uncertain sealed
    /// command must receive its reply before it can be included in any replacement.
    func visitConflictGroup(_ rootID: UUID) throws -> VisitConflictGroup {
        try requireOpen()
        let queue = try visitQueue()
        guard let root = queue.first(where: { $0.id == rootID }), root.needsDecision else {
            throw Failure.invalidAcknowledgment
        }
        var sites = Set(root.keys.siteIDs)
        for _ in 0..<queue.count {
            let previous = sites
            for entry in queue where !sites.isDisjoint(with: entry.keys.siteIDs) {
                sites.formUnion(entry.keys.siteIDs)
            }
            if sites == previous { break }
        }
        let entries = queue.filter { !sites.isDisjoint(with: $0.keys.siteIDs) }
        guard sites.count <= 500, entries.allSatisfy({ $0.state != "sealed" }) else {
            throw Failure.unavailable
        }
        let pending = try visitPendingChanges(siteIDs: sites, queue: entries)
        let references = try sites.sorted().map { site -> NativeVisitReference in
            guard let value = pending[site] else { throw Failure.corrupt }
            return .init(target: value.change.intent.target)
        }
        return .init(rootID: rootID, entries: entries, references: references)
    }
    func reviewVisitConflict(group: VisitConflictGroup, selection: NativeVisitSelection, now: Date = Date())
        throws
        -> VisitConflictReview
    {
        try requireOpen()
        guard try visitConflictGroup(group.rootID) == group else { throw Failure.invalidAcknowledgment }
        try requireCurrentVisitSelection(selection, siteIDs: group.siteIDs)
        let pending = try visitPendingChanges(siteIDs: group.siteIDs, queue: group.entries)
        let plan = try planVisitRecovery(group: group, selection: selection, now: now)
        let remote = Dictionary(
            uniqueKeysWithValues: selection.visits.compactMap { record in
                NativeVisitDraft(record: record).map { (record.siteID, $0) }
            })
        let sites = group.references.map {
            VisitConflictReview.Site(
                siteID: $0.siteID, local: pending[$0.siteID]?.change.after, remote: remote[$0.siteID],
                proposed: plan.finalStates[$0.siteID]?.draft)
        }
        return .init(group: group, selection: selection, sites: sites, localPlan: plan)
    }
    func requireCurrentVisitSelection(_ selection: NativeVisitSelection, siteIDs: Set<String>) throws {
        try selection.validate(for: selection.requests)
        guard Set(selection.requests.map(\.siteID)) == siteIDs, selection.requests.count == siteIDs.count
        else {
            throw Failure.invalidAcknowledgment
        }
        let requested = Dictionary(uniqueKeysWithValues: selection.requests.map { ($0.siteID, $0.visitID) })
        let markers = Dictionary(uniqueKeysWithValues: selection.places.map { ($0.id, $0) })
        for siteID in siteIDs {
            let marker = markers[siteID]
            if let id = marker?.visitID, requested[siteID] != id { throw Failure.unavailable }
            if let known = try nativePlaceProgress(siteID: siteID) {
                guard let marker, known.revision <= marker.revision else {
                    throw Failure.invalidAcknowledgment
                }
                if known.revision == marker.revision, known != marker { throw Failure.corrupt }
            }
        }
    }
}
