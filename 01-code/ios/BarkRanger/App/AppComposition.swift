import BarkDomain
import Foundation
import UIKit

/// The single construction point. Catalog startup is independent of the account scope.
@MainActor
struct AppComposition {
    let catalog: CatalogRepository
    let router: AppRouter
    let startup: StartupModel
    let lifecycle: AppLifecycle
    let discovery: MapFeatureModel
    let settings: SettingsModel
    let account: AccountModel
    let trips: TripEditorModel
    let passport: PassportModel
    let expeditions: ExpeditionModel
    let mapExpedition: MapExpeditionOverlay
    let support: SupportDependencies

    static func makeApp() -> AppComposition {
        #if DEBUG
            let environment = ProcessInfo.processInfo.environment
            if let scope = environment["BARK_TEST_SCOPE"] {
                // Even malformed test configuration stays isolated; it never falls through to live.
                return AppSandbox(scope: UUID(uuidString: scope) ?? UUID()).makeComposition(
                    manifestURL: environment["BARK_CATALOG_URL"].flatMap(URL.init(string:)),
                    emulatorHost: environment["BARK_EMULATOR_HOST"] ?? "127.0.0.1",
                    nativeAccounts: environment["BARK_NATIVE_ACCOUNT_EMULATORS"] == "1")
            }
            if environment["BARK_ISOLATED_APP"] == "1"
                || environment["XCTestConfigurationFilePath"] != nil
                || environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
            {
                return AppSandbox().makeComposition()
            }
            if let host = Bundle.main.object(forInfoDictionaryKey: "BarkDeviceAccountHost") as? String,
                !host.isEmpty
            {
                // A stable, separate scope keeps test Keychain identity and personal files across relaunches.
                let directory = URL.applicationSupportDirectory.appendingPathComponent(
                    "BarkDeviceTestAccounts")
                guard let scope = UUID(uuidString: "7A21F490-FBA4-4C29-A7E0-9B0B7A4A0004") else {
                    return makeLive(accountOverride: .unavailable(directory: directory))
                }
                return makeLive(
                    accountOverride: .nativeEmulator(directory: directory, scope: scope, host: host))
            }
        #endif
        return makeLive()
    }

    private static func makeLive(accountOverride: AccountAssembly? = nil) -> AppComposition {
        let diagnostics = Diagnostics()
        let resources = Bundle.main.resourceURL ?? Bundle.main.bundleURL
        let support = URL.applicationSupportDirectory.appendingPathComponent("BarkCatalog", isDirectory: true)
        var endpoint = Bundle.main.object(forInfoDictionaryKey: "BarkCatalogManifestURL") as? String ?? ""
        #if DEBUG
            endpoint = ProcessInfo.processInfo.environment["BARK_CATALOG_URL"] ?? endpoint
        #endif
        let client = URL(string: endpoint).flatMap {
            CatalogHTTPClient.allowedEndpoint($0) ? CatalogHTTPClient(manifestURL: $0) : nil
        }
        let catalog = CatalogRepository(
            disk: CatalogDiskStore(directory: support, bundleDirectory: resources), client: client,
            diagnostics: diagnostics)
        let accounts =
            accountOverride
            ?? AccountAssembly.live(
                // Native bytes have their own environment/schema namespace; never reopen the
                // incompatible account-wide records during the replacement rollout.
                directory: URL.applicationSupportDirectory.appendingPathComponent(
                    "BarkNative-v1/bark-ranger-ios"))
        let settings = SettingsModel(
            preferences: SettingsRepository(defaults: .standard, account: accounts.session), catalog: catalog
        ) {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        }
        return assemble(
            catalog: catalog, network: NetworkMonitor(), location: LocationClient(), maps: MapsHandoff(),
            settings: settings, diagnostics: diagnostics, accounts: accounts, placeSearch: .live,
            savedPlaceStore: SavedPlaceStore(
                directory: URL.applicationSupportDirectory.appendingPathComponent("BarkSavedPlaces")))
    }

    static func assemble(
        catalog: CatalogRepository, network: NetworkMonitor, location: LocationClient, maps: MapsHandoff,
        settings: SettingsModel, diagnostics: Diagnostics, accounts: AccountAssembly? = nil,
        placeSearch: MapSearchClient = .unavailable, savedPlaceStore: SavedPlaceStore? = nil,
        initialState: StartupModel.State = .loading
    ) -> AppComposition {
        let accounts =
            accounts
            ?? AccountAssembly.unavailable(
                directory: URL.cachesDirectory.appendingPathComponent("UnusedAccounts"))
        // APPLE-ACTIVATION: inject the native membership service here when the native
        // account graph replaces this bridge. Inactive wiring sketch, not implemented APIs:
        // let membership = StoreKitMembershipService(products: approvedProductIDs,
        //     verification: accounts.purchaseVerification)
        // let account = AccountModel(..., membership: membership)
        // Product IDs must come from the owner's approved App Store Connect setup.
        // The scoped lifecycle must own/cancel transaction observation on account changes;
        // never make a StoreKit success boolean grant local or server Premium.
        let account = AccountModel(session: accounts.session, google: accounts.google)
        let routeCache = RouteGeometryStore(
            directory: accounts.session.directory.appendingPathComponent("RouteCache", isDirectory: true))
        let activeTrip = ActiveTripSession(
            account: accounts.session,
            routes: DayRouteService(service: RoutePreviewService(store: routeCache)))
        let routeDay = RouteDaySheetViewModel(
            activeTrip: activeTrip, maps: maps)
        let discovery = MapFeatureModel(
            catalog: catalog, settings: settings.preferences, location: location, maps: maps,
            account: accounts.session, routeDay: routeDay, placeSearch: placeSearch,
            savedPlaces: savedPlaceStore.map { SavedPlacesModel(store: $0, account: accounts.session) })
        let trips = TripEditorModel(
            activeTrip: activeTrip, catalog: catalog, maps: maps)
        let passport = PassportModel(
            account: accounts.session, catalog: catalog,
            leaderboard: LeaderboardModel(repository: accounts.leaderboard, account: accounts.session),
            nearby: NearbyStatesModel(
                locate: { try await location.currentFix() },
                mapCenter: { settings.preferences.value.camera?.center }))
        let recorder = WalkRecorder(
            account: accounts.session,
            store: RecordingStore(directory: accounts.session.directory),
            location: location, motion: PedometerClient(), activity: LiveActivityService())
        let accountProject = accounts.session.nativeProfileConfiguration?.project ?? "bark-ranger-ios"
        accounts.session.eraseAdditionalAccountData = { [weak recorder, weak discovery, weak activeTrip] uid in
            guard let recorder, let discovery, let activeTrip else { throw NativeStore.Failure.unavailable }
            await recorder.activateAccount() // Drains recording writes after identity has been cleared.
            try activeTrip.forgetDeletedAccount(scope: accountProject + ":" + uid)
            try await discovery.savedPlaces?.eraseClosedAccount(uid)
            try await routeCache.clearForAccountDeletion()
        }
        let expeditions = ExpeditionModel(
            account: accounts.session, recorder: recorder,
            geometry: TrailRepository(), health: HealthWorkoutImporter())
        let startup = StartupModel(
            catalog: catalog, network: network, diagnostics: diagnostics, state: initialState)
        return AppComposition(
            catalog: catalog, router: AppRouter(diagnostics: diagnostics), startup: startup,
            lifecycle: AppLifecycle(
                startup: startup, catalog: catalog, network: network, discovery: discovery,
                settings: settings, diagnostics: diagnostics, account: accounts.session, trips: activeTrip,
                recorder: recorder),
            discovery: discovery, settings: settings, account: account, trips: trips, passport: passport,
            expeditions: expeditions, mapExpedition: MapExpeditionOverlay(),
            support: SupportDependencies(
                account: accounts.session, service: accounts.feedback,
                store: FeedbackDraftStore(directory: accounts.session.directory)))
    }
}
