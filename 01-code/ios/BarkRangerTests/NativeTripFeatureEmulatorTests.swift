import BarkDomain
import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
import Foundation
import MapKit
import Testing

@testable import BarkRanger

@MainActor struct NativeTripFeatureEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func connectedPlannerAndMapSaveNotesDuplicateClearDeleteAndReopen() async throws {
        try await withApp { fixture in
            let editor = fixture.editor
            let map = fixture.map
            #expect(editor.activeTrip === map.activeTrip)
            #expect(editor.newTrip())
            editor.rename("Connected native trip")
            let stop = Trip.Stop(
                id: "first", placeIdentity: .provider(name: "apple", id: "native-marker"),
                name: "Private place", coordinate: Coordinate(latitude: 41, longitude: -81),
                notes: "Bring water 🐕")
            #expect(editor.addStop(stop))
            #expect(
                editor.addStop(
                    .init(
                        id: "second", placeIdentity: .custom("second-place"),
                        name: "Next place", coordinate: Coordinate(latitude: 41.1, longitude: -81.1))))
            #expect(await editor.awaitCheckpoint())
            let id = try #require(editor.draft?.id)
            let target = try #require(editor.target)
            try await eventually { fixture.routeRequests.count == 1 }
            let routeCount = fixture.routeRequests.count
            map.edit(.stopNotes(id: stop.id, expected: stop.notes, value: "Map wrote this note"))
            try await eventually {
                !map.isWorking && editor.draft?.trip.days[0].stops[0].notes == "Map wrote this note"
            }
            editor.save()
            try await eventually(timeout: .seconds(15)) {
                (try? await fixture.repository.store.tripQueueState(id).count) == 0
                    && editor.draft?.nativeBase?.contentRevision == 1
            }
            let confirmed = try await fixture.cloud.trip(id)
            #expect(
                editor.notice?.contains("Saved on this iPhone") == true,
                "A server preimage refresh must not erase the save confirmation")
            #expect(confirmed.notes.first?.text == "Map wrote this note")
            #expect(fixture.routeRequests.count == routeCount)

            // One explicit Save sends an atomic batch, without itinerary references.
            fixture.session.connectivityChanged(false)
            try await Task.sleep(for: .milliseconds(100))
            #expect(
                editor.editDay(
                    .stopNotes(id: stop.id, expected: "Map wrote this note", value: "Planner note only"),
                    target: target))
            #expect(await editor.awaitCheckpoint())
            try await editor.activeTrip.saveDraftToAccount()
            let sealed = try #require(try await fixture.repository.store.nextTripSubmission(id: id))
            let body = try #require(JSONSerialization.jsonObject(with: sealed.bytes) as? [String: Any])
            let payload = try #require(body["payload"] as? [String: Any])
            #expect(body["kind"] as? String == "saveTripNotes")
            #expect(payload["days"] == nil)
            #expect((payload["notes"] as? [Any])?.count == 1)
            print(
                "NATIVE_TRIP_SAVE_BYTES=\(sealed.bytes.count); changed_note_bodies=1; directions_delta=\(fixture.routeRequests.count-routeCount)"
            )
            // Real server commit, deliberately lose the acknowledgment on this device.
            let outcome = try await fixture.cloud.submit(sealed)
            #expect(outcome.status == .accepted)
            #expect(try await fixture.repository.store.tripQueueState(id).count == 1)
            fixture.session.connectivityChanged(true)
            try await eventually(timeout: .seconds(15)) {
                (try? await fixture.repository.store.tripQueueState(id).count) == 0
                    && editor.draft?.nativeBase?.notes.values.first?.revision == 2
                    && editor.draft?.nativeBase?.contentRevision == 1
            }
            #expect(editor.draft?.trip.days[0].stops[0].notes == "Planner note only")
            #expect(fixture.routeRequests.count == routeCount)
            editor.duplicateTrip()
            #expect(await editor.awaitCheckpoint())
            let copyID = try #require(editor.draft?.id)
            #expect(copyID != id && editor.draft?.trip.days[0].stops[0].placeIdentity == stop.placeIdentity)
            editor.save()
            try await eventually(timeout: .seconds(15)) { editor.draft?.nativeBase?.contentRevision == 1 }
            let copy = try await fixture.cloud.trip(copyID)
            #expect(copy.notes.first?.id != confirmed.notes.first?.id)
            #expect(copy.notes.first?.text == "Planner note only")
            editor.clearTrip()
            try await eventually { !editor.saving && editor.draft == nil }
            try await editor.activeTrip.selectTrip(id: id, dayID: target.dayID)
            #expect(editor.draft?.id == id && map.draft == editor.draft)
            let deletion = try #require(await editor.reviewDeletion(copyID))
            editor.discardTrip(deletion)
            try await eventually(timeout: .seconds(15)) {
                let count = try? await fixture.repository.store.tripQueueState(copyID).count
                return !editor.saving && count == 0
            }
            #expect(try await fixture.cloud.trip(copyID).metadata?.deleted == true)
            #expect(editor.draft?.id == id)
            let expected = try #require(editor.draft)
            await fixture.session.stopAndWait()
            let reopened = try await NativeStore.open(
                directory: fixture.session.directory, project: "demo-bark-native", uid: fixture.uid)
            #expect(try await reopened.currentNativeDraft(id: id) == expected)
            #expect(try await reopened.nativeSelection().dayID == target.dayID)
            await reopened.close()
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func reviewedConflictRejectsNewerTypingAndRemoteDeletionRecoversAsNewTrip() async throws {
        try await withApp { fixture in
            let editor = fixture.editor
            #expect(editor.newTrip())
            editor.rename("Original")
            #expect(await editor.awaitCheckpoint())
            editor.save()
            try await eventually(timeout: .seconds(15)) { editor.draft?.nativeBase?.contentRevision == 1 }
            let original = try #require(editor.draft)
            fixture.session.connectivityChanged(false)
            editor.rename("My offline change")
            #expect(await editor.awaitCheckpoint())
            try await editor.activeTrip.saveDraftToAccount()
            let remoteDirectory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let remote = try await NativeStore.open(
                directory: remoteDirectory, project: "demo-bark-native", uid: fixture.uid)
            try await remote.acceptProfile(.init(revision: 1, displayName: "Ranger"))
            try await remote.acceptEntitlement(
                .init(
                    revision: 1, premium: true, source: .production,
                    validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
            try await remote.acceptTripSnapshot(fixture.cloud.trip(original.id))
            var remoteDraft = try #require(try await remote.cachedTrip(id: original.id))
            remoteDraft.trip.name = "Another device"
            _ = try await remote.checkpointNativeDraft(remoteDraft, replacing: nil)
            _ = try await remote.stageTripSave(remoteDraft)
            let command = try #require(try await remote.nextTripSubmission(id: original.id))
            let outcome = try await fixture.cloud.submit(command)
            try await remote.acceptTripOutcome(outcome, snapshot: fixture.cloud.trip(original.id))
            fixture.session.connectivityChanged(true)
            try await eventually(timeout: .seconds(15)) {
                fixture.session.nativeTrips?.conflicts == [original.id]
            }
            let review = try await fixture.repository.reviewConflict(original.id)
            editor.rename("Newer typing must survive")
            #expect(await editor.awaitCheckpoint())
            await #expect(throws: (any Error).self) {
                try await editor.activeTrip.resolveConflict(review, keepLocal: false)
            }
            #expect(editor.draft?.trip.name == "Newer typing must survive")
            let fresh = try await fixture.repository.reviewConflict(original.id)
            try await editor.activeTrip.resolveConflict(fresh, keepLocal: true)
            try await eventually(timeout: .seconds(15)) { editor.draft?.nativeBase?.contentRevision == 3 }
            #expect(try await fixture.cloud.trip(original.id).content?.name == "Newer typing must survive")

            fixture.session.connectivityChanged(false)
            editor.rename("Recover my retained work")
            #expect(await editor.awaitCheckpoint())
            try await editor.activeTrip.saveDraftToAccount()
            try await remote.acceptTripSnapshot(fixture.cloud.trip(original.id))
            let reviewedDeletion = try #require(try await remote.currentNativeDraft(id: original.id))
            try await remote.deleteNativeTrip(matching: reviewedDeletion)
            let deletion = try #require(try await remote.nextTripSubmission(id: original.id))
            _ = try await fixture.cloud.submit(deletion)
            fixture.session.connectivityChanged(true)
            try await eventually(timeout: .seconds(15)) {
                fixture.session.nativeTrips?.conflicts == [original.id]
            }
            let deletedReview = try await fixture.repository.reviewConflict(original.id)
            #expect(deletedReview.snapshot.metadata?.deleted == true)
            try await editor.activeTrip.resolveConflict(deletedReview, keepLocal: true)
            let recoveredID = try #require(editor.draft?.id)
            #expect(recoveredID != original.id && editor.notice?.contains("new trip") == true)
            try await eventually(timeout: .seconds(15)) { editor.draft?.nativeBase?.contentRevision == 1 }
            #expect(try await fixture.cloud.trip(original.id).metadata?.deleted == true)
            #expect(try await fixture.cloud.trip(recoveredID).content?.name == "Recover my retained work")
            await remote.close()
            try FileManager.default.removeItem(at: remoteDirectory)
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func completedArchiveRebuildRemovesExpiredGhostsFromThePresentedLibrary() async throws {
        try await withApp { fixture in
            let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let store = try await NativeStore.open(
                directory: directory, project: "demo-bark-native", uid: fixture.uid)
            try await store.acceptTripSnapshot(
                nativeTripSnapshot(Trip(id: "expired-ghost", name: "Old cached trip"), revision: 1))
            let feature = NativeTripFeature(scope: "rebuild", store: store, cloud: fixture.cloud)
            try await feature.start()
            #expect(feature.library.saved.map(\.id) == ["expired-ghost"])
            feature.setNetworkAllowed(true)
            await feature.waitForSync()
            #expect(feature.message == nil)
            #expect(feature.library.saved.isEmpty && !feature.hasMore)
            await feature.close()
            await store.close()
            try FileManager.default.removeItem(at: directory)
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func metadataOnlyRemoteDeletionClearsTheSharedMapAndPlannerEditor() async throws {
        try await withApp { fixture in
            let editor = fixture.editor
            #expect(editor.newTrip())
            editor.rename("Delete remotely")
            #expect(await editor.awaitCheckpoint())
            editor.save()
            try await eventually(timeout: .seconds(15)) { editor.draft?.nativeBase?.contentRevision == 1 }
            await fixture.session.nativeTrips?.waitForSync()
            let draft = try #require(editor.draft)
            let old = try await fixture.cloud.trip(draft.id)
            fixture.session.connectivityChanged(false)
            let id = UUID()
            let intent = NativeTripIntent.delete(tripID: draft.id, contentRevision: 1)
            let bytes = try JSONEncoder().encode(
                NativeTripCommand(
                    operationID: id,
                    createdAtMs: Int64(Date().timeIntervalSince1970 * 1000), expectedRevision: 1,
                    intent: intent))
            let result = try await fixture.cloud.submit(.init(id: id, bytes: bytes, attempts: 0))
            #expect(result.status == .accepted)
            let query = try await fixture.repository.store.tripChangesQuery()
            let page = try await fixture.cloud.changes(query)
            #expect(page.items.contains { $0.id == draft.id && $0.deleted })
            _ = try await fixture.repository.store.acceptTripChanges(page, requested: query)
            try await eventually { editor.draft == nil && fixture.map.draft == nil }
            #expect(fixture.session.nativeTrips?.library.rows.contains { $0.id == draft.id } == false)
            #expect(try await fixture.repository.store.nativeSelection().tripID == nil)
            // A held pre-deletion reply cannot reinstall that editor later.
            try await fixture.repository.store.acceptTripSnapshot(old)
            await editor.activeTrip.resume()
            #expect(editor.draft == nil && fixture.map.draft == nil)
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func anOvertakenDetailReplyDoesNotMeanTheSelectedEditorIsEmpty() async throws {
        try await withApp { fixture in
            let editor = fixture.editor
            #expect(editor.newTrip())
            editor.rename("Retain the visible trip")
            #expect(await editor.awaitCheckpoint())
            editor.save()
            try await eventually(timeout: .seconds(15)) { editor.draft?.nativeBase?.contentRevision == 1 }
            await fixture.session.nativeTrips?.waitForSync()
            fixture.session.connectivityChanged(false)
            let original = try #require(editor.draft)
            let snapshot = try await fixture.cloud.trip(original.id)
            let prior = try #require(snapshot.metadata)
            let time = try NativeServerTime(seconds: prior.updatedAt.seconds + 1, nanoseconds: 0)
            let newer = NativeTripMetadata(
                id: prior.id, revision: 2, contentRevision: 2,
                title: "Newer metadata already seen", dayCount: prior.dayCount, stopCount: prior.stopCount,
                contentBytes: prior.contentBytes, createdAt: prior.createdAt, updatedAt: time)
            try await fixture.repository.store.acceptTripLibraryPage(.init(items: [newer], readTime: time))
            // The actual SDK still returns revision 1, representing an overtaken read.
            await #expect(throws: NativeStore.Failure.staleRead) {
                try await fixture.repository.restoreActiveDraft()
            }
            await editor.activeTrip.resume()
            #expect(editor.draft == original && fixture.map.draft == original)
            #expect(try await fixture.repository.store.nativeSelection().tripID == original.id)
            #expect(editor.notice?.contains("could not be loaded") == true)
        }
    }

    private func withApp(_ work: (NativeTripAppFixture) async throws -> Void) async throws {
        let fixture = try await NativeTripAppFixture.make()
        do {
            try await work(fixture)
            await fixture.close()
        } catch {
            await fixture.close()
            throw error
        }
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func oneDemandOwnerReusesCachedDetailsAndRefreshesRemoteNotesOnlyWhileOpen() async throws {
        try await withApp { fixture in
            let feature = try #require(fixture.session.nativeTrips)
            let transport = try #require(fixture.repository.cloud?.transport)
            await feature.waitForSync()
            let trip = Trip(
                name: "Demand-owned details",
                days: [
                    .init(stops: [
                        .init(
                            id: "one", placeIdentity: .custom("one"), name: "One",
                            coordinate: Coordinate(latitude: 41, longitude: -81), notes: "Original")
                    ])
                ])
            func submit(_ intent: NativeTripIntent) async throws {
                let id = UUID()
                let command = NativeTripCommand(
                    operationID: id,
                    createdAtMs: Int64(Date().timeIntervalSince1970 * 1000),
                    expectedRevision: intent.baseRevision, intent: intent)
                let outcome = try await fixture.cloud.submit(
                    .init(
                        id: id,
                        bytes: JSONEncoder().encode(command), attempts: 0))
                #expect(outcome.status == .accepted)
            }
            try await submit(.save(.init(trip: trip)))
            _ = await transport.recordedCallKinds(reset: true)
            try await fixture.editor.activeTrip.selectTrip(id: trip.id, dayID: nil)
            try await Task.sleep(for: .milliseconds(150))  // Let selected-editor publications drain.
            #expect(await transport.recordedCallKinds(reset: true).filter { $0 == "trip" }.count == 1)
            for _ in 0..<3 { try await fixture.editor.activeTrip.selectTrip(id: trip.id, dayID: nil) }
            feature.requestSync(refresh: true)
            await feature.waitForSync()
            try await Task.sleep(for: .milliseconds(150))
            #expect(await transport.recordedCallKinds(reset: true).filter { $0 == "trip" }.isEmpty)

            var remote = try #require(fixture.editor.draft)
            remote.trip.days[0].stops[0].notes = "Remote note only"
            try await submit(.notes(remote))
            // A real detail response may overlap the library head/change feed or
            // another refresh. Hold it, rather than hoping CI's timing exposes
            // cancellation followed by a second download of the same revision.
            let replyGate = TripReplyGate()
            await transport.setTripReplyBarrier { await replyGate.wait() }
            defer { Task { await replyGate.release() } }
            feature.requestSync(refresh: true)
            await feature.waitForSync()
            try await eventually { await replyGate.entered }
            feature.requestSync(refresh: true)
            await feature.waitForSync()
            await replyGate.release()
            try await eventually { fixture.editor.draft?.trip.days[0].stops[0].notes == "Remote note only" }
            await transport.setTripReplyBarrier(nil)
            #expect(fixture.editor.draft?.nativeBase?.contentRevision == 1)
            let remoteNoteDownloads = await transport.recordedCallKinds(reset: true).filter { $0 == "trip" }.count
            #expect(remoteNoteDownloads == 1)

            fixture.editor.activeTrip.stop()
            remote = try #require(fixture.editor.draft)
            remote.trip.days[0].stops[0].notes = "Changed while closed"
            try await submit(.notes(remote))
            feature.requestSync(refresh: true)
            await feature.waitForSync()
            #expect(await transport.recordedCallKinds(reset: true).filter { $0 == "trip" }.isEmpty)
            fixture.editor.activeTrip.start()
            try await eventually {
                fixture.editor.draft?.trip.days[0].stops[0].notes == "Changed while closed"
            }
            #expect(await transport.recordedCallKinds(reset: true).filter { $0 == "trip" }.count == 1)
            // No metadata change can trigger this retry: simulate detail lost while
            // offline, with the retained selection outside a foreground library page.
            fixture.editor.activeTrip.connectivityChanged(false)
            try await fixture.repository.store.dropNoteTestDetail(trip.id)
            #expect(try await fixture.repository.store.cachedTrip(id: trip.id) == nil)
            fixture.editor.activeTrip.connectivityChanged(true)
            try await eventually { (try? await fixture.repository.store.cachedTrip(id: trip.id)) != nil }
            #expect(await transport.recordedCallKinds(reset: true).filter { $0 == "trip" }.count == 1)
            fixture.editor.activeTrip.connectivityChanged(false)
            fixture.editor.activeTrip.connectivityChanged(true)
            try await Task.sleep(for: .milliseconds(150))
            #expect(await transport.recordedCallKinds(reset: true).filter { $0 == "trip" }.isEmpty)
        }
    }
}

private actor TripReplyGate {
    private(set) var entered = false
    private var open = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        entered = true
        if !open { await withCheckedContinuation { waiters.append($0) } }
    }
    func release() {
        open = true
        let pending = waiters
        waiters = []
        for waiter in pending { waiter.resume() }
    }
}

extension NativeStore {
    fileprivate func dropNoteTestDetail(_ id: String) throws {
        try removeCleanTripContent(id)
        try commit()
    }
}

@MainActor private final class NativeTripAppFixture {
    let context: DiscoveryTestContext
    let session: AccountSession
    let editor: TripEditorModel
    let map: RouteDaySheetViewModel
    let app: FirebaseApp
    let uid: String
    let cloud: NativeTripCloud
    let repository: NativeTripRepository
    var routeRequests: [String] = []
    private init(
        context: DiscoveryTestContext, session: AccountSession, editor: TripEditorModel,
        map: RouteDaySheetViewModel, app: FirebaseApp, uid: String, cloud: NativeTripCloud,
        repository: NativeTripRepository
    ) {
        self.context = context
        self.session = session
        self.editor = editor
        self.map = map
        self.app = app
        self.uid = uid
        self.cloud = cloud
        self.repository = repository
    }
    static func make() async throws -> NativeTripAppFixture {
        let context = try DiscoveryTestContext()
        try await context.start()
        let scope = UUID()
        let assembly = AccountAssembly.nativeEmulator(
            directory: .temporaryDirectory.appendingPathComponent(UUID().uuidString), scope: scope)
        let session = assembly.session
        weak var observed: NativeTripAppFixture?
        let routes = DayRouteService { segment in
            observed?.routeRequests.append(segment.geometryKey)
            let coordinates = [segment.from, segment.to].compactMap(\.coordinate).map {
                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
            }
            return RoadRoute(
                polyline: MKPolyline(coordinates: coordinates, count: coordinates.count),
                meters: 1000, seconds: 100)
        }
        let active = ActiveTripSession(account: session, routes: routes)
        let editor = TripEditorModel(
            activeTrip: active, catalog: context.catalog, maps: MapsHandoff(open: { _ in true }))
        let map = RouteDaySheetViewModel(activeTrip: active)
        active.start()
        session.setForeground(true)
        session.connectivityChanged(true)
        // AccountModel drops every action while the session is still checking device cleanup,
        // exactly as the disabled buttons do on screen. Creating the account before that
        // finishes is silently ignored and the fixture then waits for an account forever.
        try await eventually { session.cleanupState == .ready }
        let account = AccountModel(session: session)
        account.email("\(UUID().uuidString)@native.invalid", password: "NativeOnly123!", create: true)
        await account.action?.value
        try await eventually(timeout: .seconds(15)) {
            session.profileState?.confirmed != nil && session.nativeTrips != nil
        }
        let app = try #require(FirebaseApp.app(name: "BarkNativeUI-\(scope.uuidString)"))
        let uid = try #require(session.identity?.uid)
        try await NativeEmulatorFixture.seedAccess(uid: uid, app: app)
        session.requestSync(refresh: true)
        try await eventually(timeout: .seconds(15)) { session.dataAccess.canEditAccount }
        let repository = try #require(session.nativeTrips?.repository)
        let cloud = try NativeTripCloud(
            transport: NativeCallableTransport(uid: uid, auth: Auth.auth(app: app)))
        let fixture = NativeTripAppFixture(
            context: context, session: session, editor: editor,
            map: map, app: app, uid: uid, cloud: cloud, repository: repository)
        observed = fixture
        return fixture
    }
    func close() async {
        editor.activeTrip.stop()
        await session.stopAndWait()
        await cloud.transport.close()
        try? await Firestore.firestore(app: app).terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        context.close()
        try? FileManager.default.removeItem(at: session.directory)
    }
}
