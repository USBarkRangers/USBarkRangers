import BarkDomain
import Foundation
@testable import BarkRanger

/// Isolated fixtures construct their owner explicitly. This helper is compiled only in the test target;
/// application constructors cannot silently create a second active-trip session.
extension RouteDaySheetViewModel {
    static func testModel(
        account: AccountSession, routes: DayRouteService, maps: MapsHandoff = MapsHandoff(),
        activeTrip: ActiveTripSession? = nil
    ) -> RouteDaySheetViewModel {
        let shared = activeTrip ?? ActiveTripSession(account: account, routes: routes)
        return RouteDaySheetViewModel(activeTrip: shared, maps: maps)
    }
}

/// Test setup convenience only; application mutations always supply the selected preimage.
extension NativeTripRepository {
    func saveDraft(_ draft: TripDraft) async throws {
        let previous = try await currentDraft(id: draft.id)
        _ = try await checkpoint(draft, replacing: previous)
    }
    @discardableResult func save(id: String) async throws -> TripDraft {
        guard let draft = try await currentDraft(id: id) else { throw NativeStore.Failure.unavailable }
        return try await save(id: id, matching: draft)
    }
    func discardDraft(id: String) async throws {
        guard let draft = try await currentDraft(id: id) else { return }
        try await discardDraft(id: id, matching: draft)
    }
}

func nativeTripSnapshot(_ trip: Trip, revision: Int64) throws -> NativeTripSnapshot {
    let input = try NativeTripSave(trip: trip, baseNotes: [:])
    let notes = trip.allStops.filter { !$0.notes.isEmpty }.map {
        NativePlanningNote(revision: revision, tripID: trip.id, stopID: $0.id,
            placeID: $0.placeIdentity.storageID, text: $0.notes)
    }
    let time = try NativeServerTime(seconds: 1_700_000_000 + revision, nanoseconds: 0)
    return NativeTripSnapshot(tripID: trip.id,
        metadata: .init(id: trip.id, revision: revision, contentRevision: revision, title: trip.name,
            dayCount: trip.days.count, stopCount: trip.allStops.count, contentBytes: 1000,
            createdAt: try NativeServerTime(seconds: 1_700_000_000, nanoseconds: 0), updatedAt: time),
        content: .init(revision: revision, tripID: trip.id, name: trip.name,
            days: input.days, start: input.start, end: input.end), notes: notes, readTime: time)
}
