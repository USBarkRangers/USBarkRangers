import Foundation
import Observation
import SwiftUI

/// Owns navigation values only. External links can open implemented public screens.
@MainActor @Observable
final class AppRouter {
    enum Tab: String, CaseIterable, Identifiable {
        case home, map, trips, passport, account

        var id: Self { self }

        var title: LocalizedStringKey {
            switch self {
            case .home: "Home"
            case .map: "Map"
            case .trips: "Trips"
            case .passport: "Passport"
            case .account: "Account"
            }
        }

        var symbol: String {
            switch self {
            case .home: "house"
            case .map: "map"
            case .trips: "point.topleft.down.to.point.bottomright.curvepath"
            case .passport: "book.closed"
            case .account: "person.crop.circle"
            }
        }
    }

    enum Sheet: String, Identifiable {
        case about
        var id: Self { self }
    }

    enum Destination {
        case tab(Tab)
        case sheet(Sheet)
    }

    var selectedTab: Tab = .home
    var sheet: Sheet?
    private let diagnostics: Diagnostics

    init(diagnostics: Diagnostics) {
        self.diagnostics = diagnostics
    }

    func open(_ destination: Destination) {
        switch destination {
        case .tab(let tab):
            sheet = nil
            selectedTab = tab
        case .sheet(let sheet):
            self.sheet = sheet
        }
    }

    func dismissSheet() {
        sheet = nil
    }

    /// Deliberately excludes account, park IDs and query payloads until implemented.
    @discardableResult
    func handle(url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "barkranger",
              components.user == nil, components.password == nil,
              components.port == nil, components.query == nil, components.fragment == nil,
              components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/"
        else { return rejectLink() }

        switch components.host?.lowercased() {
        case "home": open(.tab(.home))
        case "about": open(.sheet(.about))
        default: return rejectLink()
        }
        return true
    }

    private func rejectLink() -> Bool {
        // Never log the supplied URL: it could contain credentials or personal data.
        diagnostics.record(.unsupportedLink)
        return false
    }
}
