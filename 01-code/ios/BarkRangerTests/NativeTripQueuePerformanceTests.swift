import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct NativeTripQueuePerformanceTests {
    @Test func sealedRetriesAndQueueStatusDoNotNeedEveryTripBody() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "queue-cost")
        let id = try await store.seedTripQueueCost()
        let sealed = try #require(try await store.nextTripSubmission(id: id))
        await store.resetTripDecodeMeasurement()
        let start = ContinuousClock.now
        for _ in 0..<50 {
            #expect(try await store.nextTripSubmission(id: id) == sealed)
            #expect(try await store.tripQueueState(id).count == 24)
        }
        let elapsed = start.duration(to: .now)
        let decoded = await store.tripIntentDecodeCount
        print(
            "TRIP_QUEUE_COST queued=24 stops_per_trip=200 retries=50 status_reads=50 full_decodes=\(decoded) elapsed=\(elapsed)"
        )
        #expect(decoded == 0)
        await store.close()
        let reopened = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "queue-cost")
        #expect(try await reopened.nextTripSubmission(id: id) == sealed)
        await reopened.close()
    }

    @Test(arguments: ["json", "identity", "order"])
    func invalidQueuedBodiesCannotBeSealedAndOrderStillFailsClosed(_ damage: String) async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try await NativeStore.open(
            directory: directory, project: "demo-bark-native", uid: "damage")
        let id = try await store.seedTripQueueCost(count: 2, stops: 1)
        try await store.damageTripQueueCost(id, kind: damage)
        if damage != "order" { #expect(try await store.tripQueueState(id).count == 2) }
        await #expect(throws: (any Error).self) { try await store.nextTripSubmission(id: id) }
        await store.close()
    }
}

extension NativeStore {
    fileprivate func resetTripDecodeMeasurement() { tripIntentDecodeCount = 0 }
    fileprivate func seedTripQueueCost(count: Int = 24, stops: Int = 200) throws -> String {
        let trip = Trip(
            id: "queue-cost",
            days: [
                .init(
                    id: "day",
                    stops: (0..<stops).map {
                        .init(
                            id: "stop-\($0)", placeIdentity: .custom("place-\($0)"), name: "Place \($0)",
                            coordinate: Coordinate(latitude: 41, longitude: -81),
                            notes: "Retained offline planning text")
                    })
            ])
        var draft = TripDraft(trip: trip, nativeBase: .init())
        var predecessor: String?
        for index in 0..<count {
            draft.trip.name = "Offline save \(index)"
            let intent = NativeTripIntent.save(draft)
            predecessor = try insertTripIntent(intent, predecessor: predecessor, now: Date()).uuidString
                .lowercased()
            draft.nativeBase = try intent.projectedBase(for: draft.trip)
        }
        try commit()
        return trip.id
    }
    fileprivate func damageTripQueueCost(_ id: String, kind: String) throws {
        let row = try #require(try tripOperations(id).first)
        switch kind {
        case "json": row.intent = Data("{".utf8)
        case "identity":
            row.intent = try JSONEncoder().encode(
                NativeTripIntent.save(.init(trip: Trip(id: "other", name: "Other"), nativeBase: .init())))
        default: row.predecessor = UUID().uuidString.lowercased()
        }
        try commit()
    }
}
