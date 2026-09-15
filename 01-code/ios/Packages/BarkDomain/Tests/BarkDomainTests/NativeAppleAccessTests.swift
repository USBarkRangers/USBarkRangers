import Foundation
import Testing

@testable import BarkDomain

struct NativeAppleAccessTests {
    struct Fixture: Decodable {
        let version: Int
        let cases: [Case]
        struct Case: Decodable {
            let id: String
            let source: NativeEntitlement.Source
            let premium: Bool
            let daysAfterExpiry: Double
            let edit: Bool
            let upload: Bool
        }
    }
    @Test func appleAccessUsesSharedExplicitOfflineBoundaries() throws {
        let url = try #require(
            Bundle.module.url(forResource: "native-apple-access-v1", withExtension: "json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        #expect(fixture.version == 1)
        let expiry: Int64 = 1_800_000_000_000
        for example in fixture.cases {
            let access = NativeEntitlement(
                revision: 1, premium: example.premium,
                source: example.source, validUntilMs: expiry)
            let date = Date(timeIntervalSince1970: Double(expiry) / 1000 + example.daysAfterExpiry * 86_400)
            #expect(access.permitsEditing(at: date) == example.edit, "\(example.id)")
        }
    }
}
