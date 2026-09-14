import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    /// Remote refresh may replace reconstructible clean presentation, never dirty work or
    /// a draft whose queued save is still uncertain. The shared editor handles its live buffer.
    func stageCleanDraftRefresh(id: String) throws {
        let row = try draftRow(id)
        if row?.dirty == true { return }
        let key = "trip:\(id)"
        let pending = FetchDescriptor<NativeLocalSchema.PendingOperation>(
            predicate: #Predicate { $0.entityKey == key })
        guard try modelContext.fetchCount(pending) == 0 else { return }
        let canonical = try cachedTrip(id: id)
        if var canonical, let row {
            let previous = try JSONDecoder().decode(TripDraft.self, from: row.bytes)
            if canonical.trip.days.contains(where: { $0.id == previous.activeDayID }) {
                canonical.activeDayID = previous.activeDayID
            }
            if previous != canonical {
                row.bytes = try JSONEncoder().encode(canonical)
                row.title = canonical.trip.name
                row.dayCount = canonical.trip.days.count
                row.stopCount = canonical.trip.totalStops
                if try selectionRow()?.tripID == id {
                    try stageNativeSelection(tripID: id, dayID: canonical.activeDayID)
                }
            }
        } else if canonical == nil {
            if let row { modelContext.delete(row) }
            if try selectionRow()?.tripID == id { try stageNativeSelection(tripID: nil, dayID: nil) }
        }
    }

    func restoreCachedNativeSelection(expectedID: String) throws -> TripDraft? {
        try requireOpen()
        guard try selectionRow()?.tripID == expectedID else { throw TripDayEdit.Failure.changedDay }
        if let current = try restorableNativeDraft(id: expectedID) { return current }
        guard try cachedTrip(id: expectedID) != nil else { return nil }
        return try openNativeDraft(id: expectedID)
    }
}
