#if DEBUG
    import Foundation

    /// Debug-only test/preview storage and inert external actions. Never assembles live providers.
    @MainActor
    struct AppSandbox {
        let scope: UUID
        var suite: String { "bark.sandbox.\(scope.uuidString)" }
        var directory: URL {
            URL.cachesDirectory.appendingPathComponent("BarkSandboxes/\(scope.uuidString)", isDirectory: true)
        }
        var disk: CatalogDiskStore {
            CatalogDiskStore(
                directory: directory, bundleDirectory: Bundle.main.resourceURL ?? Bundle.main.bundleURL)
        }

        init(scope: UUID = UUID()) { self.scope = scope }

        func makeComposition(manifestURL: URL? = nil, preview: Bool = false) -> AppComposition {
            let client = manifestURL.flatMap { url -> CatalogHTTPClient? in
                guard ["localhost", "127.0.0.1", "::1"].contains(url.host ?? ""),
                    CatalogHTTPClient.allowedEndpoint(url)
                else { return nil }
                return CatalogHTTPClient(manifestURL: url)
            }
            let diagnostics = Diagnostics(enabled: false)
            let catalog = CatalogRepository(disk: disk, client: client, diagnostics: diagnostics)
            // A failed suite remains in memory; there is deliberately no standard-defaults fallback.
            let preferences = SettingsRepository(defaults: preview ? nil : UserDefaults(suiteName: suite))
            return AppComposition.assemble(
                catalog: catalog, network: NetworkMonitor(fixedConnection: client != nil),
                location: LocationClient(manager: nil), maps: MapsHandoff(open: { _ in false }),
                settings: SettingsModel(preferences: preferences, catalog: catalog, openSettings: {}),
                diagnostics: diagnostics, initialState: preview ? .ready : .loading)
        }

        /// Call only after awaiting lifecycle shutdown. Other scopes and normal app storage are untouched.
        func removeArtifacts() throws {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            if FileManager.default.fileExists(atPath: directory.path) {
                try FileManager.default.removeItem(at: directory)
            }
        }
    }
#endif
