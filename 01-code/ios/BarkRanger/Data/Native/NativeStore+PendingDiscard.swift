import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    struct PendingDiscard: Equatable, Sendable {
        let rootID: UUID
        let ids: [UUID]
        let retainsTripDraft: Bool
    }

    /// Removing a predecessor also removes its never-sent dependent suffix. Review
    /// captures exact IDs; a later save/send invalidates that review instead of being lost.
    /// One exception to never-sent: a refused saved pin. The server answered and applied
    /// nothing, pins have no review screen, and the refused head blocks every later edit
    /// to that pin, so discarding it is the only exit. Other features keep their own review.
    func reviewPendingDiscard(_ id: UUID) throws -> PendingDiscard {
        try requireOpen()
        guard let root = try operation(id) else { throw Failure.unavailable }
        let refusedPin = root.state == "rejected" && root.entityKey.hasPrefix("savedPin:")
        guard refusedPin || (root.state == "queued" && root.sealedBytes == nil) else {
            throw Failure.unavailable
        }
        let ids: [UUID]
        switch root.entityKey {
        case "profile":
            ids = try profileOperations().filter { $0.sequence >= root.sequence }.map { row in
                guard let id = UUID(uuidString: row.id) else { throw Failure.corrupt }
                return id
            }
        case "visits":
            var sites = Set<String>()
            ids = try visitQueue().filter { $0.sequence >= root.sequence }.compactMap { entry in
                guard entry.id == id || !sites.isDisjoint(with: entry.keys.siteIDs) else { return nil }
                sites.formUnion(entry.keys.siteIDs)
                return entry.id
            }
        case "expedition":
            var keys: [NativeExpeditionOperation.Keys] = []
            ids = try expeditionQueue().filter { $0.sequence >= root.sequence }.compactMap { entry in
                guard entry.id == id || keys.contains(where: { $0.conflicts(with: entry.keys) }) else {
                    return nil
                }
                keys.append(entry.keys)
                return entry.id
            }
        default:
            if root.entityKey.hasPrefix("savedPin:") {
                ids = try savedPinOperations(String(root.entityKey.dropFirst(9)))
                    .filter { $0.sequence >= root.sequence }.map { row in
                        guard let id = UUID(uuidString: row.id) else { throw Failure.corrupt }
                        return id
                    }
                break
            }
            guard root.entityKey.hasPrefix("trip:") else { throw Failure.corrupt }
            ids = try tripOperations(String(root.entityKey.dropFirst(5)))
                .filter { $0.sequence >= root.sequence }.map { row in
                    guard let id = UUID(uuidString: row.id) else { throw Failure.corrupt }
                    return id
                }
        }
        for candidate in ids where !(refusedPin && candidate == id) {
            guard let row = try operation(candidate), row.state == "queued", row.sealedBytes == nil else {
                throw Failure.unavailable
            }
        }
        return .init(rootID: id, ids: ids, retainsTripDraft: root.entityKey.hasPrefix("trip:"))
    }

    func discardPending(_ review: PendingDiscard) throws {
        guard try reviewPendingDiscard(review.rootID) == review else { throw Failure.unavailable }
        do {
            var changes: Set<Change> = [.pending]
            for id in review.ids {
                guard let row = try operation(id) else { throw Failure.corrupt }
                if row.entityKey.hasPrefix("savedPin:") {
                    guard let pin = try savedPinRow(String(row.entityKey.dropFirst(9))) else {
                        throw Failure.corrupt
                    }
                    pin.changeSequence = try nextNativeSequence()
                    changes.insert(.savedPins)
                } else if row.entityKey == "visits" {
                    let value = try visitOperation(id)
                    changes.formUnion(value.changes.map { .visit($0.intent.target.visitID) })
                    changes.formUnion([.markers, .visitHistory])
                } else if row.entityKey == "expedition" {
                    if let activity = try expeditionOperation(id).action.activityID {
                        changes.insert(.activity(activity))
                    }
                    changes.formUnion([.expedition, .activityHistory])
                } else if row.entityKey.hasPrefix("trip:") {
                    let tripID = String(row.entityKey.dropFirst(5))
                    // Cancelling a queued save is not permission to erase the editor's
                    // newer writing. Retain that draft, now explicitly unsent/unsaved.
                    changes.formUnion([.trip(tripID), .draft(tripID), .library, .tripDrafts])
                }
                modelContext.delete(row)
            }
            try commitProfileChange()
            publish(changes)
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
