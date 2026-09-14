import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func requireQueueCapacity(parkCapture: Bool = false) throws {
        try requireOpen()
        if parkCapture { return }
        guard try modelContext.fetchCount(FetchDescriptor<NativeLocalSchema.PendingOperation>())
            < NativeSyncPolicy.queueLimit else { throw Failure.queueFull }
    }
    struct Submission: Equatable, Sendable {
        let id: UUID
        let bytes: Data
        let attempts: Int
    }
    func deferSubmission(_ id: UUID, until date: Date) throws {
        try requireOpen()
        guard let row = try operation(id), row.state == "sealed", row.sealedBytes != nil,
            row.attempts < Int.max else { throw Failure.corrupt }
        row.attempts += 1
        row.nextAttemptAt = date
        try commit()
    }
    func operation(_ id: UUID) throws -> NativeLocalSchema.PendingOperation? {
        let key = id.uuidString.lowercased()
        var request = FetchDescriptor<NativeLocalSchema.PendingOperation>(
            predicate: #Predicate { $0.id == key })
        request.fetchLimit = 2
        let rows = try modelContext.fetch(request)
        guard rows.count <= 1 else { throw Failure.corrupt }
        return rows.first
    }
    /// Shared durable ordering only. Each feature defines its own conflict/dependency rules.
    func nextNativeSequence() throws -> Int64 {
        var query = FetchDescriptor<NativeLocalSchema.Metadata>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count == 1, let row = rows.first, (0..<Int64.max).contains(row.sequence) else {
            throw Failure.corrupt
        }
        row.sequence += 1
        return row.sequence
    }
}
