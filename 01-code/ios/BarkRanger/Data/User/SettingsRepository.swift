import BarkDomain
import Foundation
import Observation

/// Device-only, non-private preferences; one encoded value avoids partially saved settings.
@MainActor @Observable
final class SettingsRepository {
    private(set) var value = AppSettings()
    private let defaults: UserDefaults?
    private let key = "bark.deviceSettings.v1"
    init(defaults: UserDefaults?) {
        self.defaults = defaults
        load()
    }
    func load() {
        if let data = defaults?.data(forKey: key),
            let decoded = try? JSONDecoder().decode(AppSettings.self, from: data)
        {
            value = decoded.sanitized()
        }
    }
    func update(_ settings: AppSettings) {
        let sanitized = settings.sanitized()
        guard sanitized != value, let bytes = try? JSONEncoder().encode(sanitized) else { return }
        value = sanitized
        defaults?.set(bytes, forKey: key)
    }
    func resetPreferences() { update(AppSettings()) }
}
