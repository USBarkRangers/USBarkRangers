import BarkDomain
import Foundation
import Observation

/// Read-only details and a single explicit directions action. Visits/trips arrive with their repositories.
@MainActor @Observable
final class ParkDetailModel {
    private(set) var park: Park?
    private(set) var isOpeningMaps = false
    var message: String?
    private let maps: MapsHandoff
    init(maps: MapsHandoff) {
        self.maps = maps
    }
    /// Selection already has validated catalog data; publish its identity and actions together.
    func show(_ park: Park?) {
        self.park = park
        message = nil
    }
    func navigate() async {
        guard let park, !isOpeningMaps else { return }
        isOpeningMaps = true
        defer { isOpeningMaps = false }
        let opened = await maps.openPark(park)
        if !opened, self.park?.id == park.id {
            message = "Apple Maps could not be opened. Please try again."
        }
    }
}
