import BarkDomain
import Observation

/// Owns the current local query; the map applies all other filters to the same ranked ID result.
@MainActor @Observable
final class SearchModel {
    private(set) var query = ""
    private(set) var matchingIDs: [ParkID]?
    private var index: ParkSearchIndex?
    func install(snapshot: CatalogSnapshot, index: ParkSearchIndex?) {
        self.index = index ?? ParkSearchIndex(parks: snapshot.parks)
        updateQuery(query)
    }
    func updateQuery(_ text: String) {
        query = String(text.prefix(200))
        matchingIDs = query.isEmpty ? nil : index?.search(query)
    }
}
