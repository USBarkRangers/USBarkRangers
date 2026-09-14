import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    struct ExpeditionConflictEntry: Equatable, Sendable, Identifiable {
        let id: UUID
        let state: String
        let failure: String?
        let operation: NativeExpeditionOperation
    }
    struct ExpeditionConflictReview: Equatable, Sendable {
        let entries: [ExpeditionConflictEntry]
        let remote: NativeExpeditionSnapshot
        let replacements: [NativeExpeditionOperation]?
    }

    /// Only the connected dependency suffix is reviewed. A settled historical
    /// conflict must not swallow an unrelated walk or an earlier uncertain command.
    func expeditionConflictEntries(_ id: UUID) throws -> [ExpeditionConflictEntry] {
        let queue = try expeditionQueue()
        guard let start = queue.firstIndex(where: { $0.id == id }), queue[start].needsDecision else {
            throw Failure.unavailable
        }
        var keys: [NativeExpeditionOperation.Keys] = []
        var result: [ExpeditionConflictEntry] = []
        for entry in queue[start...] {
            guard entry.id == id || keys.contains(where: { $0.conflicts(with: entry.keys) }) else { continue }
            guard entry.state != "sealed", let row = try operation(entry.id) else {
                throw Failure.unavailable
            }
            keys.append(entry.keys)
            result.append(
                .init(
                    id: entry.id, state: entry.state, failure: row.failureCode,
                    operation: try expeditionOperation(entry.id)))
        }
        return result
    }

    func resolveExpeditionConflict(_ review: ExpeditionConflictReview, keepLocal: Bool, now: Date = Date())
        throws
    {
        try requireOpen()
        guard let first = review.entries.first,
            try expeditionConflictEntries(first.id) == review.entries
        else { throw Failure.unavailable }
        let actions = review.replacements ?? review.entries.map(\.operation)
        if actions.contains(where: {
            $0.keys.writes.contains("selection") || $0.keys.reads.contains("selection")
        }) {
            let current = try nativeExpeditionState()
            guard current?.selectionRevision == review.remote.state?.selectionRevision,
                current?.activeRunID == review.remote.state?.activeRunID
            else { throw Failure.unavailable }
        }
        if let id = review.remote.activityID {
            guard try nativeActivity(id: id) == review.remote.activity else { throw Failure.unavailable }
        }
        let claimedRuns = Set(
            actions.compactMap { value -> String? in
                if case .claim(let id, _) = value.action { return id }
                return nil
            })
        for run in review.remote.runs where claimedRuns.contains(run.id) {
            guard try nativeVirtualRun(id: run.id) == run else { throw Failure.unavailable }
        }
        let replacements: [NativeExpeditionOperation]
        if keepLocal {
            guard let plan = review.replacements,
                try NativeExpeditionRecovery.rebase(
                    review.entries.map(\.operation), onto: review.remote,
                    failure: first.failure) == plan,
                try readEntitlement()?.permitsEditing(at: now) == true,
                try profileView().confirmed?.status == .active
            else { throw Failure.unavailable }
            let reviewedIDs = Set(review.entries.map(\.id))
            let outside = try expeditionQueue().filter { !reviewedIDs.contains($0.id) }
            // A rebase can discover a different previously active run. Do not
            // silently introduce dependencies on work outside the reviewed group.
            guard !outside.contains(where: { entry in plan.contains { $0.keys.conflicts(with: entry.keys) } })
            else {
                throw Failure.unavailable
            }
            replacements = plan
        } else {
            replacements = []
        }
        do {
            // Preserve ordering relative to unrelated queued work. No second writer
            // or intermediate commit may expose half a resolved dependency chain.
            let positions = try review.entries.map { entry -> Int64 in
                guard let row = try operation(entry.id) else { throw Failure.unavailable }
                let sequence = row.sequence
                modelContext.delete(row)
                return sequence
            }
            guard replacements.count <= positions.count else { throw Failure.invalidAcknowledgment }
            for (index, value) in replacements.enumerated() {
                try value.validate()
                let id = UUID()
                let ms = try NativeClientTime.milliseconds(now)
                let bytes = try JSONEncoder().encode(value)
                guard bytes.count <= 16_384, try value.commandBytes(id: id, createdAtMs: ms).count <= 8192
                else {
                    throw Failure.queueFull
                }
                let row = NativeLocalSchema.PendingOperation(
                    id: id.uuidString.lowercased(), entityKey: "expedition",
                    sequence: positions[index], createdAtMs: ms, intent: bytes, predecessor: nil,
                    expectedRevision: nil)
                row.listSummary = try JSONEncoder().encode(value.keys)
                modelContext.insert(row)
            }
            try commit()
            let ids = review.entries.compactMap { $0.operation.action.activityID }
            publish(Set(ids.map { .activity($0) }).union([.pending, .expedition, .activityHistory]))
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}

extension NativeExpeditionRepository {
    func reviewConflict(_ id: UUID) async throws -> NativeStore.ExpeditionConflictReview {
        guard let cloud else { throw NativeStore.Failure.unavailable }
        let entries = try await store.expeditionConflictEntries(id)
        guard let first = entries.first else { throw NativeStore.Failure.unavailable }
        let snapshot = try await cloud.current(
            activityID: first.operation.action.activityID,
            runID: first.operation.selectedRunID)
        try Task.checkCancellation()
        try await store.acceptNativeExpedition(snapshot)
        guard try await store.expeditionConflictEntries(id) == entries else {
            throw NativeStore.Failure.unavailable
        }
        return .init(
            entries: entries, remote: snapshot,
            replacements: try? NativeExpeditionRecovery.rebase(
                entries.map(\.operation), onto: snapshot,
                failure: first.failure))
    }
    func resolveConflict(_ review: NativeStore.ExpeditionConflictReview, keepLocal: Bool) async throws {
        try await store.resolveExpeditionConflict(review, keepLocal: keepLocal)
    }
}
