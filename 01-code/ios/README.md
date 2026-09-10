# Bark Ranger for iPhone

Phase 2 adds **393 bundled parks**, local search/filters, complete details, native MapKit, a geographic overview that works offline, one-shot Locate Me, Apple Maps directions and device settings. Accounts, trips and passport remain marked as future development features. The existing web app and deployed backend continue operating independently.

## Open and run

Open `BarkRanger.xcodeproj`, choose the shared **BarkRanger** scheme and **iPhone 17 Pro**, then press **Command-R**. Home opens without sign-in. Tap **Map** for the full-screen map. Tap the wide search bar to browse results; its inline matching/total count, dropdown and pins update together while the keyboard stays open. Active filters appear as removable chips beneath search. Touch or drag the map to collapse search while keeping its text, filters and count; tap the field to reopen the same results. Pins use the approved BARK artwork, and larger dark clusters pair the logo with their park count. Select a park for the three-position detail sheet: low keeps one condensed name line and Directions/Park Info above the tabs; medium adds metadata and neutral photo placeholders while search/tabs stay visible; high becomes the full detail screen and hides search/tabs. Drag the handle or swipe the card; at high, the facts scroll normally. **Park Info** expands high, and **×** returns to the same map/search. Use **Home → Settings** for map appearance, offline overview, saved catalog status, permissions and local legal documents.

The default build loads the newest valid bundle/saved revision. **Live spreadsheet publication is not deployed or configured yet.** Local fixtures exercise refresh behavior; see the [simple local update instructions](../../04-docs/operations/NATIVE_CATALOG_PUBLICATION.md#reproduce-locally). A saved copy is never labeled fresh just because a network path exists.

Toolchain: **Xcode 26.6 (17F113), Swift 6.3.3**, Swift 6 language mode with complete concurrency checking. Minimum deployment target **iOS 18.4**; installed/tested simulator runtime **iOS 26.5**. Physical-device signing/trust and an actual iOS 18.4 runtime remain separate checks. See [Config/README.md](Config/README.md).

## Find the owner

[ARCHITECTURE.md](ARCHITECTURE.md) maps every implemented file, its functions and direct calls. Start with `BarkRangerApp → AppComposition → RootView / AppLifecycle`, then follow startup into `CatalogRepository`. The catalog is independent of accounts; one filter result drives both pins and counts.

- `BarkRanger/App`: assembly, navigation, lifecycle and startup.
- `BarkRanger/Data/Catalog`: accepted revisions, HTTP, validation and atomic disk storage.
- `BarkRanger/Data/User`: device preferences only in phase 2.
- `BarkRanger/Features`: Home, Discovery and Settings views/models.
- `BarkRanger/Platform`: native location/maps, offline geography, connectivity and redacted local diagnostics.
- `Packages/BarkDomain`: immutable values and pure catalog/filter/search policies; Foundation only.
- `Resources`: approved public snapshot, exact provenance, local geography and static education/legal content.
- Matching test directories, `Config` and the shared Xcode scheme remain separate from runtime responsibilities.

The original badge is unchanged. The paw development icon uses SF Symbols; final App Store artwork is a release task. Strings remain English; the string catalog is a future translation boundary, not a claim of complete localization. Native privacy/App Store disclosures will be reviewed before release; current legal text is explicitly identified as retained web-service content.

## Reproduce checks

From the repository root, keep the local fixture server running in a separate terminal while app unit tests run:

```sh
node 05-tools/scripts/serve-ios-catalog.js
```

Then:

```sh
swift test --package-path 01-code/ios/Packages/BarkDomain
NODE_ENV=test node --test 01-code/functions/tests/native-catalog.test.js 01-code/functions/tests/catalog-publication-script.test.js
npm test --prefix 01-code/functions
node --test 03-tests/firebase-project-isolation.test.cjs

BARK_CHECK_DIR=$(mktemp -d /tmp/bark-native-check.XXXXXX)
xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath "$BARK_CHECK_DIR/DerivedData" \
  CODE_SIGNING_ALLOWED=NO SWIFT_TREAT_WARNINGS_AS_ERRORS=YES build-for-testing

xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath "$BARK_CHECK_DIR/DerivedData" \
  -resultBundlePath "$BARK_CHECK_DIR/CatalogTests.xcresult" \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test-without-building
```

Use **Product → Test** in Xcode for app unit/UI checks, with the fixture server running. Package tests run separately. The server uses only public/synthetic local fixtures; it cannot publish data. UI tests isolate device preferences in a Debug-only UUID-named suite, preserving normal development preferences and testing persistence through relaunch within the same suite.

The native workflow pins Xcode 26.6 and starts its own loopback server. The catalog workflow uses Node 22 (the backend's declared runtime); local checks currently run on Node 24.15.0. Both workflows are read-only with respect to production and contain no deployment. Refer to the phase report for actual completed run evidence and remaining checks.

## Phase handoff

- [Phase 2 report and testing checklist](../../04-docs/reports/ios-native/PHASE_2.md)
- [Six-phase execution contract](../../04-docs/plans/ios-native-2026-09-09/IMPLEMENTATION_PHASES.md)
- [Complete proposed Swift map](../../04-docs/plans/ios-native-2026-09-09/SWIFT_FILE_MAP.md)
- [Catalog publisher and rollback runbook](../../04-docs/operations/NATIVE_CATALOG_PUBLICATION.md)

Phase 3 starts only on the user's explicit instruction after phase-2 testing/fixes. No users, purchases or cloud records move during these build phases.

GitHub destination: [USBarkRangers/USBarkRangers](https://github.com/USBarkRangers/USBarkRangers), branch `codex/ios-native-setup`, remote `usbarkrangers`. Never push this native work through the multi-remote `both` alias or deploy the old web app as a side effect.
