import BarkDomain
import Foundation
import MapKit
import Testing

@testable import BarkRanger

@MainActor
struct SettingsTests {
    @Test func successiveEditsRelaunchAndResetKeepOneSanitizedValue() throws {
        let suite = "bark.settings-test.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(
            Data(#"{"units":"Kilometers","filters":{"search":"acadia"}}"#.utf8),
            forKey: "bark.deviceSettings.v1")
        let settings = SettingsRepository(defaults: defaults)
        #expect(settings.value.units == .kilometers && settings.value.filters.search == "acadia")
        var edited = settings.value
        edited.mapStyle = .satellite
        settings.update(edited)
        edited = settings.value
        edited.clustering = false
        edited.filters.swag = [.bandana]
        edited.camera = AppSettings.Camera(
            center: try #require(Coordinate(latitude: 44, longitude: -68)), latitudeDelta: 1,
            longitudeDelta: 1)
        settings.update(edited)
        #expect(SettingsRepository(defaults: defaults).value == edited)
        edited.rememberMapPosition = false
        settings.update(edited)
        #expect(settings.value.camera == nil)
        #expect(SettingsRepository(defaults: defaults).value == settings.value)
        settings.resetPreferences()
        #expect(settings.value == AppSettings())
        #expect(SettingsRepository(defaults: defaults).value == AppSettings())
    }

    @Test func mapLoadingErrorsCannotDeclareTheDeviceOffline() async throws {
        let probe = ControlledParkResults()
        let context = try DiscoveryTestContext(compute: probe.compute)
        defer { context.close() }
        try await context.start()
        let model = context.model
        model.connectivityChanged(true)
        model.selectPark(id: try #require(model.parks.first).id, focusOnMap: false)
        let selected = model.selectedID
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 760))
        let coordinator = MapCoordinator(model: model)
        let delegate: any MKMapViewDelegate = coordinator
        coordinator.apply(to: map, reduceMotion: true)
        let version = model.annotationVersion
        let camera = map.centerCoordinate
        let result = model.result
        let errors = [
            NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled),
            NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut),
            NSError(domain: MKErrorDomain, code: Int(MKError.loadingThrottled.rawValue)),
            NSError(domain: MKErrorDomain, code: Int(MKError.serverFailure.rawValue)),
        ]
        for error in errors {
            delegate.mapViewDidFailLoadingMap?(map, withError: error)
            coordinator.apply(to: map, reduceMotion: true)
            #expect(!model.isOffline && !model.usesOfflineMap)
            #expect(map.overlays.isEmpty)
            #expect(model.selectedID == selected && model.result == result)
            #expect(model.annotationVersion == version)
            #expect(map.centerCoordinate.latitude == camera.latitude)
            #expect(map.centerCoordinate.longitude == camera.longitude)
        }
        // Real connection changes still control fallback and recover the chosen appearance.
        model.connectivityChanged(false)
        coordinator.apply(to: map, reduceMotion: true)
        #expect(model.usesOfflineMap && !map.overlays.isEmpty)
        model.connectivityChanged(true)
        coordinator.apply(to: map, reduceMotion: true)
        #expect(!model.usesOfflineMap && map.overlays.isEmpty)
        #expect(await probe.inputs.count == 1)
    }

    @Test func appearanceAndConnectionChangesDoNotRecomputeParks() async throws {
        let probe = ControlledParkResults()
        let context = try DiscoveryTestContext(compute: probe.compute)
        defer { context.close() }
        try await context.start()
        let model = context.model
        model.selectPark(id: try #require(model.parks.first).id, focusOnMap: false)
        let selected = model.selectedID
        let map = MKMapView(frame: CGRect(x: 0, y: 0, width: 390, height: 760))
        let coordinator = MapCoordinator(model: model)
        var settings = context.settings.value
        settings.mapStyle = .satellite
        context.settings.update(settings)
        coordinator.apply(to: map, reduceMotion: true)
        #expect(map.mapType == .satellite && map.overlays.isEmpty)
        model.connectivityChanged(false)
        settings.mapStyle = .standard
        context.settings.update(settings)
        coordinator.apply(to: map, reduceMotion: true)
        #expect(model.usesOfflineMap && !map.overlays.isEmpty)
        model.connectivityChanged(true)
        coordinator.apply(to: map, reduceMotion: true)
        #expect(!model.usesOfflineMap && map.mapType == .standard && map.overlays.isEmpty)
        settings.mapStyle = .overview
        context.settings.update(settings)
        coordinator.apply(to: map, reduceMotion: true)
        #expect(model.usesOfflineMap && map.mapType == .standard)
        context.settings.resetPreferences()
        coordinator.apply(to: map, reduceMotion: true)
        #expect(map.mapType == .standard && map.overlays.isEmpty && model.selectedID == selected)
        // A real query change is the completion barrier for prior coalesced preference notifications.
        var query = model.query
        query.search = "acadia"
        model.setFilters(query)
        try await eventually { model.projection?.input.query == query }
        #expect(await probe.inputs.count == 2)
    }
}
