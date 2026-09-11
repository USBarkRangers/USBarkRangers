import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct ScopedSettingsTests {
    @Test func deviceResetDoesNotKeepAnAppearanceHiddenByAnAccountOverride() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        let snapshot = PersonalSnapshot(
            uid: "a",
            profile: .init(fields: [
                "entitlement": .object(["premium": .bool(true), "status": .string("active")]),
                "settings": .object(["mapStyle": .string("default")]),
            ]), confirmedAt: Date())
        try await store.applyServerSnapshot(snapshot, sequence: store.beginRead())
        await store.close()
        let auth = SyntheticAuth()
        let session = AccountSession(auth: auth, cloud: nil, directory: folder)
        let settings = SettingsRepository(defaults: nil, account: session)
        try await settings.setMapStyle(.satellite)
        session.setForeground(true)
        auth.select("a")
        try await eventually { session.state != nil }
        #expect(settings.value.mapStyle == .standard)
        settings.resetPreferences()
        try auth.signOut()
        try await eventually { session.identity == nil }
        #expect(settings.value.mapStyle == .standard)
        await session.stopAndWait()
    }
    @Test func cloudAppearanceNeverLeaksIntoDeviceDefaultsAndOverviewStaysLocal() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try await LocalStore.open(directory: folder, uid: "a")
        let snapshot = PersonalSnapshot(
            uid: "a",
            profile: .init(fields: [
                "entitlement": .object(["premium": .bool(true), "status": .string("active")]),
                "settings": .object(["mapStyle": .string("satellite"), "other": .number(7)]),
            ]), confirmedAt: Date())
        try await store.applyServerSnapshot(snapshot, sequence: store.beginRead())
        await store.close()
        let auth = SyntheticAuth()
        let session = AccountSession(auth: auth, cloud: nil, directory: folder)
        let settings = SettingsRepository(defaults: nil, account: session)
        session.setForeground(true)
        auth.select("a")
        try await eventually { session.state != nil }
        #expect(settings.value.mapStyle == .satellite)
        var value = settings.value
        value.filters.search = "Acadia"
        value.clustering = false
        settings.update(value)
        try await settings.setMapStyle(.overview)
        #expect(settings.value.mapStyle == .overview)
        #expect(session.state?.pending.isEmpty == true)
        try await settings.setMapStyle(.standard)
        try await eventually { settings.value.mapStyle == .standard }
        #expect(session.state?.pending.count == 1)
        #expect(session.state?.visible.profile.settings["other"] == .number(7))
        try auth.signOut()
        try await eventually { session.identity == nil }
        #expect(settings.value.mapStyle == .standard)
        #expect(settings.value.filters.search == "Acadia")
        #expect(!settings.value.clustering)
        await session.stopAndWait()
    }
}
