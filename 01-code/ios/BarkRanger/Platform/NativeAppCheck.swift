import FirebaseAppCheck
import FirebaseCore
import Foundation

/// Configure before any Firebase app is created. Debug tokens must be registered
/// privately for each development device; none is embedded in code or configuration.
@MainActor enum NativeAppCheck {
    private static var configured = false

    static func configure() {
        guard !configured else { return }
        #if DEBUG
            AppCheck.setAppCheckProviderFactory(NativeDebugAppCheckFactory())
        #else
            // Native registration: paid team V7Y6NA8G23, production App Attest
            // entitlement. Genuine device attestation remains a device acceptance gate.
            AppCheck.setAppCheckProviderFactory(AppAttestProviderFactory())
        #endif
        configured = true
    }
}

#if DEBUG
    /// The real Debug provider exchanges a registered token with Google's service.
    /// A fake emulator project cannot complete that exchange: CI must stay local.
    /// Release contains neither this factory nor its deliberately invalid token.
    nonisolated final class NativeDebugAppCheckFactory: NSObject, AppCheckProviderFactory {
        static func isEmulator(_ options: FirebaseOptions) -> Bool {
            options.projectID == "demo-bark-native"
                && options.googleAppID == "1:123456789:ios:abcdef0123456789"
                && options.apiKey == "demo-bark-native-api-key"
        }

        func createProvider(with app: FirebaseApp) -> (any AppCheckProvider)? {
            if Self.isEmulator(app.options) { return NativeEmulatorAppCheckProvider() }
            // Live development still requires a privately registered debug token.
            return AppCheckDebugProvider(app: app)
        }
    }

    nonisolated private final class NativeEmulatorAppCheckProvider: NSObject, AppCheckProvider {
        func getToken(completion: @escaping (AppCheckToken?, (any Error)?) -> Void) {
            // Not a credential or signed proof; live enforcement must reject it.
            completion(
                AppCheckToken(
                    token: "bark-native-emulator-only", expirationDate: Date().addingTimeInterval(3600)),
                nil)
        }
    }
#endif
