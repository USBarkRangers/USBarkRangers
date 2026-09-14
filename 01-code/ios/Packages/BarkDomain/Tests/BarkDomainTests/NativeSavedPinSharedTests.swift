import Foundation
import Testing

@testable import BarkDomain

struct NativeSavedPinSharedTests {
    struct Example: Decodable {
        let field: String
        let text: String?
        let number: Double?
        let `repeat`: Int?
        let valid: Bool
    }
    @Test func sharedSavedPinFieldsUseTheShippingValidator() throws {
        let url = try #require(Bundle.module.url(forResource: "native-savedpins-v1", withExtension: "json"))
        let cases = try JSONDecoder().decode([Example].self, from: Data(contentsOf: url))
        for example in cases {
            let place = NativeSavedPin.Place(
                identity: .custom("fixture"), name: "Place",
                coordinate: try #require(Coordinate(latitude: 41, longitude: -81)), state: "Ohio",
                subtitle: "",
                stopID: "stop-a", savedAtMs: 1_800_000_000_000)
            var object = try #require(
                JSONSerialization.jsonObject(
                    with: JSONEncoder().encode(
                        NativeSavedPinEdit(saved: true, place: place))) as? [String: Any])
            var value = try #require(object["place"] as? [String: Any])
            let text = String(repeating: example.text ?? "", count: example.repeat ?? 1)
            if example.field == "pinID" {
                object["pinID"] = text
            } else if example.field == "latitude" {
                value["coordinate"] = ["latitude": example.number!, "longitude": -81]
            } else {
                value[example.field] = example.number.map { $0 as Any } ?? text
            }
            object["place"] = value
            let bytes = try JSONSerialization.data(withJSONObject: object)
            var accepted = false
            do {
                try JSONDecoder().decode(NativeSavedPinEdit.self, from: bytes).validate()
                accepted = true
            } catch { accepted = false }
            #expect(accepted == example.valid, "Saved pin shared field: \(example.field)")
        }
    }
}
