import SwiftUI

/// Owns foreground polling and connectivity observation. No timer survives the background transition.
@MainActor
final class AppLifecycle {
    private let startup: StartupModel
    private let catalog: CatalogRepository
    private let network: NetworkMonitor
    private let discovery: MapFeatureModel
    private let settings: SettingsModel
    private let diagnostics: Diagnostics
    private let account: AccountSession?
    private var connectivity: Task<Void, Never>?
    private var polling: Task<Void, Never>?
    private var catalogStop: Task<Void, Never>?
    private(set) var phase: ScenePhase?

    init(
        startup: StartupModel, catalog: CatalogRepository, network: NetworkMonitor,
        discovery: MapFeatureModel, settings: SettingsModel, diagnostics: Diagnostics,
        account: AccountSession? = nil
    ) {
        self.account = account
        self.startup = startup
        self.catalog = catalog
        self.network = network
        self.discovery = discovery
        self.settings = settings
        self.diagnostics = diagnostics
    }
    func sceneChanged(_ newPhase: ScenePhase) {
        guard phase != newPhase else { return }
        if newPhase == .background {
            stop()
            return
        }
        phase = newPhase
        guard newPhase == .active, polling == nil else { return }
        diagnostics.record(.enteredForeground)
        account?.setForeground(true)
        account?.connectivityChanged(network.isConnected == true)
        discovery.start()
        settings.load()
        let previousConnection = network.isConnected
        let changes = network.start()
        connectivity = Task {
            var wasConnected = previousConnection
            for await connected in changes {
                guard !Task.isCancelled else { return }
                account?.connectivityChanged(connected)
                discovery.connectivityChanged(connected)
                if connected && wasConnected == false { scheduleRefresh(reason: .reconnect) }
                if !connected { await catalog.noteOffline() }
                wasConnected = connected
            }
        }
        scheduleRefresh(reason: .foreground)
    }
    private func scheduleRefresh(reason: CatalogRepository.Reason) {
        polling?.cancel()
        let stopping = catalogStop
        polling = Task {
            // A foreground request cannot be cancelled by an older queued background stop.
            await stopping?.value
            guard !Task.isCancelled else { return }
            startup.start()
            if network.isConnected != false { await catalog.refresh(reason: reason) }
            while !Task.isCancelled {
                let delay =
                    network.isConnected == false ? Duration.seconds(60) : await catalog.nextRefreshDelay()
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                if network.isConnected != false { await catalog.refresh(reason: .regular) }
            }
        }
    }
    func stop() {
        guard phase != .background else { return }
        phase = .background
        diagnostics.record(.enteredBackground)
        connectivity?.cancel()
        connectivity = nil
        polling?.cancel()
        polling = nil
        account?.setForeground(false)
        network.stop()
        startup.stop()
        discovery.stop()
        settings.stop()
        let previousStop = catalogStop
        catalogStop = Task {
            await previousStop?.value
            await catalog.cancelRefresh()
        }
    }
    /// Teardown can await outstanding disk work before removing an isolated store.
    func stopAndWait() async {
        stop()
        await catalogStop?.value
        await account?.stopAndWait()
    }
}
