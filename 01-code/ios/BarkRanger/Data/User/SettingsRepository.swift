import BarkDomain
import Foundation
import Observation

/// Device preferences plus a read-only projection of the active account’s map appearance.
/// SwiftData remains the sole authority for account preferences; they never copy into defaults.
@MainActor @Observable
final class SettingsRepository {
    private var device = AppSettings()
    let account: AccountSession?
    var syncsAppearance: Bool {
        account?.capabilities.profileWrites == true && account?.dataAccess.canEditAccount == true
            && account?.profileState?.visible?.status == .active
    }
    var value: AppSettings {
        var value = device
        if device.mapStyle != .overview, syncsAppearance,
            let style = account?.profileState?.visible?.mapStyle.rawValue

        {
            if style == "default" { value.mapStyle = .standard }
            if style == "satellite" { value.mapStyle = .satellite }
        }
        return value
    }
    private let defaults: UserDefaults?
    private let key = "bark.deviceSettings.v1"
    init(defaults: UserDefaults?, account: AccountSession? = nil) {
        self.account = account
        self.defaults = defaults
        load()
    }
    func load() {
        if let data = defaults?.data(forKey: key),
            let decoded = try? JSONDecoder().decode(AppSettings.self, from: data)
        {
            device = decoded.sanitized()
        }
    }
    func update(_ settings: AppSettings) {
        var sanitized = settings.sanitized()
        // Camera/filter saves must not copy a scoped cloud appearance into device defaults.
        if settings.mapStyle == value.mapStyle { sanitized.mapStyle = device.mapStyle }
        saveDevice(sanitized)
    }
    func setMapStyle(_ style: AppSettings.MapStyle) async throws {
        if syncsAppearance, let native = account?.nativeProfile, style != .overview {
            let uid = account?.identity?.uid
            try await native.saveAppearance(style == .satellite ? .satellite : .default)
            guard account?.identity?.uid == uid else { throw AccountFailure.accountChanged }
            if device.mapStyle == .overview {
                var next = device
                next.mapStyle = .standard
                saveDevice(next)
            }
        } else {
            var next = device
            next.mapStyle = style
            saveDevice(next)
        }
    }
    func resetPreferences() { saveDevice(AppSettings()) }
    private func saveDevice(_ settings: AppSettings) {
        guard settings != device, let bytes = try? JSONEncoder().encode(settings) else { return }
        device = settings
        defaults?.set(bytes, forKey: key)
    }
}
