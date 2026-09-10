import BarkDomain
import Foundation
import Observation

@MainActor @Observable
final class SettingsModel {
    enum Document: String, CaseIterable, Identifiable {
        case privacy = "Privacy policy"
        case terms = "Terms of use"
        case attribution = "Data and map sources"
        var id: Self { self }
        var resource: String {
            switch self {
            case .privacy: "privacy"
            case .terms: "terms"
            case .attribution: "attribution"
            }
        }
    }
    let preferences: SettingsRepository
    private(set) var catalogState = CatalogRepository.State()
    private(set) var documentText = ""
    private let catalog: CatalogRepository
    private let openSettings: () -> Void
    private var observation: Task<Void, Never>?
    @ObservationIgnored private(set) var refreshTask: Task<Void, Never>?
    init(preferences: SettingsRepository, catalog: CatalogRepository, openSettings: @escaping () -> Void) {
        self.preferences = preferences
        self.catalog = catalog
        self.openSettings = openSettings
    }
    func load() {
        guard observation == nil else { return }
        observation = Task {
            for await state in await catalog.updates() {
                guard !Task.isCancelled else { return }
                catalogState = state
            }
        }
    }
    func update(_ value: AppSettings) { preferences.update(value) }
    func resetPreferences() { preferences.resetPreferences() }
    func refreshCatalog() {
        guard refreshTask == nil else { return }
        refreshTask = Task {
            guard !Task.isCancelled else { return }
            await catalog.refresh(reason: .manual)
            if !Task.isCancelled { refreshTask = nil }
        }
    }
    func openSystemSettings() {
        openSettings()
    }
    func openLegalDocument(_ document: Document) {
        guard let url = Bundle.main.url(forResource: document.resource, withExtension: "txt"),
            let text = try? String(contentsOf: url, encoding: .utf8)
        else {
            documentText = "This document could not be opened."
            return
        }
        documentText = text
    }
    func stop() {
        observation?.cancel()
        observation = nil
        refreshTask?.cancel()
        refreshTask = nil
    }
    static func statusText(_ state: CatalogRepository.State) -> String {
        switch state.status {
        case .checking: "Checking for park updates…"
        case .fresh: "Park catalog is up to date"
        case .offline: "Offline · saved parks are available"
        case .unavailable: "Update unavailable · using saved parks"
        case .notConfigured: "Saved catalog · online updates are not configured"
        case .saved: "Saved parks are available"
        }
    }
}
