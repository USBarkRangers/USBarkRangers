import BarkDomain
import Foundation
import MapKit
import SwiftUI
import Testing

@testable import BarkRanger

@MainActor
struct DiscoveryStateTests {
    @Test func oneProjectionPerEffectiveInputIgnoresOtherSettingsAndStatus() async throws {
        let probe = ControlledParkResults()
        let context = try DiscoveryTestContext(scenario: "valid", compute: probe.compute)
        defer { context.close() }
        try await context.start()
        let model = context.model
        #expect(await probe.inputs.count == 1)
        for _ in 0..<20 {
            var settings = context.settings.value
            settings.units = settings.units == .miles ? .kilometers : .miles
            settings.mapStyle = settings.mapStyle == .standard ? .satellite : .standard
            settings.clustering.toggle()
            context.settings.update(settings)
            model.cameraChanged(
                .init(
                    center: .init(latitude: 40, longitude: -80),
                    span: .init(latitudeDelta: 5, longitudeDelta: 5)))
            model.setFilters(model.query)
            await context.catalog.noteOffline()
            await Task.yield()
        }
        var query = model.query
        query.search = "hulls cove"
        model.setFilters(query)
        try await eventually { model.projection?.input.query == query }
        #expect(await probe.inputs.map(\.query.search) == ["", "hulls cove"])
        query.categories = [.national]
        model.setFilters(query)
        try await eventually { model.projection?.input.query == query }
        #expect(await probe.inputs.count == 3)
        context.settings.resetPreferences()
        try await eventually { model.projection?.input.query == ParkFilter.Query() }
        #expect(await probe.inputs.count == 4)
        let version = model.annotationVersion
        await context.catalog.refresh(reason: .manual)
        try await eventually {
            model.projection?.input.revision == model.catalogState.snapshot?.revision
                && model.catalogState.status == .fresh
        }
        #expect(await probe.inputs.count == 5)
        #expect(model.annotationVersion == version + 1)
        await context.catalog.refresh(reason: .manual)
        model.stop()
        model.start()
        // A changed query gives a completion barrier after status-only and same-revision restart events.
        query.search = "acadia"
        model.setFilters(query)
        try await eventually { model.projection?.input.query == query }
        #expect(await probe.inputs.count == 6)
    }

    @Test func lateResultsCannotOverwriteNewQueryOrPublishAfterStop() async throws {
        let probe = ControlledParkResults()
        let context = try DiscoveryTestContext(compute: probe.compute)
        defer { context.close() }
        try await context.start()
        let model = context.model
        await probe.hold("acadia")
        var query = model.query
        query.search = "acadia"
        model.setFilters(query)
        try await eventually { await probe.isWaiting("acadia") }
        let obsolete = model.resultTask
        query.search = "hulls cove"
        model.setFilters(query)
        try await eventually { model.projection?.input.query == query }
        let version = model.annotationVersion
        await probe.release("acadia")
        await obsolete?.value
        #expect(model.projection?.input.query == query && model.annotationVersion == version)
        await probe.hold("park")
        query.search = "park"
        model.setFilters(query)
        try await eventually { await probe.isWaiting("park") }
        let stopped = model.resultTask
        model.stop()
        await probe.release("park")
        await stopped?.value
        #expect(model.projection?.input.query.search == "hulls cove")
        model.start()
        try await eventually { model.projection?.input.query.search == "park" }
        #expect(model.result.matchingCount == model.parks.count)
    }

    @Test func selectionRefreshAndDismissalKeepDetailsAndDirectionsCoherent() async throws {
        var opened: URL?
        let context = try DiscoveryTestContext(
            scenario: "valid",
            maps: MapsHandoff(open: {
                opened = $0
                return true
            }))
        defer { context.close() }
        try await context.start()
        let model = context.model
        let first = try #require(model.parks.first)
        let second = try #require(model.parks.dropFirst().first)
        model.selectPark(id: first.id, focusOnMap: false)
        model.detail.navigate()
        let queued = model.detail.navigation
        model.selectPark(id: second.id, focusOnMap: false)
        await queued?.value
        #expect(opened == nil)
        #expect(model.selectedID == second.id && model.detail.park == second)
        model.detail.navigate()
        await model.detail.navigation?.value
        #expect(opened == MapsHandoff.navigationURL(for: second))
        let updatedPark = try #require(model.catalogState.snapshot?.parks.first)
        model.selectPark(id: updatedPark.id, focusOnMap: false)
        await context.catalog.refresh(reason: .manual)
        try await eventually { model.catalogState.status == .fresh }
        #expect(model.selectedID == updatedPark.id)
        #expect(model.detail.park == model.catalogState.snapshot?.park(id: updatedPark.id))
        #expect(model.detail.park?.info != updatedPark.info)
        opened = nil
        model.detail.navigate()
        let cancelled = model.detail.navigation
        model.dismissPark()
        model.stop()
        await cancelled?.value
        #expect(opened == nil && model.selectedID == nil && model.detail.park == nil)
    }

    @Test func stoppedQueuedManualRefreshDoesNotStartAndCanRestart() async throws {
        let context = try DiscoveryTestContext(scenario: "valid")
        defer { context.close() }
        _ = await context.catalog.loadLocal()
        let settings = SettingsModel(preferences: context.settings, catalog: context.catalog)
        settings.refreshCatalog()
        let queued = settings.refreshTask
        settings.stop()
        await queued?.value
        #expect(await context.catalog.current().status == .saved)
        settings.refreshCatalog()
        await settings.refreshTask?.value
        #expect(await context.catalog.current().status == .fresh)
        settings.stop()
    }

    @Test func immediateForegroundRestartWaitsForOldCatalogCancellation() async throws {
        let context = try DiscoveryTestContext(scenario: "slow")
        defer { context.close() }
        let network = NetworkMonitor()
        let diagnostics = Diagnostics(enabled: false)
        let startup = StartupModel(catalog: context.catalog, network: network, diagnostics: diagnostics)
        let lifecycle = AppLifecycle(
            startup: startup, catalog: context.catalog, network: network,
            discovery: context.model,
            settings: SettingsModel(preferences: context.settings, catalog: context.catalog),
            diagnostics: diagnostics)
        defer { lifecycle.stop() }
        lifecycle.sceneChanged(.active)
        try await eventually { await context.catalog.current().status == .checking }
        for _ in 0..<3 {
            lifecycle.sceneChanged(.background)
            lifecycle.sceneChanged(.active)
        }
        try await eventually { await context.catalog.current().status == .fresh }
        #expect(lifecycle.phase == .active && startup.state == .ready)
        #expect(await context.catalog.current().source == .online)
    }

    @Test func lateHandoffFailureCannotAffectAnotherSelectionOrClearItsBusyState() async throws {
        var completions: [CheckedContinuation<Bool, Never>] = []
        let context = try DiscoveryTestContext(
            maps: MapsHandoff(open: { _ in
                await withCheckedContinuation { completions.append($0) }
            }))
        defer { context.close() }
        try await context.start()
        let model = context.model
        model.selectPark(id: try #require(model.parks.first).id, focusOnMap: false)
        model.detail.navigate()
        let old = model.detail.navigation
        try await eventually { completions.count == 1 }
        model.selectPark(id: try #require(model.parks.dropFirst().first).id, focusOnMap: false)
        model.detail.navigate()
        let current = model.detail.navigation
        try await eventually { completions.count == 2 }
        completions[0].resume(returning: false)
        await old?.value
        #expect(model.detail.message == nil && model.detail.isOpeningMaps)
        completions[1].resume(returning: true)
        await current?.value
        #expect(model.detail.message == nil && !model.detail.isOpeningMaps)
    }
}
