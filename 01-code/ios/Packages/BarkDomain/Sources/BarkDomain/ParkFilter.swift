import Foundation

/// One predicate produces both list/pin IDs and the count. Empty category/swag sets mean all.
public enum ParkFilter {
    public enum Personal: String, Codable, CaseIterable, Sendable { case all, visited, unvisited, trip }
    public struct Query: Codable, Equatable, Sendable {
        public var search = ""
        public var categories: Set<ParkCategory> = []
        public var swag: Set<Swag> = []
        public var personal: Personal = .all
        public init() {}
        private enum CodingKeys: String, CodingKey { case search, categories, swag, personal }
        public init(from decoder: any Decoder) throws {
            self.init()
            let values = try decoder.container(keyedBy: CodingKeys.self)
            search = (try? values.decode(String.self, forKey: .search)) ?? search
            categories = (try? values.decode(Set<ParkCategory>.self, forKey: .categories)) ?? categories
            swag = (try? values.decode(Set<Swag>.self, forKey: .swag)) ?? swag
            personal = (try? values.decode(Personal.self, forKey: .personal)) ?? personal
        }
        public var isActive: Bool {
            !search.isEmpty || !categories.isEmpty || !swag.isEmpty || personal != .all
        }
    }
    public struct Result: Equatable, Sendable {
        public let matchingIDs: [ParkID]
        public let totalCount: Int
        public let labels: [String]
        public init(matchingIDs: [ParkID], totalCount: Int, labels: [String]) {
            self.matchingIDs = matchingIDs
            self.totalCount = totalCount
            self.labels = labels
        }
        public var matchingCount: Int { matchingIDs.count }
    }
    public static func reset() -> Query { Query() }
    public static func apply(
        catalog: CatalogSnapshot, visitedParkIDs: Set<ParkID> = [], tripParkIDs: Set<ParkID> = [],
        query: Query, searchIDs: [ParkID]? = nil
    ) -> Result {
        let rankedIDs =
            searchIDs
            ?? (query.search.isEmpty ? nil : ParkSearchIndex(parks: catalog.parks).search(query.search))
        let searchSet = rankedIDs.map(Set.init)
        let active = catalog.parks.filter { !$0.isRetired }
        let matches = active.filter { park in
            (searchSet?.contains(park.id) ?? true)
                && (query.categories.isEmpty || query.categories.contains(park.category))
                && (query.swag.isEmpty || query.swag.contains(park.swag))
                && {
                    switch query.personal {
                    case .all: true
                    case .visited: visitedParkIDs.contains(park.id)
                    case .unvisited: !visitedParkIDs.contains(park.id)
                    case .trip: tripParkIDs.contains(park.id)
                    }
                }()
        }
        let ranks = Dictionary(uniqueKeysWithValues: (rankedIDs ?? []).enumerated().map { ($1, $0) })
        let ordered = matches.sorted { lhs, rhs in
            let left = ranks[lhs.id] ?? 0
            let right = ranks[rhs.id] ?? 0
            if left != right { return left < right }
            if lhs.name != rhs.name {
                return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
            }
            return lhs.id.rawValue < rhs.id.rawValue
        }
        var labels = query.categories.map(\.rawValue).sorted() + query.swag.map(\.rawValue).sorted()
        if !query.search.isEmpty { labels.insert(query.search, at: 0) }
        if query.personal != .all { labels.append(query.personal.rawValue.capitalized) }
        return Result(matchingIDs: ordered.map(\.id), totalCount: active.count, labels: labels)
    }
}
