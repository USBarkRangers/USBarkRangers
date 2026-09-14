import Foundation
import Testing

@testable import BarkDomain

struct AdventurePolicyTests {
    private let now = Date(timeIntervalSince1970: 1_789_000_000)
    private func catalog() throws -> CatalogSnapshot {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent(
            "../../../../BarkRanger/Resources/catalog.json")
        return try JSONDecoder().decode(CatalogSnapshot.self, from: Data(contentsOf: url))
    }
    private func fixture() throws -> [String: UserValue] {
        let url = try #require(Bundle.module.url(forResource: "phase4-contracts", withExtension: "json"))
        return try #require(JSONDecoder().decode(UserValue.self, from: Data(contentsOf: url)).object)
    }
    @Test func sharedScoreAndRouteFixturesPreserveLegacyContracts() throws {
        let fixtures = try fixture()
        let catalog = try catalog()
        for value in fixtures["scoreCases"]?.array ?? [] {
            let item = try #require(value.object)
            let snapshot = PersonalSnapshot(
                uid: "fixture", profile: UserProfile(fields: item["user"]?.object ?? [:]))
            let summary = AchievementPolicy.summarize(snapshot: snapshot, catalog: catalog)
            #expect(summary.points == Int(item["points"]?.number ?? -1))
            #expect(summary.sites == Int(item["sites"]?.number ?? -1))
        }
        for value in fixtures["routeCases"]?.array ?? [] {
            let item = try #require(value.object)
            let trip = try Trip(record: SavedRecord(id: "fixture", fields: item["trip"]?.object ?? [:]))
            let expected = (item["names"]?.array ?? []).map { ($0.array ?? []).compactMap(\.string) }
            #expect(TripRoutePlan.build(trip).days.map { $0.points.map(\.name) } == expected)
            #expect(trip.record.fields["unknown"] == nil, "Native trips never retain arbitrary transport fields")
        }
    }
    @Test func visitIntentsHaveNoFreeTierBranchAndPreserveDates() throws {
        let catalog = try catalog()
        let parks = Array(catalog.parks.filter { !$0.isRetired }.prefix(6))
        var snapshot = PersonalSnapshot(uid: "intent")
        for park in parks.prefix(5) {
            snapshot = try #require(
                try VisitPolicy.mark(park: park, snapshot: snapshot, catalog: catalog, now: now)
            ).applying(to: snapshot)
        }
        #expect(snapshot.visitCount == 5)
        #expect(try VisitPolicy.mark(park: parks[5], snapshot: snapshot, catalog: catalog, now: now) != nil)
        let first = parks[0]
        let fix = LocationFix(coordinate: first.coordinate, accuracy: 10, date: now)
        let upgraded = try #require(
            try VisitPolicy.mark(park: first, snapshot: snapshot, catalog: catalog, fix: fix, now: now)
        ).applying(to: snapshot)
        #expect(upgraded.visitCount == 5)
        let visit = try #require(Visit.records(in: upgraded.profile).first { $0.parkID == first.id.rawValue })
        #expect(visit.verified && visit.visitedAt == now)
        #expect(
            try VisitPolicy.mark(park: first, snapshot: upgraded, catalog: catalog, fix: fix, now: now) == nil
        )
        snapshot = try #require(
            try VisitPolicy.remove(ids: [first.id.rawValue], snapshot: snapshot, now: now)
        ).applying(to: snapshot)
        #expect(try VisitPolicy.mark(park: parks[5], snapshot: snapshot, catalog: catalog, now: now) != nil)
    }
    @Test func proximityQualityAndBoundaryAreExplicit() throws {
        let park = try #require(catalog().parks.first)
        for accuracy in [-1.0, 5001, .nan] {
            #expect(throws: VisitPolicy.Failure.poorLocation) {
                try VisitPolicy.evaluateProximity(
                    park: park, fix: .init(coordinate: park.coordinate, accuracy: accuracy, date: now),
                    now: now)
            }
        }
        #expect(throws: VisitPolicy.Failure.poorLocation) {
            try VisitPolicy.evaluateProximity(
                park: park,
                fix: .init(coordinate: park.coordinate, accuracy: 10, date: now.addingTimeInterval(-60)),
                now: now)
        }
        let outside = try #require(
            Coordinate(latitude: park.coordinate.latitude + 0.23, longitude: park.coordinate.longitude))
        #expect(throws: VisitPolicy.Failure.outOfRange) {
            try VisitPolicy.evaluateProximity(
                park: park, fix: .init(coordinate: outside, accuracy: 10, date: now), now: now)
        }
    }
    @Test func dateEditAndSelectedDeletionPreserveUnrelatedHistory() throws {
        let record: UserValue = .object([
            "id": .string("retired"), "name": .string("Old park"), "verified": .bool(true),
            "ts": .number(1000), "unknown": .string("Keep"),
        ])
        let snapshot = PersonalSnapshot(
            uid: "free",
            profile: .init(fields: ["visitedPlaces": .array([record, .object(["id": .string("other")])])]))
        let edit = try VisitPolicy.changeDate(id: "retired", date: now, snapshot: snapshot, now: now)
        let changed = edit.applying(to: snapshot)
        let visit = try #require(Visit.records(in: changed.profile).first { $0.parkID == "retired" })
        #expect(visit.fields["unknown"] == .string("Keep") && visit.verified)
        let removed = try #require(try VisitPolicy.remove(ids: ["retired"], snapshot: changed)).applying(
            to: changed)
        #expect(removed.visitCount == 1 && Visit.records(in: removed.profile).first?.parkID == "other")
    }
    @Test func fiftyDaysLongNotesAndOptimizationNeverDropStopsOrNotes() throws {
        let catalog = try catalog()
        let days = (0..<50).map { index in
            Trip.Day(
                id: "day-\(index)", stops: [Trip.Stop(park: catalog.parks[index])],
                notes: String(repeating: "n", count: 1000))
        }
        let trip = Trip(days: days)
        try trip.validate()
        let optimized = TripOptimizer.optimize(trip)
        #expect(Set(optimized.days.flatMap(\.stops).map(\.id)) == Set(trip.days.flatMap(\.stops).map(\.id)))
        #expect(optimized.days.map(\.notes) == trip.days.map(\.notes))
        let partitioned = try TripOptimizer.partition(trip, hoursPerDay: 16, visitMinutes: 0)
        #expect(
            partitioned.totalStops == trip.totalStops
                && partitioned.days.map(\.notes) == trip.days.map(\.notes))
        var invalid = trip
        invalid.days.append(Trip.Day())
        #expect(throws: Trip.Failure.self) { try invalid.validate() }
        invalid = trip
        invalid.days[0].notes += "x"
        #expect(throws: Trip.Failure.notesLimit) { try invalid.validate() }
        #expect(throws: Trip.Failure.self) {
            try TripOptimizer.partition(Trip(days: []), hoursPerDay: 4, visitMinutes: 30)
        }
    }
    @Test func duplicatePreservesItineraryWithoutSharingTripIdentityOrServerHistory() throws {
        var stop = Trip.Stop(park: try #require(catalog().parks.first))
        stop.notes = "Stop note"
        var original = Trip(
            name: String(repeating: "🐾", count: 50),
            days: [.init(stops: [stop], notes: "Day note", color: "#ff0000")])
        original.start = stop.newOccurrence()
        original.end = stop.newOccurrence()
        let copy = original.duplicate()
        try copy.validate()
        #expect(copy.id != original.id && copy.name.utf16.count <= 100 && copy.name.hasSuffix(" copy"))
        #expect(copy.days == original.days && copy.start == original.start && copy.end == original.end)
        #expect(copy.days[0].stops[0].notes == "Stop note")
        #expect(copy.days[0].stops[0].placeIdentity == stop.placeIdentity)
        #expect(copy.record.fields["createdAt"] == nil && copy.record.fields["updatedAt"] == nil)
    }
    @Test func badgeHistoryKeepsEarliestDateStrongTierAndUnknownFields() throws {
        let snapshot = PersonalSnapshot(
            uid: "history",
            profile: .init(fields: [
                "achievements": .object([
                    "first_paw": .object([
                        "tier": .string("verified"), "dateEarned": .number(2000), "unknown": .string("Keep"),
                    ])
                ])
            ]),
            achievements: [
                SavedRecord(id: "first_paw", fields: ["tier": .string("honor"), "dateEarned": .number(1000)])
            ])
        let earned = AchievementPolicy.mergedHistory(snapshot)["first_paw"]?.object
        #expect(
            earned?["tier"]?.string == "verified" && earned?["dateEarned"]?.number == 1000
                && earned?["unknown"]?.string == "Keep")
        #expect(try AchievementPolicy.definitions().count == 65)
        let summary = AchievementPolicy.summarize(
            snapshot: .init(
                uid: "huge", profile: .init(fields: ["walkPoints": .number(Double.greatestFiniteMagnitude)])),
            catalog: try catalog())
        #expect(summary.points == 1_000_000_000)
    }
}
