import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    /// Explicit user decision after displaying the current canonical profile. Submitted
    /// bytes are never edited or silently rebased. A kept edit becomes a new operation.
    func resolveProfileConflict(
        keepingLocalEdits: Bool, confirmedRevision: Int64,
        now: Date = Date(), expectedPendingIDs: [UUID]
    ) throws {
        try requireOpen()
        let pending = try profileOperations()
        if pending.map(\.id) != expectedPendingIDs.map({ $0.uuidString.lowercased() }) {
            throw Failure.invalidAcknowledgment
        }
        guard let first = pending.first, ["conflict", "rejected"].contains(first.state),
            let confirmed = try profileView().confirmed,
            confirmed.revision == confirmedRevision
        else { throw Failure.invalidAcknowledgment }
        let edits = try pending.map { try JSONDecoder().decode(NativeProfileEdit.self, from: $0.intent) }
        // All validation occurs before mutation; a cancelled/failed recovery leaves original
        // sealed evidence and every dependent local edit intact.
        for edit in edits { try edit.validate() }
        let milliseconds = now.timeIntervalSince1970 * 1000
        guard milliseconds.isFinite, (0...9_007_199_254_740_991).contains(milliseconds) else {
            throw Failure.corrupt
        }
        if keepingLocalEdits {
            guard confirmed.status == .active, try readEntitlement()?.permitsEditing(at: now) == true else {
                throw Failure.unavailable
            }
        }
        do {
            var query = FetchDescriptor<NativeLocalSchema.Metadata>()
            query.fetchLimit = 2
            let metadata = try modelContext.fetch(query)
            guard metadata.count == 1, let head = metadata.first,
                (0..<(Int64.max - Int64(edits.count))).contains(head.sequence)
            else { throw Failure.corrupt }
            for row in pending { modelContext.delete(row) }
            if keepingLocalEdits {
                var predecessor: String?
                for edit in edits where edit != .bootstrap {
                    head.sequence += 1
                    let id = UUID().uuidString.lowercased()
                    let row = NativeLocalSchema.PendingOperation(
                        id: id, entityKey: "profile",
                        sequence: head.sequence, createdAtMs: Int64(milliseconds),
                        intent: try JSONEncoder().encode(edit), predecessor: predecessor,
                        expectedRevision: predecessor == nil ? confirmedRevision : nil)
                    modelContext.insert(row)
                    predecessor = id
                }
            }
            try commitProfileChange()
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
