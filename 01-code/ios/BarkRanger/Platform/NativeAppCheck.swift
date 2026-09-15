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
            // Native registration: paid team V7Y6NA8G23, production App Attest
            // entitlement. Genuine device attestation remains a device acceptance gate.
            AppCheck.setAppCheckProviderFactory(AppAttestProviderFactory())
        #endif
        configured = true
    }
}
