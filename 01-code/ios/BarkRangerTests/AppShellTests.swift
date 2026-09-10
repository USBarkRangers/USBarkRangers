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
        let composition = AppComposition.makeLive()
        composition.lifecycle.sceneChanged(.active)
        try await Task.sleep(for: .milliseconds(200))
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
        composition.lifecycle.stop()
    }

    @Test func previewAndNewAppLifetimesDoNotShareNavigation() {
        let first = AppComposition.makePreview()
        let second = AppComposition.makePreview()
        first.router.open(.tab(.account))
        #expect(second.router.selectedTab == .home)
        #expect(second.startup.state == .ready)
    }

    @Test func durationMeasurementPreservesReturnValuesAndErrors() throws {
        enum ExpectedFailure: Error { case failure }
        #expect(diagnostics.measure(.shellStartup) { 42 } == 42)
        #expect(throws: ExpectedFailure.self) {
            try diagnostics.measure(.shellStartup) { throw ExpectedFailure.failure }
        }
    }
}
