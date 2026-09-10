# Phase 2 — catalog and discovery

September 10, 2026. Build **0.2.0 (2)** on `codex/ios-native-setup`, GitHub destination `USBarkRangers/USBarkRangers`. Phase 2 implementation is complete; final verification evidence is being recorded below. User acceptance remains pending. Phase 3 has not started.

## What you can use

The app opens without an account, with **393 real bundled park records**. Map and Results list share one search/filter result and count. Search is local, including retained abbreviations, diacritics and bounded spelling tolerance. Category and swag filters persist through relaunch. Details show every supplied field, including fees, swag locations, approved trails, restrictions, hazards, extra swag and approved source links. Directions open Apple Maps; Locate Me requests permission only when tapped.

The native map reuses annotations and preserves selection, filters and camera across accepted updates. Native clustering avoids a custom clustering engine. The bundled Natural Earth outline and an opaque local background provide a geographic overview without downloaded imagery; local results/details remain available. Detailed Apple street imagery and Apple Maps routing are separate provider capabilities and are not guaranteed offline by Bark.

Home includes the retained badge, B.A.R.K. education and approved community links. Settings contains device preferences, catalog status/manual refresh, permission settings and bundled legal/attribution text. Trips, Passport and Account remain clearly labeled development previews. Personal filters, visits, trip planning, accounts, purchases, tracking and Dynamic Island arrive in their approved later phases.

## Startup and updates

1. Validate disk/current, disk/previous and the bundled catalog; choose the newest compatible revision.
2. Independently attempt the configured public manifest. A matching ETag avoids downloading unchanged content. A new revision must pass complete metadata, hash, size, schema, coordinate and identity validation.
3. Atomically save the complete validated envelope before publishing it to screens. Invalid, incomplete or interrupted updates retain the last good records.
4. Give startup a **three-second network decision budget**. An update accepted in that time appears when the cover closes. Otherwise saved parks open and bounded recovery continues. Offline or unconfigured builds open local records promptly, without an artificial spinner delay.
5. While foregrounded, coalesce startup/manual/foreground/reconnect requests. Regular successful checks are at most once per minute; reconnection can retry earlier subject to failure backoff and server Retry-After. Polling stops in background.

**Live spreadsheet publication is not deployed or configured.** The ordinary build truthfully reports saved catalog status. Local fixtures verify HTTP updates, failure handling and persistence. A successful network path alone never means fresh data. Live source authorization, object delivery, triggers and real cellular timing remain later configuration checks.

## Source provenance and boundaries

The catalog is reproducibly generated from `01-code/app/assets/data/bark-fallback-0.142.csv`, source commit `f1bd2a0`, dated September 2, 2026. It is an approved checked-in fallback, not a claim about the latest live spreadsheet. All 393 source IDs are retained. The payload is 654,127 bytes; revision `1788339349000`; SHA-256 `bfbd5b0d6e06cfcc75adc7f040756c2a9cdd422a3ce6221604195dfd6348ee08`. Exact source hashing is also recorded in the bundled provenance file.

Only native code, local publisher/tests/tools and narrow disabled publication hooks have changed. No deployment, spreadsheet edit, live trigger installation, customer conversion, payment change, web-source removal or ORS retirement occurred. Unrelated working-tree edits are excluded from this phase's commits. The existing production project checks and old function exports remain intact.

## File ownership

The [implemented architecture and call map](../../../01-code/ios/ARCHITECTURE.md) names every Swift file, its owned operations and direct callers. It supersedes proposed rows only where phases 1–2 are implemented. No empty future modules were scaffolded.

| Owner | Phase-2 files and responsibility |
|---|---|
| App | Extend the seven existing app files for the real catalog/startup/lifecycle and discovery/settings routes. One composition root wires the graph. |
| Domain | Extend `Park`; add `CatalogSnapshot`, `AppSettings`, `ParkFilter`, `ParkSearchIndex`. Immutable values and pure policies; Foundation only. |
| Catalog | Add `CatalogRepository`, `CatalogHTTPClient`, `CatalogDiskStore`, `CatalogValidator`. One writer, conditional bounded transport, atomic envelopes and whole-snapshot validation. |
| Preferences | Add `SettingsRepository`, owning one encoded device-preferences value. No private store or migration framework yet. |
| Platform | Add `NetworkMonitor`, `LocationClient`, `MapsHandoff`, `OfflineBasemapOverlay`; extend `Diagnostics` with separate catalog timings. |
| Discovery | Add the 12 mapped files: `MapFeatureModel`, `MapScreen`, `NativeMapView`, `MapCoordinator`, `ParkAnnotation`, `MapOverlayRenderer`, `FilterSheet`, `FilterSummaryView`, `SearchModel`, `SearchSheet`, `ParkDetailModel`, `ParkDetailView`. |
| Home/settings | Extend `HomeView`; add `SettingsModel` and `SettingsView`. Views render and forward actions. |
| Resources | Public catalog/manifest/provenance, local land geometry/tile, education, retained legal text, approved community links and attribution. |
| Local backend | Four catalog files: source adapter, schema, publisher, trigger handlers. The small registry/admin-write integration is in the retained `index.js`. |
| Tools | Reproducible catalog/content builders, local scenario server, and separate Apps Script edit-signal source. |
| Verification | Domain/app/UI tests plus publication/script tests; native iOS and catalog GitHub workflows. Neither workflow deploys. |

The [publication runbook](../../operations/NATIVE_CATALOG_PUBLICATION.md) maps backend calls, local fixtures, eventual configuration and rollback. A deliberate refinement keeps the old CSV/fallback writer as its existing owner: native publication adds no second writer to old fallback storage. The public asset publisher uses immutable upload followed by a generation-conditioned manifest promotion. Memory adapters verify ordering/conflicts locally; they do not certify cloud IAM or actual storage preconditions.

## Verification evidence

Toolchain: **Xcode 26.6 (17F113), Swift 6.3.3**, complete Swift 6 concurrency checks. Minimum iOS 18.4; installed simulator runtime iOS 26.5. Local Node 24.15.0; catalog CI targets the backend's declared Node 22 runtime. No physical iPhone/provider verification is claimed.

| Check | Result |
|---|---|
| Foundation-only domain | 9 test functions passed, including all source records, exact identities, coordinate rejection, filters, visited/trip-ID inputs, abbreviations/typos, 5,000 records and antimeridian/territories. |
| App unit tests | 21 functions passed on iPhone 17 Pro, including conditional HTTP, disk recovery, stalled body deadline, cover timing, invalid updates, cancellation, Retry-After, reconnect, annotation identity, safe Maps URL construction and settings reset with an unmounted map. |
| Local publication / Apps Script | 18 tests passed: schema/identity preservation, immutable-before-pointer writes, failed upload, concurrency/lease/CAS, replay/wrong-project rejection, script debounce/retry and accepted-write failure isolation. |
| Retained backend | 378 tests across 76 suites passed; no failures or skips. |
| Project isolation | 2 tests passed, preserving project ownership/predeploy boundaries. |
| Debug compilation | App and test targets build with Swift warnings treated as errors. |
| Release compilation | Passed with Swift warnings treated as errors, Debug-only fixture overrides excluded. |
| iPhone UI and small-screen checks | Final results recorded after the current run completes. |
| Hosted workflows | Run links recorded after publishing the development branch. |

The automated Home contrast audit reports both text beneath iOS 26's translucent bars and visibly black paragraphs on an opaque system background. **Home contrast is excluded from the automated audit and reviewed visually; this is a known automation coverage limitation.** Other Home audit types remain enabled, and the other audited screens retain all issue types. Map contrast is audited with one fully visible filtered result; the full 393-record map/list is exercised separately. Largest accessibility text, light/dark screenshots and actual control reachability are additional checks, not a claim of complete human VoiceOver review.

Repairs found during verification include filter reset while Map was unmounted, reconnect backoff waiting behind a longer regular timer, list/map camera recreation, search dismissal while the keyboard is active, numeric fuzzy searches returning adjacent numbered parks, clipped large-text summaries and low-contrast/short-hit-area controls. An overlapping local simulator audit run caused a test-host interruption; interrupted runs are not counted as successful overall runs.

### Timing evidence

Measurements use the app's separate monotonic local-ready and cover-dismissal timings. They exclude process launch before `StartupModel.start`; simulator timings are not a physical-device or cellular benchmark.

Final timing values are recorded after device verification. A completed iPhone 17 Pro unit run accepted, validated, saved and indexed the 5,000-record HTTP fixture and checked its filtered result in **389 ms**. This is a local loopback measurement, not a live spreadsheet publication measurement.

### Reproduce checks

From the repository root, start `node 05-tools/scripts/serve-ios-catalog.js` in a separate terminal. It serves public/synthetic fixtures only. Then run:

```sh
swift test --package-path 01-code/ios/Packages/BarkDomain
NODE_ENV=test node --test 01-code/functions/tests/native-catalog.test.js 01-code/functions/tests/catalog-publication-script.test.js
npm test --prefix 01-code/functions
node --test 03-tests/firebase-project-isolation.test.cjs

BARK_PHASE2_CHECK=$(mktemp -d /tmp/bark-phase2-check.XXXXXX)
xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath "$BARK_PHASE2_CHECK/DerivedData" \
  CODE_SIGNING_ALLOWED=NO SWIFT_TREAT_WARNINGS_AS_ERRORS=YES build-for-testing
xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath "$BARK_PHASE2_CHECK/DerivedData" \
  -resultBundlePath "$BARK_PHASE2_CHECK/Results.xcresult" \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test-without-building
xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$BARK_PHASE2_CHECK/Release" \
  CODE_SIGNING_ALLOWED=NO SWIFT_TREAT_WARNINGS_AS_ERRORS=YES build
```

Change the destination to the available **BARK iPhone SE 3** for smaller-screen checks. Do not run two UI test sessions on the same simulator simultaneously. UI tests use UUID-scoped Debug preference suites; relaunches within a test reuse their suite.

## Your testing checklist

Open `01-code/ios/BarkRanger.xcodeproj`, select **BarkRanger → iPhone 17 Pro**, and press **Command-R**.

1. Open **Map**. Expect 393 parks, native pins/clusters and the same count in **Results list**. Zoom/pan, switch between map/list, and confirm the position stays sensible.
2. Search **hulls cove**, open Acadia's details, and inspect the source fields. Try an abbreviation, then a nonsense query. Clear filters to return to all parks.
3. Combine **National** and **Tag** filters, leave/relaunch the app, and confirm they persist. Reset device preferences from Home → Settings and confirm Map updates too.
4. Choose **Offline overview** in Settings. Expect the bundled outline, pins and searchable records without requiring street imagery. Test an actual device in airplane mode once signing is available.
5. Tap **Locate me**, deny permission and keep browsing. Open **Directions in Apple Maps**, then return to Bark. The same park details should remain open.
6. Try light/dark appearance and the largest accessibility text size. Scroll Home, filters and details; check that Done, Clear and Directions remain reachable.
7. For online-update testing, start the local fixture server, then add `BARK_CATALOG_URL=http://127.0.0.1:8787/active/manifest.json` in **Edit Scheme → Run → Arguments → Environment Variables**. Use the [runbook's scenario commands](../../operations/NATIVE_CATALOG_PUBLICATION.md#reproduce-locally). The `valid` case updates; `slow`/`stalled` keep loading bounded; malformed/shrunk/hash-mismatched data retain accepted parks. Settings → Check for updates requests the same shared refresh.

Removing the local endpoint returns to saved/bundled-only mode; a newer accepted fixture remains saved, by design. The fixture's synthetic source label distinguishes it from live data. Do not use a 5,000-record fixture in a build intended for ordinary park-content testing.

## Code size and remaining prerequisites

Physical source lines include comments/blank lines and exclude generated builds, resource data, assets and documentation.

| Group | Files | Lines |
|---|---:|---:|
| App + domain runtime Swift | 37 | 2,453 |
| App/UI/package test Swift | 6 | 731 |
| New backend catalog JavaScript | 4 | 297 |
| New backend/script test JavaScript | 2 | 221 |
| Local fixture/build scripts + Apps Script source | 4 | 183 |
| Native project/package/configuration + two CI workflows + Apps Script manifest | 11 | 838 |

The largest Swift runtime file is **164 lines**. Phase 1 had 509 runtime lines; phase 2 adds a net **1,944 runtime Swift lines** and real catalog/discovery behavior. The retained backend registry gains 12 net physical lines. **Old web/backend runtime lines removed: 0.** No deployed cost reduction or final replacement saving is claimed while both apps remain supported. Retirement and the final line-cut comparison come after the replacement and separately approved rollout.

Remaining prerequisites: actual iOS 18.4 runtime and physical-device signing/trust; live public-asset/source/trigger configuration and provider checks; human VoiceOver review; native legal/privacy/App Store disclosure review before release. These do not authorize moving users or starting the next phase. The next step is user testing and Phase-2 fixes.
