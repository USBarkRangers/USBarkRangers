import BarkDomain
import Foundation
import SwiftUI
import Testing

@testable import BarkRanger

@MainActor
struct AppShellTests {
    private let diagnostics = Diagnostics(enabled: false)

    @Test func navigationDismissesSheetsWhenChangingDestination() {
        let router = AppRouter(diagnostics: diagnostics)
        router.open(.sheet(.about))
        #expect(router.sheet == .about)
        router.open(.tab(.trips))
        #expect(router.selectedTab == .trips)
        #expect(router.sheet == nil)
        router.open(.sheet(.about))
        router.dismissSheet()
        #expect(router.sheet == nil)
        #expect(router.selectedTab == .trips)
    }

    @Test(arguments: ["barkranger://home", "barkranger://home/", "BARKRANGER://HOME"])
    func homeLinksSelectHomeAndDismissSheets(_ value: String) throws {
        let router = AppRouter(diagnostics: diagnostics)
        router.open(.tab(.passport))
        router.open(.sheet(.about))
        #expect(router.handle(url: try #require(URL(string: value))))
        #expect(router.selectedTab == .home)
        #expect(router.sheet == nil)
    }

    @Test func aboutLinkPresentsThePublicSheet() throws {
        let router = AppRouter(diagnostics: diagnostics)
        #expect(router.handle(url: try #require(URL(string: "barkranger://about"))))
        #expect(router.sheet == .about)
    }

    @Test(arguments: [
        "https://home", "barkranger://account", "barkranger://parks/42",
        "barkranger://home/private", "barkranger://home?token=secret", "barkranger://home#private",
        "barkranger://user:password@home", "barkranger://home:443", "barkranger:home",
        "barkranger://home/%2F", "barkranger://home//", "barkranger://",
    ])
    func invalidLinksLeaveExistingNavigationAlone(_ value: String) throws {
        let router = AppRouter(diagnostics: diagnostics)
        router.open(.tab(.trips))
        router.open(.sheet(.about))
        #expect(!router.handle(url: try #require(URL(string: value))))
        #expect(router.selectedTab == .trips)
        #expect(router.sheet == .about)
    }

    @Test func sceneTransitionsReuseTheSameStateWithoutRestarting() async throws {
        try await withSandbox { _, composition in
            composition.lifecycle.sceneChanged(.active)
            try await eventually { composition.startup.state == .ready }
            composition.router.open(.tab(.passport))
            for _ in 0..<3 {
                composition.lifecycle.sceneChanged(.active)
                composition.lifecycle.sceneChanged(.inactive)
                composition.lifecycle.sceneChanged(.background)
                composition.lifecycle.stop()
                composition.lifecycle.sceneChanged(.active)
            }
            #expect(composition.lifecycle.phase == .active)
            #expect(composition.startup.state == .ready)
            #expect(!composition.startup.start())
            #expect(composition.router.selectedTab == .passport)
        }
    }

    @Test func previewAndNewAppLifetimesDoNotShareNavigation() {
        let first = AppSandbox().makeComposition(preview: true)
        let second = AppSandbox().makeComposition(preview: true)
        first.router.open(.tab(.account))
        #expect(second.router.selectedTab == .home)
        #expect(second.startup.state == .ready)
    }

    @Test func sandboxesKeepPreferencesCatalogAndExternalActionsIsolated() async throws {
        try await withSandbox { first, composition in
            let other = AppSandbox()
            defer { try? other.removeArtifacts() }
            let second = other.makeComposition()
            var value = composition.settings.preferences.value
            value.clustering = false
            composition.settings.update(value)
            #expect(!first.makeComposition().settings.preferences.value.clustering)
            #expect(second.settings.preferences.value.clustering)
            let envelope = try #require(first.disk.loadCandidates().first?.envelope)
            try first.disk.commit(envelope, previous: nil)
            #expect(first.disk.loadCandidates().contains { $0.source == .saved })
            #expect(!other.disk.loadCandidates().contains { $0.source == .saved })
            composition.lifecycle.sceneChanged(.active)
            try await eventually {
                composition.startup.state == .ready && !composition.discovery.parks.isEmpty
            }
            composition.discovery.selectPark(id: try #require(composition.discovery.parks.first).id)
            composition.discovery.detail.navigate()
            await composition.discovery.detail.navigation?.value
            #expect(composition.discovery.detail.message != nil, "Sandbox handoffs cannot launch another app")
            composition.discovery.locateMe()
            try await eventually { !composition.discovery.isLocating }
            #expect(
                composition.discovery.locationMessage != nil, "Sandbox location cannot request permission")
            await composition.lifecycle.stopAndWait()
            // Reopen the same sandbox, just like a UI test relaunch, without deleting its stored copy.
            try await withSandbox(first) { _, restarted in
                restarted.lifecycle.sceneChanged(.active)
                try await eventually {
                    restarted.startup.state == .ready && !restarted.discovery.parks.isEmpty
                }
                #expect(!restarted.settings.preferences.value.clustering)
                #expect(restarted.discovery.catalogState.source == .saved)
            }
        }
    }

    @Test func sandboxRefusesRemoteCatalogConfiguration() async throws {
        try await withSandbox(endpoint: URL(string: "https://example.com/manifest.json")) { _, composition in
            composition.lifecycle.sceneChanged(.active)
            try await eventually {
                composition.startup.state == .ready && !composition.discovery.parks.isEmpty
            }
            #expect(composition.discovery.catalogState.source == .bundle)
            #expect(composition.discovery.isOffline)
        }
    }

    private func withSandbox(
        _ sandbox: AppSandbox = AppSandbox(), endpoint: URL? = nil,
        body: (AppSandbox, AppComposition) async throws -> Void
    ) async throws {
        let composition = sandbox.makeComposition(manifestURL: endpoint)
        do {
            try await body(sandbox, composition)
        } catch {
            await composition.lifecycle.stopAndWait()
            try? sandbox.removeArtifacts()
            throw error
        }
        await composition.lifecycle.stopAndWait()
        try sandbox.removeArtifacts()
    }

    @Test func durationMeasurementPreservesReturnValuesAndErrors() throws {
        enum ExpectedFailure: Error { case failure }
        #expect(diagnostics.measure(.shellStartup) { 42 } == 42)
        #expect(throws: ExpectedFailure.self) {
            try diagnostics.measure(.shellStartup) { throw ExpectedFailure.failure }
        }
    }
}
