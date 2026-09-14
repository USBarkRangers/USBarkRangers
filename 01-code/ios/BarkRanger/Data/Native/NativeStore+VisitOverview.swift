import BarkDomain
import Foundation

extension NativeStore {
    struct VisitMarker: Equatable, Sendable {
        let officialPlaceID: String
        let visited: Bool
        let verified: Bool
        let pending: Bool
    }
    struct VisitOverview: Equatable, Sendable {
        let progress: NativeProgress?
        let markers: [String: VisitMarker]
        let pendingIDs: [UUID]
        let conflicts: [UUID]
    }
    /// Official-site slots, not visit history. Pending marker colour is independent
    /// of server-confirmed aggregate totals, so a lost reply cannot double-count credit.
    func nativeVisitOverview() throws -> VisitOverview {
        try requireOpen()
        var markers: [String: VisitMarker] = [:]
        var after = ""
        while true {
            let page = try nativeMarkers(after: after)
            for item in page {
                markers[item.id] = .init(
                    officialPlaceID: item.officialPlaceID,
                    visited: item.visited, verified: item.verified, pending: false)
            }
            guard page.count == 100, let last = page.last else { break }
            after = last.id
        }
        let queue = try visitQueue()
        for entry in queue {
            let operation = try visitOperation(entry.id)
            for change in operation.changes {
                markers[change.intent.target.siteID] = .init(
                    officialPlaceID: change.intent.target.officialPlaceID,
                    visited: change.after != nil, verified: change.after?.verified == true, pending: true)
            }
        }
        return .init(
            progress: try nativeProgress(), markers: markers,
            pendingIDs: queue.map(\.id), conflicts: queue.filter(\.needsDecision).map(\.id))
    }
}
