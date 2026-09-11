# Native configuration

Base.xcconfig pins iPhone/iOS 18.4, Swift 6 and complete concurrency checking. Xcode 26.6/Swift 6.3.3 is the verified toolchain. Bundle ID is `swarm.USBARKRANGERS`; device signing uses the existing BARK_DEVELOPMENT_TEAM or ignored Signing.local.xcconfig override. Phase 3 has not provisioned a production native Firebase app or device profile.

Info.plist declares public navigation, location-on-action wording and the separate Google callback scheme. BarkRanger.entitlements declares the application Keychain group and Sign in with Apple. Simulator Auth tests require an ad-hoc signature (`CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES`); no signing certificate is needed for that local simulator test. Physical Apple sign-in still needs genuine registered identifiers/capabilities and provisioning. No background location, HealthKit, Live Activity, push, associated-domain or StoreKit integration is added.

## Catalog

BARK_CATALOG_MANIFEST_URL remains empty until the native publisher/public assets are deployed and verified. Later, set an approved HTTPS endpoint in ignored Catalog.local.xcconfig. Use `https:/$()/host/path/manifest.json` so xcconfig does not treat `//` as a comment. Release accepts HTTPS only. Debug supports the existing explicit BARK_CATALOG_URL loopback fixture override. Normal browsing never asks for location.

## Accounts

Firebase **12.19.1** and GoogleSignIn **10.0.0** are pinned in the project and committed Package.resolved. The app links Auth, Firestore and Functions; no Analytics product is linked. AccountAssembly configures Firestore memory cache; SwiftData owns durable personal data and pending writes.

Live setup later requires the genuine `GoogleService-Info.plist` for an iOS app registered under **barkrangermap-auth** with the matching bundle ID. Place it in the app folder so Xcode includes it; it is ignored by Git. AccountAssembly validates project/bundle/native app-ID shape and otherwise leaves account sign-in unavailable while public discovery continues. A web app ID is not a native configuration. Read-only Phase 3 inspection found only a web app registered; this prerequisite remains outstanding.

For Google, set `BARK_GOOGLE_REVERSED_CLIENT_ID` to the genuine REVERSED_CLIENT_ID from that plist in ignored `Accounts.local.xcconfig`. Its checked-in value is an intentionally unconfigured non-provider scheme. The adapter is only enabled if the actual client ID matches the app's URL schemes. Real Apple/Google linking, credential cancellation and Apple revocation must be verified later on the properly configured device build.

## Local testing

The separate **BarkRanger Local Accounts** shared scheme enables the explicit Debug-only demo emulator assembly and stable disposable sandbox. Normal **BarkRanger** Run remains separate. Ordinary Test uses inert accounts; the opt-in emulator test helper selects actual SDK/UI contracts. Release ignores all test launch flags. See [the setup/test checklist](../../../04-docs/operations/NATIVE_ACCOUNT_TESTING.md).

Never add production customer credentials, fake provider registrations or JDDM configuration here. No production setup/deployment or customer migration is part of this phase.
