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
    @ObservationIgnored private(set) var navigation: Task<Void, Never>?
    init(maps: MapsHandoff) {
        self.maps = maps
    }
    /// Selection already has validated catalog data; publish its identity and actions together.
    func show(_ park: Park?) {
        guard self.park != park else { return }
        cancelNavigation()
        self.park = park
        message = nil
    }
    /// Capture the displayed park synchronously, before scheduling the platform handoff.
    func navigate() {
        guard let park, navigation == nil else { return }
        isOpeningMaps = true
        message = nil
        navigation = Task {
            guard !Task.isCancelled else { return }
            let opened = await maps.openPark(park)
            guard !Task.isCancelled else { return }
            isOpeningMaps = false
            navigation = nil
            if !opened { message = "Apple Maps could not be opened. Please try again." }
        }
    }
    func cancelNavigation() {
        navigation?.cancel()
        navigation = nil
        isOpeningMaps = false
    }
}
