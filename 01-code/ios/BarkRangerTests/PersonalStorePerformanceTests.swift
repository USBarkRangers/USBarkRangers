import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor struct PersonalStorePerformanceTests {
    @Test(arguments: [393, 5_000])
    func largerSnapshotsDecodeAndPersistOffMainActor(_ count: Int) async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let probe = StoreThreadProbe()
        let store = try await LocalStore.open(directory: folder, uid: "scale", beforeSave: { probe.record() })
        let start = ContinuousClock.now
        let snapshot = try await Self.decode(count: count)
        try await store.applyServerSnapshot(snapshot, sequence: store.beginRead())
        try await ProfileRepository(store: store).editDisplayName("Scaled account")
        let state = try await store.readSnapshot()
        #expect(state.visible.visitCount == count)
        #expect(state.pending.count == 1)
        #expect(!probe.usedMainThread)
        print(
            "Personal store records=\(count), decode+save=\(start.duration(to: .now)), Main-thread saves=\(probe.usedMainThread)"
        )
        await store.close()
    }
    @concurrent private static func decode(count: Int) async throws -> PersonalSnapshot {
        #expect(!StoreThreadProbe.isMainThread)
        let visits: [[String: Any]] = (0..<count).map {
            [
                "id": "retained-\($0)", "ts": 1_725_000_000_000,
                "name": "Historical park \($0)", "unknownField": ["notes": "Retain this record"],
            ]
        }
        return try CloudUserDecoder.decode(
            uid: "scale", user: ["visitedPlaces": visits], trips: [], achievements: [])
    }
}
nonisolated private final class StoreThreadProbe: Sendable {
    static var isMainThread: Bool { Thread.isMainThread }
    private let mainThread = Mutex(false)
    var usedMainThread: Bool { mainThread.withLock { $0 } }
    func record() { if Thread.isMainThread { mainThread.withLock { $0 = true } } }
}
