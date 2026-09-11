import BarkDomain
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct CloudUserDecoderTests {
    @Test func currentFixturePreservesEveryFieldIdentityOrderAndBothAchievementRepresentations() throws {
        // The shared fixture is also used by the emulator seed tool. This suite runs on Simulator/CI.
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let bytes = try Data(
            contentsOf: repository.appendingPathComponent("03-tests/fixtures/ios/current-account.json"))
        let raw = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let user = try #require(raw["user"] as? [String: Any])
        let trips = try JSONDecoder().decode(
            [SavedRecord].self, from: JSONSerialization.data(withJSONObject: raw["trips"] ?? []))
        let badges = try JSONDecoder().decode(
            [SavedRecord].self, from: JSONSerialization.data(withJSONObject: raw["achievements"] ?? []))
        let snapshot = try CloudUserDecoder.decode(
            uid: "native-test-a", user: user, trips: trips, achievements: badges)
        let original = try CloudUserDecoder.value(user).object
        #expect(snapshot.profile.fields == original)
        #expect(snapshot.trips == trips)
        #expect(snapshot.achievements == badges)
        #expect(
            snapshot.profile.fields["achievements"]?.object?["historic-badge"]?.object?["tier"]
                == .string("verified"))
        #expect(snapshot.unresolved.count == 1)
        #expect(snapshot.visitCount == 2)
        #expect(snapshot.achievementCount == Set(badges.map(\.id)).union(["historic-badge"]).count)
        let visit = CloudUserDecoder.visit(
            try #require(snapshot.profile.fields["visitedPlaces"]?.array?.first))
        #expect(visit.parkID == "retired-park-identity")
        #expect(visit.visitedAt?.timeIntervalSince1970 == 1_725_000_000)
        let trip = try CloudUserDecoder.trip(#require(snapshot.trips.first))
        #expect(trip.id == "stored-route-id")
        #expect(trip.days.count == 2)
        let expedition = CloudUserDecoder.expedition(
            try #require(snapshot.profile.fields["completed_expeditions"]?.array?.first), completed: true)
        #expect(expedition.distanceMeters == 80467.2)
        #expect(expedition.completedAt == visit.visitedAt)
        #expect(snapshot.completedExpeditionCount == 1)
        let days = try #require(snapshot.trips.first?.fields["tripDays"]?.array)
        #expect(days[0].object?["notes"] == .string("First day notes"))
        #expect(days[1].object?["notes"] == .string("Second day notes"))
        #expect(days[0].object?["stops"]?.array?[1].object?["customPlaceId"] == .string("custom-stop-7"))
        let meters = try #require(
            CloudUserDecoder.meters(fromStoredMiles: snapshot.profile.fields["lifetime_miles"]))
        #expect(abs(meters - 178234.848) < 0.0001)
        let roundtrip = try JSONDecoder().decode(PersonalSnapshot.self, from: JSONEncoder().encode(snapshot))
        #expect(roundtrip == snapshot)
    }
    @Test func malformedShapesFailBeforeTheyCanReplaceSavedData() throws {
        #expect(throws: (any Error).self) {
            try CloudUserDecoder.decode(
                uid: "a", user: ["visitedPlaces": "broken"], trips: [], achievements: [])
        }
        #expect(throws: (any Error).self) { try CloudUserDecoder.value(Double.infinity) }
        let timestamp = Timestamp(seconds: 1_700_000_000, nanoseconds: 123_000_000)
        let value = try CloudUserDecoder.value(timestamp)
        #expect(value.object?["nanoseconds"] == .number(123_000_000))
        #expect(value.date?.timeIntervalSince1970 == 1_700_000_000.123)
        #expect(try CloudUserDecoder.value(true) == .bool(true))
        #expect(try CloudUserDecoder.value(1) == .number(1))
        #expect(CloudUserDecoder.meters(fromStoredMiles: .number(-1)) == nil)
        #expect(CloudUserDecoder.meters(fromStoredMiles: .string("50")) == 80467.2)
    }
}
