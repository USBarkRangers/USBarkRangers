import BarkDomain
import Foundation

/// Current trip workflows over the native store. Only a selected uncached trip requires
/// a remote detail read, as does known-stale or uncertified detail. Lists and ordinary
/// edits never decode the account's itinerary archive.
nonisolated struct NativeTripRepository: Sendable {
    enum DeletionSelection: Sendable, Identifiable {
        case draft(TripDraft)
        case saved(id: String, contentRevision: Int64)
        var id: String {
            switch self {
            case .draft(let draft): draft.id
            case .saved(let id, _): id
            }
        }
    }
    struct ConflictReview: Sendable, Identifiable {
        let id: String
        let draft: TripDraft?
        let operationIDs: [UUID]
        let snapshot: NativeTripSnapshot
        let recovery: NativeTripRecovery?
    }
    let store: NativeStore
    let cloud: NativeTripCloud?

    @concurrent func restoreActiveDraft() async throws -> TripDraft? {
        try Task.checkCancellation()
        guard let id = try await store.nativeSelection().tripID else { return nil }
        if let local = try await store.restoreCachedNativeSelection(expectedID: id) { return local }
        guard let cloud else { throw NativeStore.Failure.unavailable }
        let snapshot = try await cloud.trip(id)
        try Task.checkCancellation()
        try await store.acceptTripSnapshot(snapshot)
        let selection = try await store.nativeSelection().tripID
        if selection == nil, snapshot.metadata?.deleted != false { return nil }
        guard selection == id else { throw TripDayEdit.Failure.changedDay }
        guard let restored = try await store.restoreCachedNativeSelection(expectedID: id) else {
            // The point reply was overtaken by newer metadata. This is not an empty
            // selection and must not tell the shared editor to clear its retained buffer.
            throw NativeStore.Failure.staleRead
        }
        return restored
    }
    @concurrent func openDraft(id: String?) async throws -> TripDraft {
        try Task.checkCancellation()
        do { return try await store.openNativeDraft(id: id) } catch NativeStore.Failure.unavailable {
            guard let id, let cloud else { throw NativeStore.Failure.unavailable }
            let snapshot = try await cloud.trip(id)
            try Task.checkCancellation()
            try await store.acceptTripSnapshot(snapshot)
            return try await store.openNativeDraft(id: id)
        }
    }
    @concurrent func currentDraft(id: String) async throws -> TripDraft? {
        try Task.checkCancellation()
        return try await store.currentNativeDraft(id: id)
    }
    @concurrent func clearActiveTrip(expectedID: String?) async throws {
        try Task.checkCancellation()
        try await store.clearNativeTrip(expectedID: expectedID)
    }
    @concurrent func checkpoint(_ draft: TripDraft, replacing expected: TripDraft?) async throws -> TripDraft
    {
        try Task.checkCancellation()
        return try await store.checkpointNativeDraft(draft, replacing: expected)
    }
    @concurrent func editDay(_ target: TripDayID, edit: TripDayEdit) async throws {
        try Task.checkCancellation()
        try await store.editNativeDay(target, edit: edit)
    }
    @concurrent func addStop(
        _ stop: Trip.Stop, aliases: Set<ParkID> = [], tripID: String?,
        destination: TripStopPolicy.Destination? = nil, after: String? = nil
    ) async throws -> TripDraft {
        try Task.checkCancellation()
        return try await store.addNativeStop(
            stop, aliases: aliases, tripID: tripID, destination: destination, after: after)
    }
    @concurrent func save(id: String, matching expected: TripDraft) async throws -> TripDraft {
        try Task.checkCancellation()
        return try await store.saveNativeTrip(id: id, matching: expected)
    }
    @concurrent func delete(matching draft: TripDraft) async throws {
        try Task.checkCancellation()
        try await store.deleteNativeTrip(matching: draft)
    }
    @concurrent func delete(id: String, contentRevision: Int64) async throws {
        try Task.checkCancellation()
        _ = try await store.stageTripDeletion(id: id, expectedRevision: contentRevision)
    }
    @concurrent func discardDraft(id: String, matching expected: TripDraft) async throws {
        try Task.checkCancellation()
        try await store.discardNativeDraft(id: id, matching: expected)
    }
    @concurrent func reviewConflict(_ id: String) async throws -> ConflictReview {
        guard let cloud else { throw NativeStore.Failure.unavailable }
        let snapshot = try await cloud.trip(id)
        try Task.checkCancellation()
        try await store.acceptTripSnapshot(snapshot)
        let draft = try await store.currentNativeDraft(id: id)
        let recovery: NativeTripRecovery?
        if let draft, snapshot.metadata?.deleted == false {
            recovery = try await cloud.recovery(for: draft.trip)
        } else {
            recovery = nil
        }
        try Task.checkCancellation()
        return try await store.reviewTripConflict(
            id: id, draft: draft, snapshot: snapshot, recovery: recovery)
    }
    @concurrent func resolve(_ review: ConflictReview, keepLocal: Bool) async throws
        -> NativeStore.TripResolution
    {
        try Task.checkCancellation()
        return try await store.resolveTripConflict(
            id: review.id, keepLocal: keepLocal, expectedDraft: review.draft,
            metadataRevision: review.snapshot.metadata?.revision ?? 0,
            snapshot: review.snapshot, recovery: review.recovery, expectedOperationIDs: review.operationIDs)
    }
}
