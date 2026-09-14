import Foundation
import Testing
@testable import BarkDomain

struct NativeSharedContractTests {
    struct Fixture: Decodable {
        let version: Int
        let acceptanceDays: Double
        let cases: [Example]
    }
    struct Example: Decodable {
        let id: String
        let field: String
        let value: String?
        let number: Double?
        let `repeat`: Int?
        let valid: Bool
        var text: String { String(repeating: value ?? "", count: self.repeat ?? 1) }
    }
    @Test func sharedNativeFieldsMatchServerContract() throws {
        let url = try #require(Bundle.module.url(forResource: "native-fields-v1", withExtension: "json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        #expect(fixture.version == 1)
        #expect(NativeSyncPolicy.acceptanceWindow == fixture.acceptanceDays * 86_400)
        for example in fixture.cases {
            do {
                try validate(example)
                #expect(example.valid, "Swift accepted invalid shared case: \(example.id)")
            } catch {
                #expect(!example.valid, "Swift rejected valid shared case: \(example.id): \(error)")
            }
        }
    }
    private func validate(_ example: Example) throws {
        if example.field == "profileName" {
            try NativeProfileEdit.displayName(example.text).validate()
            return
        }
        var stop = Trip.Stop(id: example.field == "stopID" ? example.text : "stop-1",
            placeIdentity: .custom("place-1"), name: "Place", coordinate: .init(latitude: 40, longitude: -75))
        var day = Trip.Day(id: example.field == "dayID" ? example.text : "day-1")
        switch example.field {
        case "stopName": stop.name = example.text
        case "state": stop.state = example.text
        case "city": stop.city = example.text
        case "arrivalTime": stop.arrivalTime = example.text
        case "visitMinutes": stop.visitMinutes = example.number
        case "notes": stop.notes = example.text
        case "color": day.color = example.text
        case "date": day.date = example.text
        case "tripID", "dayID", "stopID", "tripName": break
        default: throw FixtureFailure.unknownField
        }
        day.stops = [stop]
        let trip = Trip(id: example.field == "tripID" ? example.text : "trip-1",
            name: example.field == "tripName" ? example.text : "Trip", days: [day])
        // Exercise the real outbound constructor, not a second validator in this test.
        _ = try NativeTripSave(trip: trip, baseNotes: [:])
    }
    private enum FixtureFailure: Error { case unknownField }
}
