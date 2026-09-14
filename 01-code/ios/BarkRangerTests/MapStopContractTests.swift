import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor struct MapStopContractTests {
    @Test func failedMoveAndFailedFirstAddLeaveNoPartialDraftOrExtraDay() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fail = Mutex(false)
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "stop-edit",
            beforeSave: {
                if fail.withLock({ $0 }) { throw CocoaError(.fileWriteOutOfSpace) }
            })
        try await store.seedPremium()
        let repository = NativeTripRepository(store: store, cloud: nil)
        let stop = Trip.Stop(name: "Home", coordinate: try #require(Coordinate(latitude: 41, longitude: -81)))
        let draft = TripDraft(trip: Trip(days: [.init(id: "day", stops: [stop])]))
        try await repository.saveDraft(draft)
        let before = try await store.tripLocalLists()
        fail.withLock { $0 = true }
        await #expect(throws: (any Error).self) {
            try await repository.editDay(
                .init(tripID: draft.id, dayID: "day"),
                edit: .moveToNewDay(stop: stop.id, day: .init(id: "new-day"), expectedOrder: [stop.id]))
        }
        await #expect(throws: (any Error).self) { try await repository.addStop(stop, tripID: nil) }
        #expect(try await store.tripLocalLists() == before)
        await store.close()
        try FileManager.default.removeItem(at: directory)
    }
    @Test func explicitBookendSearchPreservesRoundTripStartAndFinish() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let day = RouteDaySheetViewModel.testModel(account: fixture.session, routes: fixture.model().routes)
        day.start()
        day.open(tripID: fixture.a.id)
        try await eventually { !day.isOpening }
        let park = try #require(fixture.context.model.parks.first)
        day.editor.prepareInsertion(
            .init(scope: try #require(fixture.session.tripScope), tripID: fixture.a.id, destination: .start))
        day.add(park) {}
        try await eventually { day.draft?.trip.start != nil && !day.isWorking }
        day.editor.prepareInsertion(
            .init(scope: try #require(fixture.session.tripScope), tripID: fixture.a.id, destination: .end))
        guard
            case .add(let title, _, let add) = MapStopActions.action(
                for: .park(park), model: day, openDay: {})
        else {
            Issue.record("Explicit finish intent must take precedence over existing start membership")
            return
        }
        #expect(title == "Set Trip Finish")
        add()
        try await eventually { day.draft?.trip.end?.parkID == park.id && !day.isWorking }
        #expect(day.draft?.trip.totalStops == 0 && day.editor.insertion == nil)
        #expect(day.draft?.trip.start?.id != day.draft?.trip.end?.id)
        day.stop()
        await fixture.session.stopAndWait()
    }
}
