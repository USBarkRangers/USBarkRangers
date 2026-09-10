import Foundation
import Testing
@testable import BarkDomain

@Test(arguments: ["00042", "Acadia:site-2", "île / NORTH", " ID "])
func identityRoundTripsAsAnUnchangedJSONString(_ raw: String) throws {
    let bytes = try JSONEncoder().encode(raw)
    let parkID = try JSONDecoder().decode(ParkID.self, from: bytes)
    let siteID = try JSONDecoder().decode(SiteID.self, from: bytes)
    #expect(parkID.rawValue == raw)
    #expect(siteID.rawValue == raw)
    #expect(try JSONEncoder().encode(parkID) == bytes)
    #expect(try JSONEncoder().encode(siteID) == bytes)
}

@Test func identityDoesNotCoerceNumbersOrRegenerateIDs() throws {
    #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(ParkID.self, from: Data("42".utf8))
    }
    #expect(Set([ParkID(rawValue: "042"), ParkID(rawValue: "42")]).count == 2)
}

@Test func coordinateRejectsNonFiniteAndOutOfRangeValues() {
    for (latitude, longitude) in [(Double.nan, 0), (.infinity, 0), (0, -.infinity),
                                  (90.001, 0), (-90.001, 0), (0, 180.001), (0, -180.001)] {
        #expect(Coordinate(latitude: latitude, longitude: longitude) == nil)
    }
    #expect(Coordinate(latitude: -90, longitude: -180) != nil)
    #expect(Coordinate(latitude: 90, longitude: 180) != nil)
    #expect(Coordinate(latitude: 0, longitude: 0) != nil)
}
