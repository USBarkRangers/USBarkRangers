import BarkDomain
import Foundation
import Observation

/// Read-only details and a single explicit directions action. Visits/trips arrive with their repositories.
@MainActor @Observable
final class ParkDetailModel {
    private(set) var park: Park?
    private(set) var isOpeningMaps = false
    var message: String?
    private let catalog: CatalogRepository
    private let maps: MapsHandoff
    private var requestID = UUID()
    init(catalog: CatalogRepository, maps: MapsHandoff) {
        self.catalog = catalog
        self.maps = maps
    }
    func load(id: ParkID) async {
        let request = UUID()
        requestID = request
        let state = await catalog.current()
        guard request == requestID else { return }
        park = state.snapshot?.park(id: id)
        message = nil
    }
    func navigate() async {
        guard let park, !isOpeningMaps else { return }
        isOpeningMaps = true
        defer { isOpeningMaps = false }
        if !(await maps.openPark(park)) { message = "Apple Maps could not be opened. Please try again." }
    }
    func cancel() { requestID = UUID() }
}
