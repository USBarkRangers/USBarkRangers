import BarkDomain
import Foundation
import Synchronization

/// Transport callback order survives asynchronous decoding and point-read completion order.
nonisolated struct CloudUserEvent: Sendable {
    let change: CloudUserChange
    let revision: UInt64
}

/// A page advances its remote cursor only after LocalStore accepts the event.
nonisolated struct CloudTripPage: Sendable {
    let id: UUID
    let records: [SavedRecord]
    let recentIDs: [String]?
    let hasMore: Bool?
}

/// Owned by one CloudUserClient, never shared globally. Stamp at the SDK callback, before any actor hop.
nonisolated final class CloudUserEventClock: Sendable {
    private let revision = Mutex<UInt64>(0)
    func next() -> UInt64 {
        revision.withLock {
            $0 += 1
            return $0
        }
    }
}

/// Server-confirmed changes only. A collection delta never replaces unrelated account data.
nonisolated enum CloudUserChange: Sendable {
    case initial(PersonalSnapshot)
    case bootstrap(PersonalSnapshot, TripLibraryState)
    case tripPage(CloudTripPage)
    case profile(UserProfile, confirmedAt: Date)
    case trips(upserts: [SavedRecord], removed: Set<String>)
    case achievements(upserts: [SavedRecord], removed: Set<String>)

    var keys: Set<String> {
        switch self {
        case .initial, .bootstrap: return ["all"]
        case .tripPage(let page):
            var keys = Set(page.records.map { "trip:" + $0.id })
            if page.recentIDs != nil { keys.insert("library:recent") }
            if page.hasMore != nil { keys.insert("library:pages") }
            return keys
        case .profile: return ["profile"]
        case .trips(let values, let removed):
            return Set(Set(values.map(\.id)).union(removed).map { "trip:" + $0 })
        case .achievements(let values, let removed):
            return Set(Set(values.map(\.id)).union(removed).map { "award:" + $0 })
        }
    }
    /// Late decoding of an earlier SDK callback cannot roll a newer accepted document back.
    func excluding(_ newer: Set<String>) -> Self? {
        if newer.contains("all") { return nil }
        switch self {
        case .initial, .bootstrap: return self
        case .tripPage(let page):
            return .tripPage(CloudTripPage(
                id: page.id, records: page.records.filter { !newer.contains("trip:" + $0.id) },
                recentIDs: newer.contains("library:recent") ? nil : page.recentIDs,
                hasMore: newer.contains("library:pages") ? nil : page.hasMore))
        case .profile: return newer.contains("profile") ? nil : self
        case .trips(let values, let removed):
            let kept = values.filter { !newer.contains("trip:" + $0.id) }
            let deleted = removed.filter { !newer.contains("trip:" + $0) }
            return kept.isEmpty && deleted.isEmpty ? nil : .trips(upserts: kept, removed: deleted)
        case .achievements(let values, let removed):
            let kept = values.filter { !newer.contains("award:" + $0.id) }
            let deleted = removed.filter { !newer.contains("award:" + $0) }
            return kept.isEmpty && deleted.isEmpty ? nil : .achievements(upserts: kept, removed: deleted)
        }
    }

    func applying(to previous: PersonalSnapshot) throws -> PersonalSnapshot {
        var next = previous
        switch self {
        case .initial(let snapshot):
            guard snapshot.uid == previous.uid else { throw LocalStore.Failure.wrongAccount }
            return snapshot
        case .bootstrap(let snapshot, _):
            guard snapshot.uid == previous.uid else { throw LocalStore.Failure.wrongAccount }
            next = snapshot
            next.trips = Self.merge(previous.trips, upserts: snapshot.trips, removed: [])
        case .tripPage(let page):
            next.trips = Self.merge(previous.trips, upserts: page.records, removed: [])
        case .profile(let profile, let confirmedAt):
            next.profile = profile
            next.confirmedAt = confirmedAt
        case .trips(let upserts, let removed):
            next.trips = Self.merge(previous.trips, upserts: upserts, removed: removed)
        case .achievements(let upserts, let removed):
            next.achievements = Self.merge(previous.achievements, upserts: upserts, removed: removed)
        }
        return try CloudUserDecoder.snapshot(
            uid: next.uid, fields: next.profile.fields, trips: next.trips,
            achievements: next.achievements, confirmedAt: next.confirmedAt)
    }

    var isInitial: Bool {
        switch self { case .initial, .bootstrap: true; default: false }
    }

    func libraryState(after previous: TripLibraryState?) -> TripLibraryState? {
        switch self {
        case .initial: return nil
        case .bootstrap(_, let state): return state
        case .tripPage(let page):
            var state = previous ?? TripLibraryState()
            if let ids = page.recentIDs { state.recentIDs = ids }
            if let more = page.hasMore { state.hasMore = more }
            return state
        case .trips(_, let removed):
            guard var state = previous else { return nil }
            state.recentIDs.removeAll { removed.contains($0) }
            return state
        default: return previous
        }
    }

    private static func merge(
        _ records: [SavedRecord], upserts: [SavedRecord], removed: Set<String>
    ) -> [SavedRecord] {
        let replacing = removed.union(upserts.map(\.id))
        return (records.filter { !replacing.contains($0.id) } + upserts).sorted { $0.id < $1.id }
    }
}
