import BarkDomain
import Foundation

#if DEBUG
    /// Historical backend regression harness. Excluded from the shipping native app;
    /// Map/Planner always use NativeTripRepository, including guest planning.
    nonisolated struct TripRepository: Sendable {
        let store: LocalStore
        @concurrent func restoreActiveDraft() async throws -> LegacyTripDraft? {
            try Task.checkCancellation()
            return try await store.restoreActiveDraft()
        }
        @concurrent func clearActiveTrip(expectedID: String?) async throws {
            try Task.checkCancellation()
            try await store.clearActiveTrip(expectedID: expectedID)
        }
        @concurrent func currentDraft(id: String) async throws -> LegacyTripDraft? {
            try Task.checkCancellation()
            return try await store.readSnapshot().drafts?.first { $0.id == id }
        }
        @concurrent func openDraft(id: String?) async throws -> LegacyTripDraft {
            try Task.checkCancellation()
            return try await store.openTripDraft(id: id)
        }
        @concurrent func editDay(_ target: TripDayID, edit: TripDayEdit) async throws {
            try Task.checkCancellation()
            try await store.editDay(target, edit: edit)
        }
        @concurrent func checkpoint(_ draft: LegacyTripDraft, replacing expected: LegacyTripDraft?)
            async throws -> LegacyTripDraft
        {
            try Task.checkCancellation()
            return try await store.checkpoint(draft, replacing: expected)
        }
        @concurrent func addStop(
            _ stop: Trip.Stop, aliases: Set<ParkID> = [], tripID: String?,
            destination: TripStopPolicy.Destination? = nil, after: String? = nil
        ) async throws -> LegacyTripDraft {
            try Task.checkCancellation()
            return try await store.addStop(
                stop, aliases: aliases, tripID: tripID,
                destination: destination, after: after)
        }
        @concurrent func saveDraft(_ draft: LegacyTripDraft) async throws {
            try Task.checkCancellation()
            try await store.saveDraft(draft)
        }
        @concurrent func discardDraft(id: String) async throws {
            try Task.checkCancellation()
            try await store.discardDraft(id: id)
        }
        @discardableResult @concurrent func save(id: String, matching: LegacyTripDraft? = nil) async throws
            -> LegacyTripDraft
        {
            try Task.checkCancellation()
            return try await store.saveTrip(id: id, matching: matching)
        }
        @concurrent func delete(id: String) async throws {
            try Task.checkCancellation()
            try await store.deleteTrip(id: id)
        }
        @concurrent func delete(matching draft: LegacyTripDraft) async throws {
            try Task.checkCancellation()
            try await store.deleteTrip(matching: draft)
        }
        @concurrent func resolve(_ id: String, keepLocal: Bool) async throws {
            try Task.checkCancellation()
            try await store.resolve(id: id, keepLocal: keepLocal)
        }
    }
#endif
