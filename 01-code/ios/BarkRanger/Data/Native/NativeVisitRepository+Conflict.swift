import BarkDomain
import Foundation

extension NativeVisitRepository {
    @concurrent func reviewConflict(_ id: UUID) async throws -> NativeStore.VisitConflictReview {
        try Task.checkCancellation()
        guard let cloud else { throw NativeStore.Failure.unavailable }
        let group = try await store.visitConflictGroup(id)
        var selection = try await cloud.selection(group.references)
        // A remote delete/re-add may have a different current event ID. Fetch that
        // bounded selected set once; a second replacement requires a new review.
        let active = Dictionary(uniqueKeysWithValues: selection.places.map { ($0.id, $0) })
        let current = group.references.map { reference in
            NativeVisitReference(
                visitID: active[reference.siteID]?.visitID ?? reference.visitID,
                officialPlaceID: reference.officialPlaceID, siteID: reference.siteID)
        }
        if current != group.references { selection = try await cloud.selection(current) }
        try Task.checkCancellation()
        return try await store.reviewVisitConflict(group: group, selection: selection)
    }
    @concurrent func resolveConflict(
        _ review: NativeStore.VisitConflictReview, choice: NativeStore.VisitChoice
    ) async throws -> NativeStore.VisitResolution {
        try Task.checkCancellation()
        return try await store.resolveVisitConflict(review, choice: choice)
    }
}
