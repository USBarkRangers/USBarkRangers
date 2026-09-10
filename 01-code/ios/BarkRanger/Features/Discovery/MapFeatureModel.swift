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
    private(set) var result = ParkFilter.Result(matchingIDs: [], totalCount: 0, labels: [])
    private(set) var parks: [Park] = []
    private(set) var selectedID: ParkID?
    private(set) var cameraRequest: CameraRequest?
    private(set) var isOffline = false
    private(set) var imageryUnavailable = false
    private(set) var isLocating = false
    var locationMessage: String?
    let settings: SettingsRepository
    let search: SearchModel
    let detail: ParkDetailModel
    private let catalog: CatalogRepository
    private let location: LocationClient
    private var observation: Task<Void, Never>?
    private var preferenceGeneration = UUID()
    private(set) var lastRegion: MKCoordinateRegion?
    private var locateTask: Task<Void, Never>?
    private var byID: [ParkID: Park] = [:]
    var query: ParkFilter.Query { settings.value.filters }
    var usesOfflineMap: Bool { isOffline || imageryUnavailable || settings.value.mapStyle == .overview }

    init(
        catalog: CatalogRepository, settings: SettingsRepository, location: LocationClient, maps: MapsHandoff
    ) {
        self.catalog = catalog
        self.settings = settings
        self.location = location
        search = SearchModel()
        detail = ParkDetailModel(catalog: catalog, maps: maps)
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
                    byID = Dictionary(uniqueKeysWithValues: snapshot.parks.map { ($0.id, $0) })
                    if let selectedID {
                        self.selectedID = snapshot.resolveAlias(selectedID)
                        await detail.load(id: selectedID)
                    }
                    search.install(snapshot: snapshot, index: state.index)
                    rebuild()
                }
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
                self.rebuild()
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
        rebuild()
    }
    func rebuild() {
        guard let snapshot = catalogState.snapshot else { return }
        search.updateQuery(query.search)
        let ids = search.matchingIDs
        result = ParkFilter.apply(catalog: snapshot, query: query, searchIDs: ids)
        parks = result.matchingIDs.compactMap { byID[$0] }
    }
    func selectPark(id: ParkID) {
        guard let park = catalogState.snapshot?.park(id: id) else { return }
        selectedID = park.id
        cameraRequest = CameraRequest(
            region: MKCoordinateRegion(
                center: CLLocationCoordinate2D(
                    latitude: park.coordinate.latitude, longitude: park.coordinate.longitude),
                span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)))
        Task { await detail.load(id: park.id) }
    }
    func dismissPark() { selectedID = nil }
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
        locateTask?.cancel()
        locateTask = nil
        detail.cancel()
    }
}
