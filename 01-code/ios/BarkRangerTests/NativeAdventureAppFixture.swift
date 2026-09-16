import BarkDomain
import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor final class NativeAdventureAppFixture {
    let context: DiscoveryTestContext
    let session: AccountSession
    let app: FirebaseApp
    let uid: String
    let visits: NativeVisitFeature
    let walks: NativeExpeditionFeature
    let map: MapFeatureModel
    let passport: PassportModel
    let expedition: ExpeditionModel
    let visitCloud: NativeVisitCloud
    let walkCloud: NativeExpeditionCloud
    var store: NativeStore { visits.repository.store }
    private init(context: DiscoveryTestContext, session: AccountSession, app: FirebaseApp, uid: String,
        visits: NativeVisitFeature, walks: NativeExpeditionFeature, visitCloud: NativeVisitCloud, walkCloud: NativeExpeditionCloud) {
        self.context = context; self.session = session; self.app = app; self.uid = uid
        self.visits = visits; self.walks = walks; self.visitCloud = visitCloud; self.walkCloud = walkCloud
        map = MapFeatureModel(catalog: context.catalog, settings: context.settings,
            location: LocationClient(manager: nil), maps: MapsHandoff(open: { _ in true }), account: session)
        passport = PassportModel(account: session, catalog: context.catalog,
            leaderboard: LeaderboardModel(repository: nil, account: session))
        let recorder = WalkRecorder(account: session, store: RecordingStore(directory: session.directory),
            location: TestWalkLocation(), motion: TestWalkMotion(), activity: TestWalkActivity())
        expedition = ExpeditionModel(account: session, recorder: recorder, geometry: TrailRepository(), health: HealthWorkoutImporter())
    }
    static func make() async throws -> NativeAdventureAppFixture {
        let context = try DiscoveryTestContext()
        try await context.start()
        let scope = UUID()
        let assembly = AccountAssembly.nativeEmulator(directory: .temporaryDirectory.appendingPathComponent(UUID().uuidString), scope: scope)
        let session = assembly.session
        session.setForeground(true)
        session.connectivityChanged(true)
        // Foreground starts asynchronous account cleanup; sign-in is gated until it finishes.
        try await eventually { session.cleanupState == .ready }
        let account = AccountModel(session: session)
        account.email("\(UUID().uuidString)@native.invalid", password: "NativeOnly123!", create: true)
        await account.action?.value
        try await eventually(timeout: .seconds(15)) { session.profileState?.confirmed != nil && session.nativeExpeditions != nil }
        let app = try #require(FirebaseApp.app(name: "BarkNativeUI-\(scope.uuidString)"))
        let uid = try #require(session.identity?.uid)
        try await NativeEmulatorFixture.seedAccess(uid: uid, app: app)
        session.requestSync(refresh: true)
        try await eventually(timeout: .seconds(15)) { session.dataAccess.canEditAccount }
        await session.waitForSync()
        let visits = try #require(session.nativeVisits), walks = try #require(session.nativeExpeditions)
        let auth = Auth.auth(app: app)
        let value = NativeAdventureAppFixture(context: context, session: session, app: app, uid: uid, visits: visits, walks: walks,
            visitCloud: try NativeVisitCloud(transport: NativeCallableTransport(uid: uid, auth: auth)),
            walkCloud: try NativeExpeditionCloud(transport: NativeCallableTransport(uid: uid, auth: auth)))
        value.map.start()
        return value
    }
    func offline() async {
        session.connectivityChanged(false)
        await visits.sync?.wait()
        await walks.sync?.wait()
    }
    func settle() async throws {
        session.connectivityChanged(true)
        session.requestSync()
        try await eventually(timeout: .seconds(20)) {
            let visits = try? await self.store.visitQueue().count
            let walks = try? await self.store.expeditionQueue().count
            return visits == 0 && walks == 0
        }
        await session.waitForSync()
    }
    func send(_ action: NativeExpeditionAction) async throws -> NativeExpeditionOutcome {
        let id = UUID()
        let command = NativeExpeditionCommand(id: id, createdAtMs: Int64(Date().timeIntervalSince1970 * 1000), action: action)
        return try await walkCloud.submit(.init(id: id, bytes: JSONEncoder().encode(command), attempts: 0))
    }
    func close() async {
        passport.resetScope(); expedition.resetScope(); map.stop()
        await session.stopAndWait()
        await visitCloud.transport.close(); await walkCloud.transport.close()
        try? await Firestore.firestore(app: app).terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        context.close()
        try? FileManager.default.removeItem(at: session.directory)
    }
}
