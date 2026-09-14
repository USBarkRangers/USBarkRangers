import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    struct VisitQueueEntry: Equatable, Sendable {
        let id: UUID
        let sequence: Int64
        let keys: NativeVisitOperation.Keys
        let state: String
        let attempts: Int
        let retryAt: Date
        var needsDecision: Bool { state == "conflict" || state == "rejected" }
    }
    func visitQueue() throws -> [VisitQueueEntry] {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.PendingOperation>(
            predicate: #Predicate { $0.entityKey == "visits" },
            sortBy: [SortDescriptor(\.sequence)])
        query.propertiesToFetch = [\.id, \.sequence, \.listSummary, \.state, \.attempts, \.nextAttemptAt]
        let rows = try modelContext.fetch(query)
        return try rows.map { row in
            guard let id = UUID(uuidString: row.id), let bytes = row.listSummary, row.sequence > 0,
                row.attempts >= 0,
                ["queued", "sealed", "conflict", "rejected"].contains(row.state)
            else { throw Failure.corrupt }
            let keys = try JSONDecoder().decode(NativeVisitOperation.Keys.self, from: bytes)
            try keys.validate()
            return VisitQueueEntry(
                id: id, sequence: row.sequence, keys: keys, state: row.state,
                attempts: row.attempts, retryAt: row.nextAttemptAt)
        }
    }
    func visitOperation(_ id: UUID) throws -> NativeVisitOperation {
        guard let row = try operation(id), row.entityKey == "visits", let summary = row.listSummary,
            row.predecessor == nil, row.expectedRevision == nil, row.intent.count <= 1_000_000,
            (row.state == "queued") == (row.sealedBytes == nil)
        else { throw Failure.corrupt }
        let value = try JSONDecoder().decode(NativeVisitOperation.self, from: row.intent)
        try value.validate()
        guard try JSONDecoder().decode(NativeVisitOperation.Keys.self, from: summary) == value.keys else {
            throw Failure.corrupt
        }
        return value
    }
    func nextVisitSubmission(now: Date = Date()) throws -> (
        submission: Submission, operation: NativeVisitOperation
    )? {
        try requireOpen()
        guard !isGuest else { return nil }
        var earlierSites = Set<String>()
        for entry in try visitQueue() {
            let sites = Set(entry.keys.siteIDs)
            let eligible = earlierSites.isDisjoint(with: sites)
            earlierSites.formUnion(sites)
            guard eligible, !entry.needsDecision, entry.retryAt <= now else { continue }
            let value = try visitOperation(entry.id)
            guard let row = try operation(entry.id) else { throw Failure.corrupt }
            if let bytes = row.sealedBytes {
                return (Submission(id: entry.id, bytes: bytes, attempts: row.attempts), value)
            }
            do {
                let bytes = try value.commandBytes(id: entry.id, createdAtMs: row.createdAtMs)
                guard bytes.count <= 400_000 else { throw Failure.queueFull }
                row.sealedBytes = bytes
                row.state = "sealed"
                try commit()
                return (Submission(id: entry.id, bytes: bytes, attempts: row.attempts), value)
            } catch {
                modelContext.rollback()
                throw error
            }
        }
        return nil
    }
    func deferVisitSubmission(_ id: UUID, until date: Date) throws {
        try deferSubmission(id, until: date)
    }
    func rejectVisitOperation(_ id: UUID, code: String) throws {
        try requireOpen()
        guard
            [
                "invalid", "operation-reused", "unsupported-contract", "premium-required", "account-deleting",
                "intent-expired", "forbidden",
            ].contains(code), let row = try operation(id), row.entityKey == "visits", row.state == "sealed"
        else { throw Failure.corrupt }
        do {
            row.state = "rejected"
            row.failureCode = code
            try commit()
            publish([.pending, .markers, .visitHistory])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
