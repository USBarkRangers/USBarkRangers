import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor final class RecordingClock {
    var date = Date()
    var uptime: Double = 100
    func advance(_ seconds: Double) {
        date.addTimeInterval(seconds)
        uptime += seconds
    }
}
@MainActor final class TestWalkLocation: WalkLocationSource {
    var output: AsyncThrowingStream<WalkDistancePolicy.Sample, Error>.Continuation?
    var starts = 0
    var stops = 0
    func startRecordingUpdates() async throws -> AsyncThrowingStream<WalkDistancePolicy.Sample, Error> {
        starts += 1
        let (stream, output) = AsyncThrowingStream<WalkDistancePolicy.Sample, Error>.makeStream()
        self.output = output
        return stream
    }
    func stopRecordingUpdates() {
        stops += 1
        output?.finish()
        output = nil
    }
}
@MainActor final class TestWalkMotion: WalkMotionSource {
    var available = true
    var starts = 0
    var output: AsyncThrowingStream<Double, Error>.Continuation?
    func start(from: Date) throws -> AsyncThrowingStream<Double, Error> {
        starts += 1
        let (stream, output) = AsyncThrowingStream<Double, Error>.makeStream()
        self.output = output
        return stream
    }
    func stop() {
        output?.finish()
        output = nil
    }
}
@MainActor final class TestWalkActivity: WalkActivityDisplaying {
    var starts = 0, updates = 0, ends = 0
    var disabled = false
    func start(_ recording: WalkRecording) async { if !disabled { starts += 1 } }
    func update(_ recording: WalkRecording, force: Bool) async { updates += 1 }
    func end() async { ends += 1 }
    func reconcile() async { ends += 1 }
}
nonisolated final class RecordingWriteGate: Sendable {
    private let countdown = Mutex<Int?>(nil)
    func failOnWrite(_ number: Int?) { countdown.withLock { $0 = number } }
    func check() throws {
        try countdown.withLock { count in
            if let value = count {
                if value == 1 {
                    count = nil
                    throw CocoaError(.fileWriteOutOfSpace)
                }
                count = value - 1
            }
        }
    }
}
@MainActor struct RecordingHarness {
    let folder: URL
    let auth: SyntheticAuth
    let account: AccountSession
    let store: NativeStore
    let clock = RecordingClock()
    let location = TestWalkLocation()
    let motion = TestWalkMotion()
    let activity = TestWalkActivity()
    let gate = RecordingWriteGate()
    let files: RecordingStore
    let recorder: WalkRecorder
    static func make() async throws -> Self {
        let folder = URL.temporaryDirectory.appendingPathComponent(
            "BarkPhase5-recording-" + UUID().uuidString)
        let local = try await NativeStore.open(directory: folder, project: "demo-bark-native", uid: "walker-a")
        try await local.acceptProfile(.init(revision: 1, displayName: "Walker"))
        let empty = try JSONDecoder().decode(NativeExpeditionSnapshot.self, from: JSONSerialization.data(withJSONObject: [
            "version": 1, "activityID": NSNull(), "runID": NSNull(), "state": NSNull(), "progress": NSNull(),
            "activity": NSNull(), "activityClaimed": false, "runs": [],
            "readTime": ["seconds": Int64(Date().timeIntervalSince1970), "nanoseconds": 0],
        ]))
        try await local.acceptNativeExpedition(empty)
        try await local.acceptEntitlement(.init(revision: 1, premium: true, source: .production,
            validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
        await local.close()
        let auth = SyntheticAuth()
        let (app, _, _) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let configuration = NativeProfileConfiguration(project: "demo-bark-native", connect: {
            try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: $0)
        })
        let account = AccountSession(auth: auth, cloud: nil, directory: folder, capabilities: .editableTest,
            nativeProfileConfiguration: configuration)
        account.setForeground(true)
        auth.select("walker-a")
        try await eventually { account.dataAccess.canEditAccount && account.nativeExpeditions != nil }
        let store = try #require(account.nativeExpeditions?.repository.store)
        let value = Self(folder: folder, auth: auth, account: account, store: store)
        await value.recorder.activateAccount()
        return value
    }
    private init(folder: URL, auth: SyntheticAuth, account: AccountSession, store: NativeStore) {
        self.folder = folder
        self.auth = auth
        self.account = account
        self.store = store
        files = RecordingStore(directory: folder, beforeWrite: { [gate] in try gate.check() })
        recorder = WalkRecorder(
            account: account, store: files, location: location, motion: motion, activity: activity,
            now: { [clock] in clock.date }, uptime: { [clock] in clock.uptime })
    }
    func point(_ latitude: Double, accuracy: Double = 5) async throws {
        await recorder.consume(
            .init(
                coordinate: try #require(Coordinate(latitude: latitude, longitude: -81)), accuracy: accuracy,
                date: clock.date))
    }
    func walk() async throws {
        await recorder.start(source: .gps)
        try await point(41)
        clock.advance(100)
        try await point(41.001)
    }
    func close() async {
        await recorder.suspend()
        await account.stopAndWait()
        // The host removes these marked test folders after the test process releases SQLite connections.
    }
}
