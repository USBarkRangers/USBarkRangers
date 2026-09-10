import BarkDomain
import Foundation
import Observation
import UIKit

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
    private var observation: Task<Void, Never>?
    init(preferences: SettingsRepository, catalog: CatalogRepository) {
        self.preferences = preferences
        self.catalog = catalog
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
    func refreshCatalog() async { await catalog.refresh(reason: .manual) }
    func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
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
