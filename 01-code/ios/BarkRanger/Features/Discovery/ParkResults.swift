import BarkDomain
import Foundation

/// Immutable projection, never an editable query owner. Settings remains the only query source.
nonisolated struct ParkResults: Sendable {
    struct Input: Equatable, Sendable {
        let revision: Int64
        let query: ParkFilter.Query
    }
    typealias Compute = @Sendable (CatalogSnapshot, ParkSearchIndex?, ParkFilter.Query) async throws -> Self
    let input: Input
    let result: ParkFilter.Result
    let parks: [Park]
    let matchingIDs: Set<ParkID>
    let catalogIDs: Set<ParkID>

    /// Explicitly leave the caller's actor, including with approachable concurrency enabled.
    @concurrent static func compute(
        snapshot: CatalogSnapshot, index: ParkSearchIndex?, query: ParkFilter.Query
    ) async throws -> Self {
        try Task.checkCancellation()
        let matches =
            query.search.isEmpty
            ? nil : (index ?? ParkSearchIndex(parks: snapshot.parks)).search(query.search)
        try Task.checkCancellation()
        let result = ParkFilter.apply(catalog: snapshot, query: query, searchIDs: matches)
        let byID = Dictionary(uniqueKeysWithValues: snapshot.parks.map { ($0.id, $0) })
        try Task.checkCancellation()
        return Self(
            input: Input(revision: snapshot.revision, query: query), result: result,
            parks: result.matchingIDs.compactMap { byID[$0] },
            matchingIDs: Set(result.matchingIDs), catalogIDs: Set(byID.keys))
    }
}
