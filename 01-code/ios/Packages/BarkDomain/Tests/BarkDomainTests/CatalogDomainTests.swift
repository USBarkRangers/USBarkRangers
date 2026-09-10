import Foundation
import Testing

@testable import BarkDomain

struct CatalogDomainTests {
    private func catalog() throws -> CatalogSnapshot {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent(
            "../../../../BarkRanger/Resources/catalog.json")
        return try JSONDecoder().decode(CatalogSnapshot.self, from: Data(contentsOf: url))
    }
    @Test func allApprovedRecordsAndCompleteDetailFieldsDecode() throws {
        let catalog = try catalog()
        #expect(catalog.parks.count == 393)
        #expect(Set(catalog.parks.map(\.id)).count == 393)
        #expect(
            catalog.parks.contains {
                !$0.entranceFees.isEmpty && !$0.approvedTrails.isEmpty && !$0.hazards.isEmpty
            })
        #expect(catalog.parks.contains { $0.stateCodes.contains("GU") })
        #expect(catalog.parks.allSatisfy { catalog.resolveAlias($0.id) == $0.id })
    }
    @Test func filtersUseMatchingRecordsAndNeverCountViewportClusters() throws {
        let catalog = try catalog()
        let all = ParkFilter.apply(catalog: catalog, query: .init())
        #expect(all.totalCount == 393 && all.matchingCount == 393)
        var query = ParkFilter.Query()
        query.categories = [.national]
        query.swag = [.tag]
        let result = ParkFilter.apply(catalog: catalog, query: query)
        #expect(
            result.matchingCount == catalog.parks.filter { $0.category == .national && $0.swag == .tag }.count
        )
        #expect(result.totalCount == 393)
        query.search = "There is no such fictional park"
        #expect(ParkFilter.apply(catalog: catalog, query: query).matchingCount == 0)
    }
    @Test func visitedAndTripInputsPreserveExistingFilterSemantics() throws {
        let catalog = try catalog()
        let park = try #require(catalog.parks.first)
        var query = ParkFilter.Query()
        query.personal = .visited
        #expect(
            ParkFilter.apply(catalog: catalog, visitedParkIDs: [park.id], query: query).matchingIDs == [
                park.id
            ])
        query.personal = .unvisited
        #expect(
            ParkFilter.apply(catalog: catalog, visitedParkIDs: [park.id], query: query).matchingCount == 392)
        query.personal = .trip
        #expect(
            ParkFilter.apply(catalog: catalog, tripParkIDs: [park.id], query: query).matchingIDs == [park.id])
    }
    @Test func searchHandlesAbbreviationsDiacriticsTyposTerritoriesAndLimits() throws {
        let catalog = try catalog()
        let index = ParkSearchIndex(parks: catalog.parks)
        #expect(ParkSearchIndex.normalize("St. Élie NP") == "saint elie national park")
        #expect(!index.search("acadia np").isEmpty)
        #expect(!index.search("acadi").isEmpty)
        #expect(!index.search("acdia").isEmpty)
        #expect(!index.search("guam").isEmpty)
        #expect(index.search("park", limit: 2).count == 2)
        #expect(index.search("park", limit: -1).isEmpty)
        #expect(index.search("zzzzzzzzzzzzz").isEmpty)
    }
    @Test func syntheticFiveThousandAndAntimeridianStaySearchable() throws {
        let parks = try (0..<5000).map { index in
            Park(
                id: ParkID(rawValue: "\(index)"), siteID: SiteID(rawValue: "site-\(index)"),
                name: "Synthetic Park \(index)",
                coordinate: try #require(Coordinate(latitude: 0, longitude: index % 2 == 0 ? 179.9 : -179.9)))
        }
        let index = ParkSearchIndex(parks: parks)
        #expect(index.search("Synthetic Park 4999").first == ParkID(rawValue: "4999"))
        #expect(index.search("Synthetic").count == 5000)
    }
    @Test func preferenceRoundTripAndInvalidCameraSanitization() throws {
        var settings = AppSettings()
        settings.mapStyle = .overview
        settings.filters.swag = [.bandana]
        let encoded = try JSONEncoder().encode(settings)
        #expect(try JSONDecoder().decode(AppSettings.self, from: encoded) == settings)
        let coordinate = try #require(Coordinate(latitude: 0, longitude: 180))
        #expect(AppSettings.Camera(center: coordinate, latitudeDelta: .infinity, longitudeDelta: 20) == nil)
    }
}
