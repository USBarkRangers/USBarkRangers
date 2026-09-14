import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func tripPendingOperationIDs() throws -> [String] {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.PendingOperation>(sortBy: [SortDescriptor(\.sequence)])
        query.propertiesToFetch = [\.id, \.entityKey, \.sequence]
        let rows = try modelContext.fetch(query)
        return rows.filter { $0.entityKey.hasPrefix("trip:") }.map(\.id)
    }
    struct TripQueueState: Equatable, Sendable {
        let count: Int
        let needsDecision: Bool
        let retryAt: Date?
    }

    func tripQueueState(_ id: String) throws -> TripQueueState {
        try requireOpen()
        let rows = try tripOperations(id)
        let blocked = rows.first.map { ["conflict", "rejected"].contains($0.state) } ?? false
        return TripQueueState(
            count: rows.count, needsDecision: blocked, retryAt: blocked ? nil : rows.first?.nextAttemptAt)
    }

    func pendingTripIDs() throws -> [String] {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.PendingOperation>(sortBy: [SortDescriptor(\.sequence)])
        query.propertiesToFetch = [\.entityKey, \.sequence]
        let rows = try modelContext.fetch(query)
        var seen = Set<String>()
        return rows.compactMap { row in
            guard row.entityKey.hasPrefix("trip:") else { return nil }
            let id = String(row.entityKey.dropFirst(5))
            return seen.insert(id).inserted ? id : nil
        }
    }

    func deferTripSubmission(_ id: UUID, until date: Date) throws {
        try deferSubmission(id, until: date)
    }
}
