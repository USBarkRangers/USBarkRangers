import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct AccessStabilizationTests {
    @Test func freeStopAndMapIntentsCannotChangeTheBufferOrQueue() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.open(fixture.a)
        let parks = try #require(await fixture.context.catalog.current().snapshot).parks
        let stop = Trip.Stop(park: parks[0])
        #expect(model.addStop(stop))
        #expect(model.addStop(.init(park: parks[1])))
        #expect(await model.awaitCheckpoint())
        let before = try #require(model.draft)
        let target = try #require(model.target)
        let store = fixture.repository.store
        try await store.acceptEntitlement(
            .init(revision: 2, premium: false, source: .production, validUntilMs: nil))
        try await eventually { !model.canEdit }
        let state = try await store.currentNativeDraft(id: before.id)
        #expect(!model.addStop(.init(park: parks[2])))
        let order = before.trip.days[0].stops.map(\.id)
        let changes: [TripDayEdit] = [
            .remove(stop.id), .order(order.reversed(), expected: order),
            .stopNotes(id: stop.id, expected: "", value: "Forbidden note"),
            .add(.init(park: parks[2]), after: nil, aliases: []), .appendDay(.init()),
        ]
        let mapEditor = RouteDayEditor(account: fixture.session, activeTrip: model.activeTrip)
        for change in changes {
            #expect(!model.editDay(change, target: target))
            mapEditor.apply(change, to: target)
            #expect(!mapEditor.isWorking)
            await #expect(throws: NativeStore.Failure.unavailable) {
                try await fixture.repository.editDay(target, edit: change)
            }
        }
        #expect(model.draft == before)
        #expect(try await store.currentNativeDraft(id: before.id) == state)
        #expect(try await store.pendingTripIDs().isEmpty)
        mapEditor.cancel()
        model.resetScope()
        await fixture.session.stopAndWait()
    }
    @Test func downgradeIsReadOnlyAndRestoringPremiumResumesTheSameDraft() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.selectDraft(fixture.a)
        #expect(await model.awaitCheckpoint())
        model.rename("Premium saved itinerary")
        model.editDay(.notes(expected: "", value: "Keep these notes"), target: try #require(model.target))
        #expect(await model.awaitCheckpoint())
        model.save()
        try await eventually { !model.saving }
        let saved = try #require(model.draft)
        let store = fixture.repository.store
        try await store.acceptEntitlement(
            .init(revision: 2, premium: false, source: .production, validUntilMs: nil))
        try await eventually { !model.canEdit }
        let before = try await store.currentNativeDraft(id: saved.id)
        model.rename("Blocked")
        #expect(!model.newTrip())
        model.duplicateTrip()
        if let selection = await model.reviewDeletion(saved.id) { model.discardTrip(selection) }
        model.addDay()
        model.setColor("#FF0000")
        model.editDay(
            .notes(expected: "Keep these notes", value: "Blocked"), target: try #require(model.target))
        #expect(model.draft == saved)
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await fixture.repository.delete(matching: saved)
        }
        var changed = saved
        changed.trip.name = "Direct repository bypass"
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await fixture.repository.saveDraft(changed)
        }
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await fixture.repository.save(id: saved.id)
        }
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await store.saveProfileEdit(.displayName("Blocked name"))
        }
        #expect(try await store.currentNativeDraft(id: saved.id) == before)
        model.resetScope()
        await model.resumeActive()
        #expect(model.draft?.trip == saved.trip)
        #expect(try await store.tripQueueState(saved.id).count == 1)
        // Navigation and opening saved content do not require editing privileges.
        model.selectDay(saved.trip.days[0].id)
        #expect(model.draft?.trip.days[0].notes == "Keep these notes")
        try await store.acceptEntitlement(
            .init(
                revision: 3, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        try await eventually { model.canEdit }
        model.rename("Editing restored")
        #expect(await model.awaitCheckpoint())
        #expect(model.draft?.trip.name == "Editing restored")
        #expect(model.draft?.trip.days == saved.trip.days)
        model.resetScope()
        await fixture.session.stopAndWait()
    }

    @Test func guestSignInAdoptsDraftsWithoutCloudPrivilegesOrAccountLeakage() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let auth = SyntheticAuth()
        let (app, _, _) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let configuration = NativeProfileConfiguration(
            project: "demo-bark-native",
            connect: {
                try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: $0)
            })
        let session = AccountSession(
            auth: auth, directory: directory, capabilities: .editableTest,
            nativeProfileConfiguration: configuration)
        session.start()
        try await eventually { session.nativeTrips != nil && session.identity == nil }
        let guest = TripDraft(trip: Trip(name: "Guest itinerary"))
        try await session.nativeTrips?.repository.saveDraft(guest)
        try await eventually { session.nativeTrips?.library.drafts.count == 1 }
        auth.select("free-a")
        try await eventually {
            session.nativeTrips?.scope.hasSuffix(":free-a") == true
                && session.nativeTrips?.library.drafts.count == 1
        }
        #expect(try await session.nativeTrips?.repository.currentDraft(id: guest.id)?.trip == guest.trip)
        #expect(
            !session.dataAccess.canEditAccount
                && !session.dataAccess.canEditDrafts)
        #expect(try await session.nativeTrips?.repository.store.pendingTripIDs().isEmpty == true)
        await #expect(throws: NativeStore.Failure.unavailable) {
            try await session.nativeTrips?.repository.save(id: guest.id)
        }
        auth.select("free-b")
        try await eventually { session.nativeTrips?.scope.hasSuffix(":free-b") == true }
        #expect(session.nativeTrips?.library.drafts.isEmpty == true)
        auth.select(nil)
        try await eventually { session.nativeTrips != nil && session.identity == nil }
        #expect(session.nativeTrips?.library.drafts.isEmpty == true)
        auth.select("free-a")
        try await eventually { session.nativeTrips?.scope.hasSuffix(":free-a") == true }
        #expect(session.nativeTrips?.library.drafts.map(\.id) == [guest.id])
        await session.stopAndWait()
        try FileManager.default.removeItem(at: directory)
    }

}
