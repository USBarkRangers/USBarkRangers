import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

/// Several readers build `Dictionary(uniqueKeysWithValues:)` from server arrays, which traps on
/// a repeated key. A reply that repeats an identity must be refused as an error before any of
/// those run. Each case here would crash the test process rather than fail if that broke.
struct NativeRemoteIdentityTests {
    private let time: [String: Any] = ["seconds": 1_800_000_000, "nanoseconds": 1]
    private func decode<Value: Decodable>(_ type: Value.Type, _ object: [String: Any]) throws -> Value {
        try NativeCallableTransport.decodeReply(type, from: object)
    }

    @Test func aWalkSnapshotThatRepeatsARunIsRefused() throws {
        let run: [String: Any] = [
            "schemaVersion": 1, "id": "11111111-1111-4111-8111-111111111111", "revision": 1,
            "trailID": "trail", "trailRevision": 1, "name": "Trail", "totalMiles": 10.0, "miles": 1.0,
            "status": "active", "startedAtMs": 1_800_000_000_000, "createdAt": time, "updatedAt": time,
        ]
        let reply = try decode(
            NativeExpeditionSnapshot.self,
            ["version": 1, "activityClaimed": false, "runs": [run, run], "readTime": time])
        #expect(reply.runs.count == 2)
        #expect(throws: (any Error).self) { try reply.validate(activityID: nil, runID: nil) }
        #expect(throws: NativeCallableTransport.Failure.invalidReply) {
            try NativeCallableTransport.validateReply { try reply.validate(activityID: nil, runID: nil) }
        }
    }

    @Test func aVisitSelectionThatRepeatsARequestIsRefused() throws {
        let request: [String: Any] = [
            "visitID": "22222222-2222-4222-8222-222222222222", "officialPlaceID": "official-a",
            "siteID": "site-a",
        ]
        let reply = try decode(
            NativeVisitSelection.self,
            [
                "version": 1, "requests": [request, request], "visits": [] as [Any], "places": [] as [Any],
                "readTime": time,
            ])
        let expected = NativeVisitReference(
            visitID: "22222222-2222-4222-8222-222222222222", officialPlaceID: "official-a", siteID: "site-a")
        #expect(throws: (any Error).self) { try reply.validate(for: [expected, expected]) }
        #expect(throws: (any Error).self) { try reply.validate(for: [expected]) }
    }

    @Test func completedTrailsThatRepeatAnItemNeverReachTheStore() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: "a")
        let item: [String: Any] = [
            "schemaVersion": 1, "id": "33333333-3333-4333-8333-333333333333",
            "runID": "33333333-3333-4333-8333-333333333333", "name": "Trail", "trailRevision": 1,
            "meters": 1609.0, "completedAtMs": 1_800_000_000_000, "updatedAt": time,
        ]
        let reply = try decode(
            NativeCompletedTrails.self, ["version": 1, "items": [item, item], "readTime": time])
        #expect(reply.items.count == 2)
        await #expect(throws: (any Error).self) { try await store.acceptNativeCompletedTrails(reply) }
        #expect(try await store.nativeCompletedTrails().isEmpty)
        await store.close()
    }

    @Test func tripPagesAndChangePagesThatRepeatATripAreRefused() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "scan", guest: true)
        let stamp = try NativeServerTime(seconds: 1_800_000_000, nanoseconds: 1)
        let upper = try NativeServerTime(seconds: 1_800_000_001, nanoseconds: 0)
        let item = NativeTripMetadata(
            id: "trip-1", revision: 1, contentRevision: 1, title: "Trip", dayCount: 1, stopCount: 0,
            contentBytes: 100, createdAt: stamp, updatedAt: stamp)
        await #expect(throws: (any Error).self) {
            try await store.acceptTripLibraryPage(.init(items: [item, item], readTime: upper))
        }
        let query = try await store.tripChangesQuery()
        await #expect(throws: (any Error).self) {
            try await store.acceptTripChanges(
                NativeTripChanges(items: [item, item], upper: upper, next: nil), requested: query)
        }
        #expect(try await store.tripMetadataPage().isEmpty)
        await store.close()
    }
}
