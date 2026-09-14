import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct ScopedSettingsTests {
    @Test func deviceResetDoesNotKeepAnAppearanceHiddenByAnAccountOverride() async throws {
        let f = try await NativeOfflineAccountFixture.make(signIn: false)
        let session = f.session
        let settings = SettingsRepository(defaults: nil, account: session)
        try await settings.setMapStyle(.satellite)
        f.auth.select("a")
        try await eventually { session.profileState?.confirmed != nil }
        #expect(settings.value.mapStyle == .standard)
        settings.resetPreferences()
        try f.auth.signOut()
        try await eventually { session.identity == nil }
        #expect(settings.value.mapStyle == .standard)
        try await f.close()
    }

    @Test(arguments: [true, false])
    func cloudAppearanceNeverLeaksIntoDeviceDefaultsAndOverviewStaysLocal(editable: Bool) async throws {
        let f = try await NativeOfflineAccountFixture.make(
            mapStyle: .satellite,
            capabilities: .init(profileWrites: editable))
        let session = f.session
        let settings = SettingsRepository(defaults: nil, account: session)
        #expect(settings.syncsAppearance == editable)
        #expect(settings.value.mapStyle == (editable ? .satellite : .standard))
        var value = settings.value
        value.filters.search = "Acadia"
        value.clustering = false
        settings.update(value)
        try await settings.setMapStyle(.overview)
        #expect(settings.value.mapStyle == .overview)
        #expect(session.profileState?.totalPendingCount == 0)
        try await settings.setMapStyle(.standard)
        try await eventually { settings.value.mapStyle == .standard }
        #expect(session.profileState?.pendingCount == (editable ? 1 : 0))
        #expect(session.profileState?.visible?.displayName == "Ranger a")
        try f.auth.signOut()
        try await eventually { session.identity == nil }
        #expect(settings.value.mapStyle == .standard)
        #expect(settings.value.filters.search == "Acadia")
        #expect(!settings.value.clustering)
        try await f.close()
    }
}
