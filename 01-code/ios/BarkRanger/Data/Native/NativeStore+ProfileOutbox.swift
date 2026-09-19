import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    /// UI saves compare and enqueue on the writer actor in one uninterrupted turn.
    /// Repeated taps do not add writes; submitted operations remain immutable.
    func saveProfileEdit(_ edit: NativeProfileEdit, now: Date = Date()) throws {
        let view = try profileView()
        try edit.validate()
        guard edit != .bootstrap, let visible = view.visible, visible.status == .active,
            view.entitlement?.permitsEditing(at: now) == true
        else { throw Failure.unavailable }
        guard edit.applying(to: visible) != visible else { return }
        try stageProfileEdit(edit, now: now)
    }

    @discardableResult func stageProfileEdit(_ edit: NativeProfileEdit, now: Date = Date()) throws -> UUID {
        try requireOpen()
        guard !isGuest else { throw Failure.unavailable }
        try edit.validate()
        let milliseconds = now.timeIntervalSince1970 * 1000
        guard milliseconds.isFinite, (0...9_007_199_254_740_991).contains(milliseconds) else {
            throw Failure.corrupt
        }
        let view = try profileView()
        if edit != .bootstrap {
            guard view.visible?.status == .active, view.entitlement?.permitsEditing(at: now) == true else {
                throw Failure.unavailable
            }
        }
        let pending = try profileOperations()
        try requireQueueCapacity()
        do {
            let sequence = try nextNativeSequence()
            let id = UUID()
            let previous = pending.last
            let row = NativeLocalSchema.PendingOperation(
                id: id.uuidString.lowercased(), entityKey: "profile",
                sequence: sequence, createdAtMs: Int64(milliseconds),
                intent: try JSONEncoder().encode(edit), predecessor: previous?.id,
                expectedRevision: previous == nil ? (view.confirmed?.revision ?? 0) : nil)
            modelContext.insert(row)
            try commitProfileChange()
            return id
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    /// A new account's first command. Bootstrap carries no user content and has no server
    /// profile to review against, so a refused one has nothing to resolve: a forced refresh
    /// replaces it with a fresh attempt instead of leaving the account without a profile.
    func stageBootstrap(replacingRefused: Bool, now: Date = Date()) throws {
        try requireOpen()
        guard try profileRow() == nil else { return }
        let pending = try profileOperations()
        if let head = pending.first {
            guard replacingRefused, ["rejected", "conflict"].contains(head.state),
                try pending.allSatisfy({
                    try JSONDecoder().decode(NativeProfileEdit.self, from: $0.intent) == .bootstrap
                })
            else { return }
            for row in pending { modelContext.delete(row) }
            try commit()  // A crash here leaves an empty queue, which stages bootstrap next time.
        }
        try stageProfileEdit(.bootstrap, now: now)
    }

    func nextProfileSubmission(now: Date = Date()) throws -> Submission? {
        try requireOpen()
        guard
            let row = try profileOperations().first(where: {
                $0.predecessor == nil && ($0.state == "queued" || $0.state == "sealed")
                    && $0.nextAttemptAt <= now
            })
        else { return nil }
        guard let id = UUID(uuidString: row.id), let expected = row.expectedRevision else {
            throw Failure.corrupt
        }
        if let bytes = row.sealedBytes { return Submission(id: id, bytes: bytes, attempts: row.attempts) }
        do {
            let edit = try JSONDecoder().decode(NativeProfileEdit.self, from: row.intent)
            let command = NativeProfileCommand(
                operationID: id, createdAtMs: row.createdAtMs,
                expectedRevision: expected, edit: edit)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let bytes = try encoder.encode(command)
            row.sealedBytes = bytes
            row.state = "sealed"
            try commit()  // Never send a wire command that has not been durably sealed.
            return Submission(id: id, bytes: bytes, attempts: row.attempts)
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    func profileRetryAt() throws -> Date? {
        try requireOpen()
        guard let row = try profileOperations().first,
            row.state == "sealed" || row.state == "queued"
        else { return nil }
        return row.nextAttemptAt
    }

    func profileOperations() throws -> [NativeLocalSchema.PendingOperation] {
        let query = #Predicate<NativeLocalSchema.PendingOperation> { $0.entityKey == "profile" }
        let request = FetchDescriptor(predicate: query, sortBy: [SortDescriptor(\.sequence)])
        let rows = try modelContext.fetch(request)
        let byID = Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        guard byID.count == rows.count else { throw Failure.corrupt }
        for (index, row) in rows.enumerated() {
            guard UUID(uuidString: row.id) != nil, row.sequence > 0, row.attempts >= 0,
                row.predecessor == (index == 0 ? nil : rows[index - 1].id),
                (0...9_007_199_254_740_991).contains(row.createdAtMs),
                ["queued", "sealed", "conflict", "rejected"].contains(row.state),
                (row.state == "queued") == (row.sealedBytes == nil),
                row.expectedRevision.map({ (0...9_007_199_254_740_991).contains($0) }) ?? true
            else {
                throw Failure.corrupt
            }
            if let predecessor = row.predecessor {
                guard let previous = byID[predecessor], previous.sequence < row.sequence,
                    row.state == "queued", row.expectedRevision == nil
                else { throw Failure.corrupt }
            } else if row.expectedRevision == nil {
                throw Failure.corrupt
            }
        }
        return rows
    }

}
