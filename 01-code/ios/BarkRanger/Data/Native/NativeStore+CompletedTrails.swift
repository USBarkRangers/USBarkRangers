import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func nativeCompletedTrails() throws -> [NativeCompletedTrails.Item] {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.CompletedTrail>()
        query.fetchLimit = 101
        let rows = try modelContext.fetch(query)
        guard rows.count <= 100 else { throw Failure.corrupt }
        return try rows.map(decodeCompletedTrail).sorted {
            $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt < $1.updatedAt
        }
    }
    func acceptNativeCompletedTrails(_ snapshot: NativeCompletedTrails) throws {
        try requireOpen()
        try snapshot.validate()
        do {
            var query = FetchDescriptor<NativeLocalSchema.CompletedTrail>()
            query.fetchLimit = 101
            let rows = try modelContext.fetch(query)
            guard rows.count <= 100 else { throw Failure.corrupt }
            let incoming = Dictionary(uniqueKeysWithValues: snapshot.items.map { ($0.id, $0) })
            let existing = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
            for row in rows where incoming[row.id] == nil {
                if try decodeCompletedTrail(row).updatedAt <= snapshot.readTime { modelContext.delete(row) }
            }
            for value in snapshot.items {
                if let row = existing[value.id] {
                    let previous = try decodeCompletedTrail(row)
                    if value.updatedAt < previous.updatedAt { continue }
                    if value.updatedAt == previous.updatedAt {
                        guard value == previous else { throw Failure.corrupt }
                    } else {
                        row.payload = try JSONEncoder().encode(value)
                    }
                } else {
                    modelContext.insert(
                        NativeLocalSchema.CompletedTrail(
                            id: value.id, payload: try JSONEncoder().encode(value)))
                }
            }
            try commit()
            publish([.completedTrails])
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    private func decodeCompletedTrail(_ row: NativeLocalSchema.CompletedTrail) throws
        -> NativeCompletedTrails.Item
    {
        let value = try JSONDecoder().decode(NativeCompletedTrails.Item.self, from: row.payload)
        try value.validate()
        guard row.id == value.id else { throw Failure.corrupt }
        return value
    }
}
