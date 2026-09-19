import BarkDomain
import Foundation
import MapKit
import Observation

/// Projects one catalog/filter result into pins and the accessible list; owns selection and locate actions.
@MainActor @Observable
final class MapFeatureModel: AccountScoped {
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
    var selectionID: String? { detail.selection?.id }
    let savedPlaces: SavedPlacesModel?
    let placeSearch: MapPlaceSearchModel
    private(set) var searchFocusRequest: UUID?
    var canSearchPlaces: Bool { routeDay?.premium == true }
    private(set) var cameraRequest: CameraRequest?
    private(set) var isOffline = false
    private(set) var isLocating = false
    var locationMessage: String?
    let settings: SettingsRepository
    let detail: ParkDetailModel
    let personal: PersonalParkProjection?
    let routeDay: RouteDaySheetViewModel?
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
    // Tile requests can fail during zoom/pan; only connectivity or a user choice selects overview.
    var usesOfflineMap: Bool { isOffline || settings.value.mapStyle == .overview }

    init(
        catalog: CatalogRepository, settings: SettingsRepository, location: LocationClient, maps: MapsHandoff,
        computeResults: @escaping ParkResults.Compute = ParkResults.compute,
        account: AccountSession? = nil, personal: PersonalParkProjection? = nil,
        routeDay: RouteDaySheetViewModel? = nil, placeSearch: MapSearchClient = .unavailable,
        savedPlaces: SavedPlacesModel? = nil
    ) {
        self.savedPlaces = savedPlaces
        self.routeDay = routeDay
        self.placeSearch = MapPlaceSearchModel(client: placeSearch)
        self.catalog = catalog
        self.settings = settings
        self.location = location
        self.computeResults = computeResults
        let projection =
            personal
            ?? account.map {
                PersonalParkProjection(account: $0, activeDraft: routeDay.map { day in { day.draft } })
            }
        self.personal = projection
        detail = ParkDetailModel(
            maps: maps, account: account, catalog: catalog, location: location,
            visitedIDs: { projection?.value.visited ?? [] })
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
        savedPlaces?.load()
        personal?.start()
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
            _ = personal?.value
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
        settings.update(preferences)
    }
    private func refreshResults() {
        guard let snapshot = catalogState.snapshot else { return }
        let values = personal?.value ?? .init()
        let effective = PersonalParkProjection.Value(
            visited: [.visited, .unvisited].contains(query.personal) ? values.visited : [],
            trip: values.trip)
        let input = ParkResults.Input(revision: snapshot.revision, query: query, personal: effective)
        guard requestedInput != input else { return }
        requestedInput = input
        resultTask?.cancel()
        let index = catalogState.index
        resultTask = Task {
            guard !Task.isCancelled else { return }
            do {
                let next = try await computeResults(snapshot, index, input.query, input.personal)
                let current = personal?.value ?? .init()
                let effective = PersonalParkProjection.Value(
                    visited: [.visited, .unvisited].contains(query.personal) ? current.visited : [],
                    trip: current.trip)
                guard !Task.isCancelled, input.personal == effective, input == requestedInput,
                    input.query == query,
                    input.revision == catalogState.snapshot?.revision
                else { return }
                if projection?.input.revision != input.revision
                    || projection?.matchingIDs != next.matchingIDs
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
    func selectPlace(_ place: MapSearchClient.Place, focusOnMap: Bool = true) {
        let bookmark = savedPlaces?.saved(place.stop)
        var stop = bookmark?.stop ?? place.stop
        if let trip = routeDay?.draft?.trip,
            let member = TripStopPolicy.membership(
                of: stop, in: trip, preferredDayID: routeDay?.target?.dayID)
        {
            switch member.destination {
            case .day: stop = trip.days[member.dayIndex].stops.first { $0.id == member.stopID } ?? stop
            case .start: stop = trip.start ?? stop
            case .end: stop = trip.end ?? stop
            }
        }
        detail.showPlace(stop, subtitle: bookmark?.subtitle ?? place.subtitle)
        if focusOnMap, let point = place.stop.coordinate {
            cameraRequest = CameraRequest(
                region: MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude),
                    span: MKCoordinateSpan(latitudeDelta: 0.04, longitudeDelta: 0.04)))
        }
    }
    func beginAdding(_ request: StopSearchRequest, completed: @escaping () -> Void) {
        dismissPark()
        routeDay?.beginAdding(request) {
            self.searchFocusRequest = UUID()
            completed()
        }
    }
    /// Add Stop requests focus once. Returning to Map must not replay an already handled request.
    func consumeSearchFocusRequest() -> Bool {
        guard searchFocusRequest != nil else { return false }
        searchFocusRequest = nil
        return true
    }
    func dismissPark() { detail.show(nil) }
    func resetScope() {
        routeDay?.stop()
        cancelPlaceSelection()
    }
    func cancelPlaceSelection() {
        dismissPark()
        placeSearch.cancel()
        routeDay?.editor.cancelInsertion()
    }
    func selectRouteDay(_ target: TripDayID) {
        dismissPark()
        routeDay?.select(target)
    }
    /// Explicit chip navigation replaces the park presentation, without changing the map camera.
    func openTrip(_ tripID: String) {
        dismissPark()
        routeDay?.open(tripID: tripID)
    }
    /// Planner sends only stable identity after its checkpoint. Map owns selection, framing and routing.
    func previewTripDay(_ target: TripDayID) {
        dismissPark()
        routeDay?.open(tripID: target.tripID, dayID: target.dayID) { [weak self] in
            guard let self, let day = routeDay, day.target == target, let trip = day.draft?.trip else {
                return
            }
            day.position = .medium
            let points = TripRoutePlan.build(trip).days.first { $0.id == target.dayID }?.points ?? []
            frameRoute(points.compactMap(\.coordinate))
        }
    }
    /// Explicit user intent only. Sheet heights never issue camera requests.
    func showTripRoute() {
        guard let trip = routeDay?.draft?.trip else { return }
        let points = (trip.days.flatMap(\.stops) + [trip.start, trip.end].compactMap { $0 })
            .compactMap(\.coordinate)
        frameRoute(points)
    }
    private func frameRoute(_ points: [Coordinate]) {
        guard !points.isEmpty else { return }
        let latitudes = points.map(\.latitude)
        let longitudes = points.map(\.longitude)
        guard let south = latitudes.min(), let north = latitudes.max(), let west = longitudes.min(),
            let east = longitudes.max()
        else { return }
        cameraRequest = CameraRequest(
            region: MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: (south + north) / 2, longitude: (west + east) / 2),
                span: MKCoordinateSpan(
                    latitudeDelta: max(0.05, (north - south) * 1.5),
                    longitudeDelta: min(360, max(0.05, (east - west) * 1.3)))))
    }
    func connectivityChanged(_ connected: Bool) {
        isOffline = !connected
        routeDay?.connectivityChanged(connected)
    }
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
        personal?.stop()
        routeDay?.stop()
        observation?.cancel()
        observation = nil
        resultTask?.cancel()
        resultTask = nil
        requestedInput = projection?.input
        detail.cancelActions()
        placeSearch.cancel()
        locateTask?.cancel()
    }
}
