import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func acceptNativeActivityChanges(_ page: NativeActivityChanges, requested: NativeChangeQuery) throws
        -> Bool
    {
        try requireOpen()
        try page.validate(for: requested)
        guard !page.needsBootstrap else { throw Failure.invalidAcknowledgment }
        guard try activityChangesQuery() == requested else { return false }
        do {
            guard let cursor = try activityCursorRow() else { throw Failure.corrupt }
            if let floor = try activityHistoryFloor(), page.upper < floor {
                // A newer point read protects evicted revisions from stale refill.
                // Do not skip this interval: restart from the SAME completed lower
                // bound with a fresh upper watermark. Unrelated B changes must still
                // arrive even when an individual A read overtakes this scan.
                cursor.request = try JSONEncoder().encode(NativeChangeQuery(since: requested.since))
                try commit()
                return false
            }
            for item in page.items { try stageActivity(item) }
            let next: NativeChangeQuery =
                page.next.map { .init(since: requested.since, upper: page.upper, after: $0) }
                ?? .init(since: page.upper)
            cursor.request = try JSONEncoder().encode(next)
            try advanceActivityHistoryFloor(page.upper)
            try stageActivityCacheRetention()
            try commit()
            publish(Set(page.items.map { .activity($0.id) }).union([.activityHistory]))
            return true
        } catch {
            modelContext.rollback()
            throw error
        }
    }
}
