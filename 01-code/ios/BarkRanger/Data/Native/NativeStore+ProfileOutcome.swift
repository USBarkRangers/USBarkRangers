import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func acceptProfileOutcome(_ outcome: NativeProfileOutcome, canonical: NativeProfile) throws {
        try requireOpen()
        try canonical.validate()
        guard outcome.version == 1, outcome.revisions.profile >= 1,
            canonical.revision >= outcome.revisions.profile
        else { throw Failure.invalidAcknowledgment }
        // An already committed acknowledgment needs no second local mutation.
        guard let row = try operation(outcome.operationID) else { return }
        guard row.entityKey == "profile", row.state == "sealed", row.sealedBytes != nil,
            let expected = row.expectedRevision
        else { throw Failure.invalidAcknowledgment }
        let edit = try JSONDecoder().decode(NativeProfileEdit.self, from: row.intent)
        if outcome.status == .accepted, edit != .bootstrap {
            guard outcome.revisions.profile == expected + 1 else { throw Failure.invalidAcknowledgment }
        }
        do {
            try upsert(canonical)
            if outcome.status == .conflict {
                row.state = "conflict"
                row.failureCode = "conflict"
            } else {
                let key = row.id
                var request = FetchDescriptor<NativeLocalSchema.PendingOperation>(
                    predicate: #Predicate { $0.predecessor == key })
                request.fetchLimit = 2
                let children = try modelContext.fetch(request)
                guard children.count <= 1 else { throw Failure.corrupt }
                for child in children {
                    guard child.state == "queued", child.sealedBytes == nil else { throw Failure.corrupt }
                    child.predecessor = nil
                    // Use the accepted predecessor, not an unrelated newer remote revision.
                    // Otherwise an offline chain would silently overwrite somebody else's edit.
                    child.expectedRevision = outcome.revisions.profile
                }
                modelContext.delete(row)
            }
            try commitProfileChange()  // Confirmed entity + acknowledgment + dependency advance, atomically.
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    func rejectProfileOperation(_ id: UUID, code: String) throws {
        try requireOpen()
        let allowed = [
            "invalid", "operation-reused", "unsupported-contract", "premium-required",
            "account-deleting", "intent-expired", "forbidden",
        ]
        guard allowed.contains(code), let row = try operation(id), row.state == "sealed" else {
            throw Failure.corrupt
        }
        do {
            row.state = "rejected"
            row.failureCode = code
            try commitProfileChange()  // Retain intent and dependent edits for explicit recovery.
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
