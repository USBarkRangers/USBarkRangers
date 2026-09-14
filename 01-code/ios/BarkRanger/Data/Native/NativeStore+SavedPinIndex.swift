import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    /// Rebuildable spatial projection lives on this actor with its canonical rows.
    /// Only changed pin rows update the index; map gestures never request cloud data
    /// or repeatedly rebuild every saved place. Each projection page commits atomically.
    private func prepareSavedPinIndex() throws -> SavedPlaceIndex {
        try requireOpen()
        if savedPinIndex == nil {
            guard let folder = modelContainer.configurations.first?.url.deletingLastPathComponent() else {
                throw Failure.unavailable
            }
            savedPinIndex = try SavedPlaceIndex(url: folder.appendingPathComponent("saved-pins.sqlite"))
        }
        guard let index = savedPinIndex else { throw Failure.unavailable }
        if try index.needsRebuild {
            do {
                try index.beginRebuild()
                try index.setGeneration(0)
                try index.finish()
            } catch {
                index.rollback()
                throw error
            }
        }
        while true {
            try Task.checkCancellation()
            let after = try index.generation
            var query = FetchDescriptor<NativeLocalSchema.SavedPin>(
                predicate: #Predicate { $0.changeSequence > after },
                sortBy: [SortDescriptor(\.changeSequence)])
            query.fetchLimit = 200
            let rows = try modelContext.fetch(query)
            guard let last = rows.last else { return index }
            do {
                try index.begin()
                for row in rows {
                    let value = try savedPinValue(row.id)
                    if let place = value.place {
                        try index.put(.init(place, pending: value.pending))
                    } else {
                        try index.remove(row.id)
                    }
                }
                try index.setGeneration(last.changeSequence)
                try index.finish()
                #if DEBUG
                    savedPinIndexObserver?(rows.count)
                #endif
            } catch {
                index.rollback()
                throw error
            }
        }
    }
    func savedPins(in region: SavedPlaceIndex.Region, including stops: [Trip.Stop]) throws -> [String:
        SavedPlaceIndex.Pin]
    {
        let index = try prepareSavedPinIndex()
        var result = Dictionary(uniqueKeysWithValues: try index.pins(in: region).map { ($0.id, $0) })
        for stop in stops {
            for pin in try index.matching(identity: stop.placeIdentity.storageID) { result[pin.id] = pin }
        }
        return result
    }
}
