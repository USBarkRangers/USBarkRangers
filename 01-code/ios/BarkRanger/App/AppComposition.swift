import Foundation
import UIKit

/// The single construction point. Catalog startup is independent of the account scope.
@MainActor
struct AppComposition {
    let router: AppRouter
    let startup: StartupModel
    let lifecycle: AppLifecycle
    let discovery: MapFeatureModel
    let settings: SettingsModel
    let account: AccountModel

    static func makeApp() -> AppComposition {
        #if DEBUG
            let environment = ProcessInfo.processInfo.environment
            if let scope = environment["BARK_TEST_SCOPE"] {
                // Even malformed test configuration stays isolated; it never falls through to live.
                return AppSandbox(scope: UUID(uuidString: scope) ?? UUID()).makeComposition(
                    manifestURL: environment["BARK_CATALOG_URL"].flatMap(URL.init(string:)),
                    accountEmulators: environment["BARK_ACCOUNT_EMULATORS"] == "1")
            }
            if environment["BARK_ISOLATED_APP"] == "1"
                || environment["XCTestConfigurationFilePath"] != nil
                || environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
            {
                return AppSandbox().makeComposition()
            }
        #endif
        return makeLive()
    }

    private static func makeLive() -> AppComposition {
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
        let accounts = AccountAssembly.live(
            directory: URL.applicationSupportDirectory.appendingPathComponent("BarkAccounts"))
        let settings = SettingsModel(
            preferences: SettingsRepository(defaults: .standard, account: accounts.session), catalog: catalog
        ) {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        }
        return assemble(
            catalog: catalog, network: NetworkMonitor(), location: LocationClient(), maps: MapsHandoff(),
            settings: settings, diagnostics: diagnostics, accounts: accounts)
    }

    static func assemble(
        catalog: CatalogRepository, network: NetworkMonitor, location: LocationClient, maps: MapsHandoff,
        settings: SettingsModel, diagnostics: Diagnostics, accounts: AccountAssembly? = nil,
        initialState: StartupModel.State = .loading
    ) -> AppComposition {
        let accounts =
            accounts
            ?? AccountAssembly.unavailable(
                directory: URL.cachesDirectory.appendingPathComponent("UnusedAccounts"))
        let account = AccountModel(session: accounts.session, google: accounts.google)
        let discovery = MapFeatureModel(
            catalog: catalog, settings: settings.preferences, location: location, maps: maps)
        let startup = StartupModel(
            catalog: catalog, network: network, diagnostics: diagnostics, state: initialState)
        return AppComposition(
            router: AppRouter(diagnostics: diagnostics), startup: startup,
            lifecycle: AppLifecycle(
                startup: startup, catalog: catalog, network: network, discovery: discovery,
                settings: settings, diagnostics: diagnostics, account: accounts.session),
            discovery: discovery, settings: settings, account: account)
    }
}
