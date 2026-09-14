import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    struct TripLists: Equatable, Sendable {
        let drafts: [NativeTripListItem]
        let pending: [NativeTripListItem]
        let conflicts: [String]
    }
    func tripLocalLists() throws -> TripLists {
        try requireOpen()
        var drafts = FetchDescriptor<NativeLocalSchema.Draft>(
            predicate: #Predicate { $0.transferOwner == nil },
            sortBy: [
                SortDescriptor(\.updatedAt), SortDescriptor(\.id),
            ])
        drafts.propertiesToFetch = [\.id, \.title, \.dayCount, \.stopCount, \.updatedAt]
        let rows = try modelContext.fetch(drafts)
        var operations = FetchDescriptor<NativeLocalSchema.PendingOperation>(sortBy: [
            SortDescriptor(\.sequence)
        ])
        operations.propertiesToFetch = [\.entityKey, \.sequence, \.state, \.listSummary]
        let queued = try modelContext.fetch(operations)
        var summaries: [String: NativeTripListItem] = [:]
        var conflicts = Set<String>()
        var order: [String] = []
        for row in queued where row.entityKey.hasPrefix("trip:") {
            guard let bytes = row.listSummary, bytes.count <= 2048 else { throw Failure.corrupt }
            let value = try JSONDecoder().decode(NativeTripListItem.self, from: bytes)
            try value.validate()
            guard row.entityKey == "trip:\(value.id)" else { throw Failure.corrupt }
            if summaries[value.id] == nil { order.append(value.id) }
            summaries[value.id] = value
            if ["conflict", "rejected"].contains(row.state) { conflicts.insert(value.id) }
        }
        let items = try rows.map { row in
            let item = NativeTripListItem(
                id: row.id, title: row.title, dayCount: row.dayCount, stopCount: row.stopCount)
            try item.validate()
            return item
        }
        return TripLists(
            drafts: items,
            pending: order.compactMap { summaries[$0] }, conflicts: conflicts.sorted())
    }
}
