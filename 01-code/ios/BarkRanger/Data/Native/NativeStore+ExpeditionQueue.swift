import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    struct ExpeditionQueueEntry: Equatable, Sendable {
        let id: UUID
        let sequence: Int64
        let keys: NativeExpeditionOperation.Keys
        let state: String
        let attempts: Int
        let retryAt: Date
        var needsDecision: Bool { state == "conflict" || state == "rejected" }
    }
    func expeditionQueue() throws -> [ExpeditionQueueEntry] {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.PendingOperation>(
            predicate: #Predicate { $0.entityKey == "expedition" },
            sortBy: [SortDescriptor(\.sequence)])
        query.propertiesToFetch = [\.id, \.sequence, \.listSummary, \.state, \.attempts, \.nextAttemptAt]
        let rows = try modelContext.fetch(query)
        guard rows.filter({ $0.state == "sealed" }).count <= 1 else {
            throw Failure.corrupt
        }
        return try rows.map { row in
            guard let id = UUID(uuidString: row.id), let bytes = row.listSummary, row.sequence > 0,
                row.attempts >= 0, ["queued", "sealed", "conflict", "rejected"].contains(row.state)
            else { throw Failure.corrupt }
            let keys = try JSONDecoder().decode(NativeExpeditionOperation.Keys.self, from: bytes)
            try keys.validate()
            return .init(
                id: id, sequence: row.sequence, keys: keys, state: row.state,
                attempts: row.attempts, retryAt: row.nextAttemptAt)
        }
    }
    func expeditionOperation(_ id: UUID) throws -> NativeExpeditionOperation {
        try requireOpen()
        guard let row = try operation(id), row.entityKey == "expedition", let summary = row.listSummary,
            row.predecessor == nil, row.expectedRevision == nil, row.intent.count <= 16_384,
            (row.state == "queued") == (row.sealedBytes == nil)
        else { throw Failure.corrupt }
        let value = try JSONDecoder().decode(NativeExpeditionOperation.self, from: row.intent)
        try value.validate()
        guard try JSONDecoder().decode(NativeExpeditionOperation.Keys.self, from: summary) == value.keys
        else {
            throw Failure.corrupt
        }
        return value
    }
    func nextExpeditionSubmission(now: Date = Date()) throws -> (
        submission: Submission, operation: NativeExpeditionOperation
    )? {
        try requireOpen()
        guard !isGuest else { return nil }
        let queue = try expeditionQueue()
        // Resolve one uncertain network outcome before sending another. Settled
        // conflicts remain per-dependency; a failed historical edit is not a global lock.
        if let uncertain = queue.first(where: { $0.state == "sealed" }) {
            guard uncertain.retryAt <= now else { return nil }
            return try sealExpeditionSubmission(uncertain)
        }
        var earlier: [NativeExpeditionOperation.Keys] = []
        for entry in queue {
            let eligible = !earlier.contains { $0.conflicts(with: entry.keys) }
            earlier.append(entry.keys)
            guard eligible, !entry.needsDecision, entry.retryAt <= now else { continue }
            return try sealExpeditionSubmission(entry)
        }
        return nil
    }
    private func sealExpeditionSubmission(_ entry: ExpeditionQueueEntry) throws -> (
        submission: Submission, operation: NativeExpeditionOperation
    ) {
        let value = try expeditionOperation(entry.id)
        guard let row = try operation(entry.id) else { throw Failure.corrupt }
        if let bytes = row.sealedBytes {
            return (.init(id: entry.id, bytes: bytes, attempts: row.attempts), value)
        }
        do {
            let bytes = try value.commandBytes(id: entry.id, createdAtMs: row.createdAtMs)
            row.sealedBytes = bytes
            row.state = "sealed"
            try commit()
            return (.init(id: entry.id, bytes: bytes, attempts: row.attempts), value)
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    static let expeditionRejectionCodes: Set<String> = [
        "invalid", "operation-reused", "unsupported-contract", "premium-required", "account-deleting",
        "intent-expired", "forbidden", "activity-reused", "overlapping-activity", "incomplete-expedition",
    ]
    func rejectExpeditionOperation(_ id: UUID, code: String) throws {
        try requireOpen()
        guard Self.expeditionRejectionCodes.contains(code), let row = try operation(id),
            row.entityKey == "expedition", row.state == "sealed"
        else { throw Failure.corrupt }
        do {
            row.state = "rejected"
            row.failureCode = code
            try commit()
            publish([.pending, .expedition, .activityHistory])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
