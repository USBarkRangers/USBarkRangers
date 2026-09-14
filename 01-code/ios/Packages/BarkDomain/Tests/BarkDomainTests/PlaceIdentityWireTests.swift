import Foundation
import Testing
@testable import BarkDomain

struct PlaceIdentityWireTests {
    @Test func backendAndIOSShareTheSameWireShapeAndUTF8Identity() throws {
        let cases: [(String, PlaceIdentity, String)] = [
            (#"{"kind":"official","id":"park"}"#, .official(.init(rawValue: "park")),
                "9741857968ed95edb0a54f577d235ce88d50e16080f7de6e86912dd2092d6639"),
            (#"{"kind":"provider","provider":"apple","id":"place-🐾-é"}"#,
                .provider(name: "apple", id: "place-🐾-é"),
                "6fdb54e81f8101ce746c8b55ff00868013aaadb38740ca3c2f546ea5acb5c6ea"),
            (#"{"kind":"custom","id":"pin-a"}"#, .custom("pin-a"),
                "5ab73a136a0c8c6bbe2b53fc2d279b74f6275aa5d05bdab21b6739527c329b95"),
        ]
        for (json, expected, hash) in cases {
            let decoded = try JSONDecoder().decode(PlaceIdentity.self, from: Data(json.utf8))
            #expect(decoded == expected && decoded.storageID == hash)
            let encoded = try JSONEncoder().encode(decoded)
            let actual = try #require(JSONSerialization.jsonObject(with: encoded) as? NSDictionary)
            let wire = try #require(JSONSerialization.jsonObject(with: Data(json.utf8)) as? NSDictionary)
            #expect(actual == wire)
        }
    }

    @Test func invalidIdentitiesFailBeforePersistence() throws {
        for json in [#"{"kind":"custom","id":""}"#, #"{"kind":"custom","id":42}"#,
            #"{"kind":"provider","id":"x"}"#, #"{"kind":"official","id":"x","provider":"apple"}"#,
            #"{"kind":"unknown","id":"x"}"#, #"{"kind":"custom","id":"\u0000bad"}"#] {
            #expect(throws: DecodingError.self) {
                try JSONDecoder().decode(PlaceIdentity.self, from: Data(json.utf8))
            }
        }
        #expect(throws: EncodingError.self) { try JSONEncoder().encode(PlaceIdentity.custom("")) }
        #expect(PlaceIdentity.custom("👩‍👩‍👧").isValid)
        #expect(!PlaceIdentity.custom(String(repeating: "🐾", count: 257)).isValid)
    }
}
