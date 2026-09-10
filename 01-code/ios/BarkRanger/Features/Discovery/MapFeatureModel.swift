import BarkDomain
import Foundation
import MapKit
import Observation

/// Projects one catalog/filter result into pins and the accessible list; owns selection and locate actions.
@MainActor @Observable
final class MapFeatureModel {
    struct CameraRequest {
        let id = UUID()
        let region: MKCoordinateRegion
    }
    private(set) var catalogState = CatalogRepository.State()
    private(set) var projection: ParkResults?
    private(set) var annotationVersion: UInt64 = 0
    var result: ParkFilter.Result {
        projection?.result ?? ParkFilter.Result(matchingIDs: [], totalCount: 0, labels: [])
    }
    var parks: [Park] { projection?.parks ?? [] }
    var selectedID: ParkID? { detail.park?.id }
    private(set) var cameraRequest: CameraRequest?
    private(set) var isOffline = false
    private(set) var imageryUnavailable = false
    private(set) var isLocating = false
    var locationMessage: String?
    let settings: SettingsRepository
    let detail: ParkDetailModel
    private let catalog: CatalogRepository
    private let location: LocationClient
    private var observation: Task<Void, Never>?
    private var preferenceGeneration = UUID()
    private(set) var lastRegion: MKCoordinateRegion?
    private var locateTask: Task<Void, Never>?
    private let computeResults: ParkResults.Compute
    @ObservationIgnored private(set) var resultTask: Task<Void, Never>?
    private var requestedInput: ParkResults.Input?
    var query: ParkFilter.Query { settings.value.filters }
    var usesOfflineMap: Bool { isOffline || imageryUnavailable || settings.value.mapStyle == .overview }

    init(
        catalog: CatalogRepository, settings: SettingsRepository, location: LocationClient, maps: MapsHandoff,
        computeResults: @escaping ParkResults.Compute = ParkResults.compute
    ) {
        self.catalog = catalog
        self.settings = settings
        self.location = location
        self.computeResults = computeResults
        detail = ParkDetailModel(maps: maps)
        if let camera = settings.value.camera, settings.value.rememberMapPosition {
            cameraRequest = CameraRequest(
                region: MKCoordinateRegion(
                    center: CLLocationCoordinate2D(
                        latitude: camera.center.latitude, longitude: camera.center.longitude),
                    span: MKCoordinateSpan(
                        latitudeDelta: camera.latitudeDelta, longitudeDelta: camera.longitudeDelta)))
        }
    }
    func start() {
        guard observation == nil else { return }
        observePreferences()
        observation = Task {
            for await state in await catalog.updates() {
                guard !Task.isCancelled else { return }
                let changed = catalogState.snapshot?.revision != state.snapshot?.revision
                catalogState = state
                if changed, let snapshot = state.snapshot {
                    if let selectedID {
                        detail.show(snapshot.park(id: selectedID))
                    }
                }
                refreshResults()
            }
        }
    }
    /// Device settings can change from another tab while the map view is not mounted.
    private func observePreferences() {
        let generation = preferenceGeneration
        withObservationTracking {
            _ = settings.value.filters
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.preferenceGeneration == generation, self.observation != nil else {
                    return
                }
                self.refreshResults()
                self.observePreferences()
            }
        }
    }
    func setFilters(_ query: ParkFilter.Query) {
        var preferences = settings.value
        preferences.filters = query
        // Personal state is not connected until phase 4; the pure policy already accepts those ID sets.
        preferences.filters.personal = .all
        settings.update(preferences)
    }
    private func refreshResults() {
        guard let snapshot = catalogState.snapshot else { return }
        let input = ParkResults.Input(revision: snapshot.revision, query: query)
        guard requestedInput != input else { return }
        requestedInput = input
        resultTask?.cancel()
        let index = catalogState.index
        resultTask = Task {
            guard !Task.isCancelled else { return }
            do {
                let next = try await computeResults(snapshot, index, input.query)
                guard !Task.isCancelled, input == requestedInput, input.query == query,
                    input.revision == catalogState.snapshot?.revision
                else { return }
                if projection?.input.revision != input.revision
                    || result.matchingIDs != next.result.matchingIDs
                {
                    annotationVersion &+= 1
                }
                projection = next
                resultTask = nil
            } catch {
                // Only the still-current request may clear its ownership; cancelled work cannot publish.
                if !Task.isCancelled {
                    requestedInput = projection?.input
                    resultTask = nil
                }
            }
        }
    }
    func selectPark(id: ParkID, focusOnMap: Bool = true) {
        guard let park = catalogState.snapshot?.park(id: id) else { return }
        detail.show(park)
        guard focusOnMap else { return }
        cameraRequest = CameraRequest(
            region: MKCoordinateRegion(
                center: CLLocationCoordinate2D(
                    latitude: park.coordinate.latitude, longitude: park.coordinate.longitude),
                span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)))
    }
    func dismissPark() { detail.show(nil) }
    func connectivityChanged(_ connected: Bool) {
        isOffline = !connected
        if connected { imageryUnavailable = false }
    }
    func imageryFailed() { imageryUnavailable = true }
    func locateMe() {
        guard locateTask == nil else { return }
        isLocating = true
        locationMessage = nil
        locateTask = Task {
            defer {
                isLocating = false
                locateTask = nil
            }
            do {
                let coordinate = try await location.currentFix()
                guard !Task.isCancelled else { return }
                cameraRequest = CameraRequest(
                    region: MKCoordinateRegion(
                        center: CLLocationCoordinate2D(
                            latitude: coordinate.latitude, longitude: coordinate.longitude),
                        span: MKCoordinateSpan(latitudeDelta: 0.2, longitudeDelta: 0.2)))
            } catch {
                guard !Task.isCancelled else { return }
                locationMessage =
                    location.authorization() == .denied || location.authorization() == .restricted
                    ? "Location access is off. You can enable it in iPhone Settings or keep exploring by search."
                    : "A current location was not available. Please try again."
            }
        }
    }
    func cameraChanged(_ region: MKCoordinateRegion) {
        lastRegion = region
        guard settings.value.rememberMapPosition,
            let center = Coordinate(latitude: region.center.latitude, longitude: region.center.longitude),
            let camera = AppSettings.Camera(
                center: center, latitudeDelta: region.span.latitudeDelta,
                longitudeDelta: region.span.longitudeDelta)
        else { return }
        var preferences = settings.value
        preferences.camera = camera
        settings.update(preferences)
    }
    func stop() {
        preferenceGeneration = UUID()
        observation?.cancel()
        observation = nil
        resultTask?.cancel()
        resultTask = nil
        requestedInput = projection?.input
        detail.cancelNavigation()
        locateTask?.cancel()
    }
}
