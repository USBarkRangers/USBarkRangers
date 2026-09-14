import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct CorrectnessPolicyTests {
    @Test func genericMapAndPlannerAddsAgreeAndDoNotSilentlySplitDaysAtTenStops() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let coordinate = try #require(Coordinate(latitude: 44, longitude: -68))
        func park(_ id: String, aliases: [ParkID] = []) -> Park {
            Park(
                id: .init(rawValue: id), siteID: .init(rawValue: id), name: id,
                coordinate: coordinate, aliases: aliases)
        }
        let old = park("old")
        let renamed = park("new", aliases: [old.id])
        var draft = fixture.a
        draft.trip.days[0].stops = [.init(park: old)]
        try await fixture.repository.saveDraft(draft)
        await #expect(throws: TripDayEdit.Failure.self) {
            try await fixture.repository.addStop(
                .init(park: renamed), aliases: Set(renamed.aliases), tripID: fixture.a.id)
        }
        await #expect(throws: TripDayEdit.Failure.self) {
            try await fixture.repository.editDay(
                .init(tripID: draft.id, dayID: draft.trip.days[0].id),
                edit: .add(.init(park: renamed), aliases: Set(renamed.aliases)))
        }
        try await eventually { (try? await fixture.repository.currentDraft(id: draft.id)) == draft }
        let model = fixture.model()
        model.open(draft)
        model.addStop(.init(park: renamed), aliases: Set(renamed.aliases))
        #expect(model.draft == draft && !model.checkpointPending)
        for number in 0..<11 {
            #expect(
                try await fixture.repository.addStop(
                    .init(park: park("same-coordinate-\(number)")), tripID: fixture.a.id
                ).trip.days.count == 1)
        }
        let current = try #require(
            try await fixture.repository.currentDraft(id: draft.id))
        #expect(current.trip.days.count == 1 && current.trip.totalStops == 12)
        #expect(current.trip.days[0].stops.first?.id == draft.trip.days[0].stops.first?.id)
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test func nativeAccountActionsQueueOnlyTheTypedProfileEdit() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let before = try await fixture.repository.store.pendingTripIDs()
        let model = AccountModel(session: fixture.session)
        // Profile saves cannot queue unrelated trip work.
        model.saveName("No legacy fallback")
        await model.action?.value
        #expect(model.notice?.contains("Saved on this iPhone") == true)
        #expect(try await fixture.repository.store.pendingTripIDs() == before)
        #expect(try await fixture.repository.store.profileView().visible?.displayName == "No legacy fallback")
        await fixture.session.stopAndWait()
    }
}
