import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct RecordingStoreTests {
    @Test func interruptedAppendTrimsUncommittedTailAndScopesRecovery() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let gate = RecordingWriteGate()
        let store = RecordingStore(directory: folder, beforeWrite: { try gate.check() })
        let now = Date()
        let record = WalkRecording(uid: "a", source: .gps, runID: nil, trailName: "Walk", now: Date())
        try await store.begin(record)
        let sample = WalkDistancePolicy.Sample(
            coordinate: try #require(Coordinate(latitude: 41, longitude: -81)), accuracy: 5, date: now)
        let point = RecordedPoint(sample: sample, segment: 0)
        gate.failOnWrite(2)
        await #expect(throws: (any Error).self) { try await store.append([point], checkpoint: record) }
        #expect(try await store.points(uid: "a").isEmpty)
        #expect(try await store.recover(uid: "b") == nil)
        try await store.append([point], checkpoint: record)
        #expect(try await store.points(uid: "a") == [point])
        await #expect(throws: (any Error).self) { try await store.begin(record) }
        await #expect(throws: (any Error).self) { try await store.remove(uid: "b", id: record.id) }
        try await store.remove(uid: "a", id: record.id)
        #expect(try await store.recover(uid: "a") == nil)
    }
    @Test func trailGeometryIsBundledAndInterpolationHasValidEndpoints() async throws {
        let repository = TrailRepository()
        for trail in try Trail.bundled() {
            let points = try await repository.geometry(id: trail.id)
            #expect(points.count >= 2)
            #expect(try await repository.position(id: trail.id, fraction: 0) == points.first)
            #expect(try await repository.position(id: trail.id, fraction: 1) == points.last)
        }
    }
}
