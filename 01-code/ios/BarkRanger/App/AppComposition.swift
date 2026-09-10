import Foundation

/// The single construction point. Catalog startup is independent of any future account scope.
@MainActor
struct AppComposition {
    let router: AppRouter
    let startup: StartupModel
    let lifecycle: AppLifecycle
    let discovery: MapFeatureModel
    let settings: SettingsModel

    static func makeLive() -> AppComposition { assemble(diagnostics: Diagnostics(), preview: false) }
    static func makePreview() -> AppComposition {
        assemble(diagnostics: Diagnostics(enabled: false), preview: true)
    }

    private static func assemble(diagnostics: Diagnostics, preview: Bool) -> AppComposition {
        let network = NetworkMonitor()
        let resources = Bundle.main.resourceURL ?? Bundle.main.bundleURL
        let support = URL.applicationSupportDirectory.appendingPathComponent("BarkCatalog", isDirectory: true)
        let disk = CatalogDiskStore(directory: support, bundleDirectory: resources)
        var endpoint = Bundle.main.object(forInfoDictionaryKey: "BarkCatalogManifestURL") as? String ?? ""
        #if DEBUG
            endpoint = ProcessInfo.processInfo.environment["BARK_CATALOG_URL"] ?? endpoint
        #endif
        let client =
            !preview
            ? URL(string: endpoint).flatMap {
                CatalogHTTPClient.allowedEndpoint($0) ? CatalogHTTPClient(manifestURL: $0) : nil
            } : nil
        let catalog = CatalogRepository(disk: disk, client: client, diagnostics: diagnostics)
        var defaults = preview ? (UserDefaults(suiteName: "bark.preview.\(UUID())") ?? .standard) : .standard
        #if DEBUG
            // XCTest gives each UI test a separate non-private preferences suite; relaunches reuse it.
            if let testScope = ProcessInfo.processInfo.environment["BARK_TEST_PREFERENCES_SUITE"],
                UUID(uuidString: testScope) != nil
            {
                defaults = UserDefaults(suiteName: "bark.ui-test.\(testScope)") ?? .standard
            }
        #endif
        let preferences = SettingsRepository(defaults: defaults)
        let discovery = MapFeatureModel(
            catalog: catalog, settings: preferences, location: LocationClient(), maps: MapsHandoff())
        let settings = SettingsModel(preferences: preferences, catalog: catalog)
        let startup = StartupModel(
            catalog: catalog, network: network, diagnostics: diagnostics, state: preview ? .ready : .loading)
        return AppComposition(
            router: AppRouter(diagnostics: diagnostics), startup: startup,
            lifecycle: AppLifecycle(
                startup: startup, catalog: catalog, network: network, discovery: discovery,
                settings: settings, diagnostics: diagnostics),
            discovery: discovery, settings: settings)
    }
}
