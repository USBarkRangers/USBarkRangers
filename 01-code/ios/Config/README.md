# Native configuration

Base.xcconfig pins iPhone/iOS 18.4, Swift 6 and complete concurrency checking. Xcode 26.6/Swift 6.3.3 is the verified toolchain. Bundle ID is `swarm.USBARKRANGERS`; device signing uses the existing BARK_DEVELOPMENT_TEAM or ignored Signing.local.xcconfig override. A genuine native Firebase app and Personal Team device profile were configured September 10 for the owner's Google account test.

Info.plist declares public navigation, location-on-action wording and the separate Google callback scheme. BarkRanger.entitlements declares the application Keychain group; Sign in with Apple is temporarily commented out while paid team activation is pending. AccountAssembly also keeps the Apple capability disabled. Restore both after genuine Apple capability/provisioning setup, before Apple provider testing or release. Simulator Auth tests require an ad-hoc signature (`CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES`); no signing certificate is needed for that local simulator test. No background location, HealthKit, Live Activity, push, associated-domain or StoreKit integration is added.

## Catalog

As of 0.5.10 (69), Base.xcconfig supplies the verified public native manifest at `https://storage.googleapis.com/barkrangermap-auth-native-catalog/native-catalog/v1/manifest.json`. Normal builds no longer require a private catalog override. Use `https:/$()/host/path/manifest.json` in xcconfig so `//` is not parsed as a comment. The app checks every five minutes while foregrounded and saves accepted updates atomically for offline launches. The source publisher also runs every five minutes. See [the live runbook](../../../04-docs/operations/NATIVE_CATALOG_PUBLICATION.md). Release accepts HTTPS only; Debug retains explicit local fixture overrides. Normal browsing never asks for location.

## Accounts

Firebase **12.19.1** and GoogleSignIn **10.0.0** are pinned in the project and committed Package.resolved. The app links Auth, Firestore and Functions; no Analytics product is linked. AccountAssembly configures Firestore memory cache; SwiftData owns durable personal data and pending writes.

The genuine **Bark Ranger iOS** app is registered under **barkrangermap-auth** with bundle `swarm.USBARKRANGERS` and app ID `1:564465144962:ios:828a2174941919dbd5d09b`. Its downloaded `GoogleService-Info.plist` lives in the app folder and is ignored by Git. Another developer must obtain this same app's configuration from Firebase; a web app ID is not a native configuration. AccountAssembly validates project/bundle/native app-ID shape and otherwise leaves account sign-in unavailable while public discovery continues.

For Google, set `BARK_GOOGLE_REVERSED_CLIENT_ID` to the genuine REVERSED_CLIENT_ID from that plist in ignored `Accounts.local.xcconfig`; this Mac is configured. Its checked-in default remains an intentionally unconfigured non-provider scheme. The adapter is only enabled if the actual client ID matches the app's URL schemes. The owner completed real Google sign-in on the phone September 10 and confirmed their existing account details and membership. Linking, credential cancellation and Apple revocation need separate provider verification.

AccountAssembly.capabilities enables profile writes, authentication changes and account management in both the normal app and emulator integration tests. Only Apple sign-in remains disabled. On September 11 the owner explicitly authorized non-Apple live enablement: applyUserMutation, deleteNativeAccount, restoreNativeAccess, getNativeBillingURL and cancelNativeSubscription were deployed to barkrangermap-auth, with the receipt-denial rule and receipt TTL. The existing 24 endpoints were verified unchanged. Ordinary account operations use Firebase HTTPS directly and require no Mac or local Wi-Fi connection. Leave BARK_DEVICE_ACCOUNT_HOST empty for this normal build.

Google/email creation/sign-in, reset/verification/linking, profile editing, eligible cloud appearance settings and existing-account management are enabled. Existing Lemon subscriptions retain their management contract; no new purchase flow or customer migration was added. StoreKit purchasing remains Phase 6. Restore the Apple entitlement and shared assembly capability only after genuine paid-team/Firebase Apple-provider setup, then verify the real Apple flow. Membership approval alone does not modify an already installed build.

## Local testing

The separate **BarkRanger Local Accounts** shared scheme enables the explicit Debug-only demo emulator assembly and stable disposable sandbox. Normal **BarkRanger** Run remains separate. Ordinary Test uses inert accounts; the opt-in emulator test helper selects actual SDK/UI contracts. Release ignores all test launch flags. See [the setup/test checklist](../../../04-docs/operations/NATIVE_ACCOUNT_TESTING.md).

For physical iPhone testing, ignored `DeviceTesting.local.xcconfig` may set `BARK_DEVICE_ACCOUNT_HOST` to the Mac's private IPv4 address. Only Debug includes that file; Release keeps the value empty and has no test startup branch. The standard BarkRanger scheme then uses real map/platform behavior with separate demo account storage, including after Home Screen relaunch. Keep the Mac's local emulators and foreground `serve-ios-account-device.cjs` connection running. No native production Firebase registration is required for this path.

Never add production customer credentials, fake provider registrations or JDDM configuration here. The owner's requested native registration is complete; customer migration remains outside this test. The separately authorized September 11 account deployment is recorded above.
