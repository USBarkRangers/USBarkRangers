import Foundation
import Testing

@testable import BarkDomain

struct WalkSummaryTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let run = "recording-run"
    @Test func summaryFinishingTimeIsFrozenAndContainsNoRawPath() throws {
        var value = WalkRecording(uid: "one", source: .gps, runID: run, trailName: "Trail", now: now)
        value.elapsedSeconds = 80
        value.finishedAt = now.addingTimeInterval(90)
        let first = value.summary
        value.checkpointAt = now.addingTimeInterval(600)
        #expect(value.summary == first)
        #expect(first.endedAt == now.addingTimeInterval(90) && first.elapsedSeconds == 80)
        #expect(try JSONDecoder().decode(WalkRecording.self, from: JSONEncoder().encode(value)) == value)
    }
}

struct WalkDistanceTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func sample(_ latitude: Double, _ seconds: Double, accuracy: Double = 5) throws
        -> WalkDistancePolicy.Sample
    {
        .init(
            coordinate: try #require(Coordinate(latitude: latitude, longitude: -81)), accuracy: accuracy,
            date: now.addingTimeInterval(seconds))
    }
    @Test func stationaryNoiseTeleportAccuracyGapAndPauseAreSegmented() throws {
        var policy = WalkDistancePolicy()
        #expect(policy.accept(try sample(41, 0), now: now) == .anchor)
        #expect(policy.accept(try sample(41.00001, 10), now: now.addingTimeInterval(10)) == .stationary)
        #expect(policy.meters == 0)
        #expect(policy.accept(try sample(41.001, 100), now: now.addingTimeInterval(100)) == .movement)
        let distance = policy.meters
        #expect(distance > 110 && distance < 112)
        #expect(policy.accept(try sample(43, 101), now: now.addingTimeInterval(101)) == .speed)
        #expect(policy.accept(try sample(44, 300), now: now.addingTimeInterval(300)) == .gap)
        #expect(
            policy.accept(try sample(44, 310, accuracy: 100), now: now.addingTimeInterval(310)) == .inaccurate
        )
        #expect(policy.accept(try sample(45, 320), now: now.addingTimeInterval(320)) == .anchor)
        policy.reanchor()
        #expect(policy.accept(try sample(46, 330), now: now.addingTimeInterval(330)) == .anchor)
        #expect(policy.meters == distance)
        #expect(policy.segment == 4)
    }
    @Test func staleAndOutOfOrderFixesCannotAddDistance() throws {
        var policy = WalkDistancePolicy()
        #expect(policy.accept(try sample(41, -200), now: now) == .stale)
        #expect(policy.accept(try sample(41, 0), now: now) == .anchor)
        #expect(policy.accept(try sample(42, 0), now: now) == .stale)
        #expect(policy.accept(try sample(42, 100), now: now) == .stale)
        #expect(policy.meters == 0)
    }
}
