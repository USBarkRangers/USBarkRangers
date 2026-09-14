import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func nativeDraftIsDirty(_ draft: TripDraft) throws -> Bool {
        let fingerprint = try NativeTripBase.fingerprint(draft.trip)
        if fingerprint != draft.nativeBase?.contentFingerprint { return true }
        let key = "trip:\(draft.id)"
        var query = FetchDescriptor<NativeLocalSchema.PendingOperation>(
            predicate: #Predicate { $0.entityKey == key },
            sortBy: [SortDescriptor(\.sequence, order: .reverse)])
        query.fetchLimit = 1
        query.propertiesToFetch = [\.draftFingerprint, \.sequence]
        // Undoing a submitted change is still new, unsaved work even if it equals an
        // older confirmed trip. Compare the last queued save without decoding its body.
        if let latest = try modelContext.fetch(query).first?.draftFingerprint { return fingerprint != latest }
        return false
    }
}
