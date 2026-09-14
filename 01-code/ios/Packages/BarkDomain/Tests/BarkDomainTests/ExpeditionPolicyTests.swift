import Foundation
import Testing

@testable import BarkDomain

struct ExpeditionPolicyTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let run = "10000000-0000-0000-0000-000000000001"
    func apply(_ action: String, _ payload: [String: UserValue], to profile: UserProfile) throws
        -> UserProfile
    {
        try ExpeditionPolicy.applying(
            .object(["action": .string(action), "payload": .object(payload)]), to: profile, now: now)
    }
    func assigned() throws -> UserProfile {
        try apply(
            "assign", ["trailID": .string("angels_landing"), "runID": .string(run)],
            to: .init(fields: ["future": .string("kept")]))
    }
    func walk(_ profile: UserProfile, miles: Double = 5, id: String = UUID().uuidString.lowercased()) throws
        -> UserProfile
    {
        let summary = WalkSummary(
            id: id, source: .manual, startedAt: now, endedAt: now,
            meters: miles * 1609.344, elapsedSeconds: 0, runID: run)
        return try apply("walk", try #require(summary.value.object), to: profile)
    }
    @Test func legacyNumericMilesSurviveNewWritesAndMalformedKnownCollectionsAreNotErased() throws {
        let legacy = UserProfile(fields: [
            "walkPoints": .string("3"), "lifetime_miles": .string("12.5"),
            "virtual_expedition": .object([
                "history": .array([
                    .object([
                        "ts": .number(1000),
                        "miles": .string("2.5"), "type": .string("Manual Entry"), "trailName": .string("Old"),
                    ])
                ])
            ]),
        ])
        let projected = Expedition(profile: legacy)
        #expect(projected.history.first?.editable == true)
        #expect(projected.lifetimeMeters == 12.5 * 1609.344)
        let changed = try apply("remove", ["id": .string("legacy-1000")], to: legacy)
        #expect(changed.fields["lifetime_miles"] == .number(10))
        #expect(changed.fields["walkPoints"] == .number(3))
        let malformed = UserProfile(fields: [
            "virtual_expedition": .object(["native_walk_ids": .string("future schema")])
        ])
        #expect(throws: ExpeditionPolicy.Failure.self) {
            try apply("assign", ["trailID": .string("angels_landing"), "runID": .string(run)], to: malformed)
        }
    }
    @Test func editingEarlierRunOfSameTrailCannotChangeCurrentRunProgress() throws {
        let oldID = UUID().uuidString.lowercased()
        let logged = try walk(assigned(), id: oldID)
        let completed = try apply("claim", ["runID": .string(run)], to: logged)
        let nextRun = UUID().uuidString.lowercased()
        let next = try apply(
            "assign", ["trailID": .string("angels_landing"), "runID": .string(nextRun)], to: completed)
        let summary = WalkSummary(
            source: .manual, startedAt: now, endedAt: now, meters: 1609.344, elapsedSeconds: 0, runID: nextRun
        )
        let current = try apply("walk", try #require(summary.value.object), to: next)
        let corrected = try apply("remove", ["id": .string(oldID)], to: current)
        #expect(Expedition(profile: corrected).meters == 1609.344)
        let renamed = try apply(
            "edit",
            [
                "id": .string(summary.id), "meters": .number(1609.344),
                "date": .number(now.timeIntervalSince1970 * 1000), "trailName": .string("My renamed walk"),
            ], to: corrected)
        #expect(Expedition(profile: renamed).meters == 1609.344)
    }
    @Test func progressPastTrailLengthRetainsMileageForLaterCorrections() throws {
        let first = UUID().uuidString.lowercased()
        let logged = try walk(walk(assigned(), miles: 3, id: first), miles: 3)
        #expect(Expedition(profile: logged).meters == 6 * 1609.344)
        #expect(Expedition(profile: logged).fraction == 1)
        let corrected = try apply("remove", ["id": .string(first)], to: logged)
        #expect(Expedition(profile: corrected).meters == 3 * 1609.344)
    }
    @Test func newMileageHasZeroPointsAndCompletionIsOncePerRun() throws {
        let started = try assigned()
        let logged = try walk(started)
        #expect(logged.fields["walkPoints"] == .number(0))
        #expect(Expedition(profile: logged).fraction == 1)
        let complete = try apply("claim", ["runID": .string(run)], to: logged)
        #expect(complete.fields["walkPoints"] == .number(1))
        #expect(complete.fields["future"] == .string("kept"))
        #expect(Expedition(profile: complete).history.count == 1)
        #expect(throws: ExpeditionPolicy.Failure.self) {
            try apply("claim", ["runID": .string(run)], to: complete)
        }
    }
    @Test func manualLimitIsPerSubmissionAndRepeatedImportNeverDuplicates() throws {
        let started = try assigned()
        let id = UUID().uuidString.lowercased()
        let logged = try walk(started, miles: 15, id: id)
        #expect(throws: ExpeditionPolicy.Failure.self) { try walk(logged, id: id) }
        #expect(Expedition(profile: try walk(logged, miles: 15)).lifetimeMeters == 30 * 1609.344)
        #expect(throws: ExpeditionPolicy.Failure.self) { try walk(started, miles: 15.01) }
    }
    @Test func sourceIntervalsOverlapAcrossGPSMotionAndHealth() throws {
        let first = WalkSummary(
            source: .gps, startedAt: now.addingTimeInterval(-600), endedAt: now,
            meters: 600, elapsedSeconds: 600)
        let logged = try apply("walk", try #require(first.value.object), to: .init())
        for source in [WalkSummary.Source.health, .pedometer] {
            let overlapping = WalkSummary(
                source: source, startedAt: now.addingTimeInterval(-300), endedAt: now,
                meters: 200, elapsedSeconds: 300)
            #expect(throws: ExpeditionPolicy.Failure.self) {
                try apply("walk", try #require(overlapping.value.object), to: logged)
            }
        }
        let adjacent = WalkSummary(
            source: .health, startedAt: now.addingTimeInterval(-1200), endedAt: now.addingTimeInterval(-600),
            meters: 300, elapsedSeconds: 600)
        #expect(
            Expedition(profile: try apply("walk", try #require(adjacent.value.object), to: logged)).history
                .count == 2)
    }
    @Test func removingImportRetainsDeduplicationAndCorrectionsNeverRaiseLegacyPoints() throws {
        var profile = UserProfile(fields: [
            "walkPoints": .number(10), "lifetime_miles": .number(10),
            "virtual_expedition": .object([
                "history": .array([
                    .object([
                        "ts": .number(1000), "miles": .number(10), "type": .string("GPS Walk"),
                        "trailName": .string("old"), "future": .bool(true),
                    ])
                ])
            ]),
        ])
        profile = try apply(
            "edit",
            [
                "id": .string("legacy-1000"), "meters": .number(20 * 1609.344), "date": .number(2000),
                "trailName": .string("old"),
            ], to: profile)
        #expect(profile.fields["walkPoints"] == .number(10))
        #expect(Expedition(profile: profile).history[0].fields["future"] == .bool(true))
        profile = try apply("remove", ["id": .string("legacy-2000")], to: profile)
        #expect(profile.fields["walkPoints"] == .number(0))
        let id = UUID().uuidString.lowercased()
        let logged = try walk(assigned(), id: id)
        let removed = try apply("remove", ["id": .string(id)], to: logged)
        #expect(throws: ExpeditionPolicy.Failure.self) { try walk(removed, id: id) }
    }
    @Test func summaryFinishingTimeIsFrozenAndContainsNoRawPath() throws {
        var value = WalkRecording(uid: "one", source: .gps, runID: run, trailName: "Trail", now: now)
        value.elapsedSeconds = 80
        value.finishedAt = now.addingTimeInterval(90)
        let first = value.summary
        value.checkpointAt = now.addingTimeInterval(600)
        #expect(value.summary == first)
        #expect(value.summary.value.object?.count == 7)
        #expect(try JSONDecoder().decode(WalkRecording.self, from: JSONEncoder().encode(value)) == value)
    }
    @Test func malformedHistoryIdentityDoesNotTrap() {
        #expect(WalkHistoryRecord(fields: ["ts": .number(.infinity)], index: 2).id == "unresolved-2")
        #expect(WalkHistoryRecord(fields: ["ts": .number(1e30)], index: 1).id == "unresolved-1")
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
