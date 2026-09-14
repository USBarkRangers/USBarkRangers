import FirebaseAppCheck
import FirebaseCore

/// Configure before any Firebase app is created. Debug tokens must be registered
/// privately for each development device; none is embedded in code or configuration.
@MainActor enum NativeAppCheck {
    private static var configured = false

    static func configure() {
        guard !configured else { return }
        #if DEBUG
            AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
        #else
            // APPLE-ACTIVATION: configure App Attest for the approved paid Apple team
            // and add its signing entitlement before Release device acceptance.
            AppCheck.setAppCheckProviderFactory(AppAttestProviderFactory())
        #endif
        configured = true
    }
}
