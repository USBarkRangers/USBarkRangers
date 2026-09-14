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
    @Test(arguments: [393, 5_000])
    func repeatedEditsWithRetainedFiftyDayTripStayOffMainActor(_ count: Int) async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let probe = StoreThreadProbe()
        let store = try await LocalStore.open(directory: folder, uid: "scale", beforeSave: { probe.record() })
        var baseline = try await Self.decode(count: count)
        let days: [UserValue] = (0..<50).map { day in
            .object([
                "notes": .string("Preserve day \(day) notes"),
                "stops": .array([
                    .object(["parkId": .string("retained-\(day)")]),
                    .object(["custom": .bool(true), "name": .string("Original custom stop")]),
                ]),
            ])
        }
        baseline.trips = [SavedRecord(id: "fifty-day-trip", fields: ["tripDays": .array(days)])]
        try await store.applyServerSnapshot(baseline, sequence: store.beginRead())
        // Measure the actual UI intent boundary below, independently of direct fixture setup calls.
        probe.reset()
        let diskBefore = try Self.diskBytes(folder)
        var milliseconds: [Double] = []
        for edit in 0..<30 {
            let start = ContinuousClock.now
            try await ProfileRepository(store: store).editDisplayName("Repeated edit \(edit)")
            let elapsed = start.duration(to: .now)
            milliseconds.append(
                Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15)
        }
        let state = try await store.readSnapshot()
        #expect(state.pending.count == 30)
        #expect(state.baseline.trips == baseline.trips && state.visible.visitCount == count)
        #expect(!probe.usedMainThread)
        let diskAfter = try Self.diskBytes(folder)
        print(
            "READINESS records=\(count) edits=30 medianMs=\(milliseconds.sorted()[15]) maxMs=\(milliseconds.max() ?? 0) diskBefore=\(diskBefore) diskAfter=\(diskAfter) mainThreadSave=\(probe.usedMainThread)"
        )
        await store.close()
        try FileManager.default.removeItem(at: folder)
    }
    private static func diskBytes(_ directory: URL) throws -> Int {
        try FileManager.default.subpathsOfDirectory(atPath: directory.path).reduce(0) { bytes, path in
            let value = try directory.appendingPathComponent(path).resourceValues(forKeys: [
                .fileSizeKey, .isRegularFileKey,
            ])
            return bytes + (value.isRegularFile == true ? value.fileSize ?? 0 : 0)
        }
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
            uid: "scale",
            user: ["visitedPlaces": visits, "entitlement": ["premium": true, "status": "active"]],
            trips: [], achievements: [])
    }
}
nonisolated final class StoreThreadProbe: Sendable {
    static var isMainThread: Bool { Thread.isMainThread }
    private let mainThread = Mutex(false)
    var usedMainThread: Bool { mainThread.withLock { $0 } }
    func reset() { mainThread.withLock { $0 = false } }
    func record() { if Thread.isMainThread { mainThread.withLock { $0 = true } } }
}
