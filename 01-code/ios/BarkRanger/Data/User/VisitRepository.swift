import BarkDomain
import Foundation

/// Visit intent boundary, bound to one UID's store. Location is supplied as an observation, never requested here.
nonisolated struct VisitRepository: Sendable {
    let store: LocalStore
    @concurrent func markManual(park: Park, catalog: CatalogSnapshot) async throws {
        try await store.markVisit(park: park, catalog: catalog, fix: nil, now: Date())
    }
    @concurrent func recordProximity(park: Park, catalog: CatalogSnapshot, fix: LocationFix) async throws {
        try await store.markVisit(park: park, catalog: catalog, fix: fix, now: Date())
    }
    @concurrent func changeDate(id: String, date: Date) async throws {
        try Task.checkCancellation()
        try await store.changeVisitDate(id: id, date: date)
    }
    @concurrent func remove(_ ids: Set<String>) async throws {
        try Task.checkCancellation()
        try await store.removeVisits(ids)
    }
    @concurrent func resolve(_ id: String, keepLocal: Bool) async throws {
        try Task.checkCancellation()
        try await store.resolve(id: id, keepLocal: keepLocal)
    }
}
