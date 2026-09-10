# Native configuration

`Base.xcconfig` pins iPhone/iOS 18.4/Swift 6 and complete concurrency checks. Debug enables development fixture overrides; Release removes them. Xcode 26.6/Swift 6.3.3 is the verified toolchain. The bundle ID is `swarm.USBARKRANGERS`; automatic device signing uses the existing `BARK_DEVELOPMENT_TEAM` value or your ignored `Signing.local.xcconfig` override. No provisioning/registration is performed by phase 2.

`Info.plist` declares public home/about/map/settings URLs and location wording for **Locate Me**. Browsing never asks for location. Debug includes local-network wording for an explicitly configured local fixture server. There are no background location, HealthKit, Live Activity, push, Sign in with Apple, Associated Domains or StoreKit capabilities yet.

The checked-in `BARK_CATALOG_MANIFEST_URL` is empty because the native publisher/public assets are not deployed. An approved HTTPS endpoint can later be set in ignored `Catalog.local.xcconfig`. In xcconfig syntax write the URL as `https:/$()/host/path/manifest.json` so `//` is not a comment. Do not add credentials to URLs. Release accepts HTTPS only.

For local tests, add **Run → Arguments → Environment Variables → `BARK_CATALOG_URL=http://127.0.0.1:8787/active/manifest.json`** in the Xcode scheme. This override exists in Debug only. Start the checked-in fixture server as described in [the runbook](../../../04-docs/operations/NATIVE_CATALOG_PUBLICATION.md). The normal shared scheme remains free of a developer-specific endpoint. A Debug-only `BARK_TEST_PREFERENCES_SUITE` UUID is used by UI tests to isolate non-private preferences; it is not an account/access override.

The app has no Firebase SDK or GoogleService-Info.plist in phase 2. Existing production services belong only to `barkrangermap-auth`. Future account/provider setup requires a verified registered iOS app and its real configuration; an example identifier is never sufficient evidence of registration. No JDDM resources are used.
