# Phase 2 — catalog and discovery

September 10, 2026. Current build **0.2.9 (11)** keeps a stable low/medium selected-pin position, enlarges selected pins slightly and uses a brisk reversible search/tab transition. It retains 0.2.8, which corrects the returning tab-bar position, prevents ungrouped pin collision hiding, isolates development/test storage and removes marker rescans caused only by result order. It retains 0.2.7 sheet-versus-content scrolling, coordinated search/tab travel and local-preference corrections. It retains 0.2.6 native camera gliding, grouping-setting fixes, low/medium browsing height and lower selected-pin placement. It retains the 0.2.5 selection, background-result, marker-invalidation and catalog-diagnostic corrections. Original 0.2.0 implementation commit `4084569`, verification/string-catalog follow-up `ba8aa68`, on `codex/ios-native-setup`, GitHub destination `USBarkRangers/USBarkRangers`. Phase 2 implementation is complete and is **awaiting user testing**, with the verification limits below. User acceptance remains pending. Phase 3 has not started.

## What you can use

The app opens without an account, with **393 real bundled park records**. The full-screen map and live search dropdown share one search/filter result. A wide search field, live matching/total count and trailing filter button float over the map; no Map title, count/status header or Map/Results switch takes up the screen. Typing and scrolling results keep the keyboard open. Active search/category/swag filters appear directly under the field as individually removable chips. Search is local, including retained abbreviations, diacritics and bounded spelling tolerance. Category and swag filters persist through relaunch. Details show every supplied field, including fees, swag locations, approved trails, restrictions, hazards, extra swag and approved source links. Directions open Apple Maps; Locate Me requests permission only when tapped.

Pins now reuse the approved black BARK badge or blue tag artwork; larger dark cluster capsules pair that badge with the exact native member count. Touching the map collapses search without clearing text, chips, counts or matching pins; tapping the field restores current results, including an empty result. The native map reuses annotations and preserves selection, filters and camera across accepted updates. Native clustering avoids a custom clustering engine. The bundled Natural Earth outline and an opaque local background provide a geographic overview without downloaded imagery; local results/details remain available. Detailed Apple street imagery and Apple Maps routing are separate provider capabilities and are not guaranteed offline by Bark.

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
| Discovery | The original 16 implemented files are: `MapFeatureModel`, `MapScreen`, `NativeMapView`, `MapCoordinator`, `ParkAnnotation`, `ParkAnnotationView`, `ParkClusterView`, `MapOverlayRenderer`, `FilterSheet`, `FilterSummaryView`, `SearchModel`, `MapSearchBar`, `MapSearchResults`, `FilterChipsView`, `ParkDetailModel`, `ParkDetailView`. The old `SearchSheet` is removed. The detail-sheet follow-up adds `ParkSheetPosition`, `ParkDetailSheet`, `ParkDetailActions`, `ParkDetailMetadata`, `ParkThumbnailStrip`, `ParkDetailContent` and `MapSelectionFraming`; the implemented call map documents each. |
| Home/settings | Extend `HomeView`; add `SettingsModel` and `SettingsView`. Views render and forward actions. |
| Resources | Public catalog/manifest/provenance, local land geometry/tile, education, retained legal text, approved community links and attribution. |
| Local backend | Four catalog files: source adapter, schema, publisher, trigger handlers. The small registry/admin-write integration is in the retained `index.js`. |
| Tools | Reproducible catalog/content builders, local scenario server, and separate Apps Script edit-signal source. |
| Verification | Domain/app/UI tests plus publication/script tests; native iOS and catalog GitHub workflows. Neither workflow deploys. |

The [publication runbook](../../operations/NATIVE_CATALOG_PUBLICATION.md) maps backend calls, local fixtures, eventual configuration and rollback. A deliberate refinement keeps the old CSV/fallback writer as its existing owner: native publication adds no second writer to old fallback storage. The public asset publisher uses immutable upload followed by a generation-conditioned manifest promotion. Memory adapters verify ordering/conflicts locally; they do not certify cloud IAM or actual storage preconditions.

## Stable browsing anchor and brisk controls — 0.2.9 (11)

Low and medium now reserve the same medium-height map space when initially framing a selected park. MapSelectionFraming no longer treats a low/medium detent change as a reason to pan. The selected coordinate stays at the same screen point through the drag, settled transition and return, preserving zoom/heading and deliberate map pans. New park selection, coordinate corrections and actual geometry changes still reframe normally. High retains its full-detail behavior.

Selected pins use a restrained **1.12 scale**, keeping the existing artwork, states and canonical identity. Deselection and reuse restore normal scale; the prior ungrouped visibility fix and cluster styling remain intact.

Crossing **eight points above medium** starts a **0.22-second ease-in/out** slide: search up, tabs down. The slide finishes even when the finger pauses just above medium. Returning below that threshold reverses from the current visible position. The native tab owner changes rendered contents only, preserving the resting frame/safe areas and restoring native interaction on dismissal/tab changes. Reduce Motion uses a fade. There is no new settings switch, task, observer, presentation manager or runtime file.

Current source count: **50 files / 3,501 lines** (+23 from 0.2.8). Discovery has 24 files; MapScreen is 141 lines, MapSelectionFraming 48 and MapTabBarTransition 90. The change remains entirely within Discovery presentation and its regression tests.

Verification:

- All **49 app test functions** passed in `/tmp/BarkStableAnchorFinalNative.xcresult` (40 Swift Testing and 9 native XCTest); **11 domain tests** passed. The rendered-animation test attaches to a real UIWindowScene, waits for appearance/rendering, reverses mid-slide and checks cleanup. It also checks that unchanged layout does not alter the bar’s resting frame. Log: `/tmp/bark-stable-anchor-native-final.log`.
- The short held-drag UI regression passed (`/tmp/BarkStableAnchorShortDrag.xcresult`), and its recording `/tmp/bark-short-chrome.mov` was visually checked: after a small lift above medium, both controls finish leaving while the finger pauses, then return as the sheet settles back. Selected-pin position remains fixed during the low-to-medium portion.
- On iPhone SE 3, pin-to-pin selection with the shared low/medium anchor and repeated scrolled-high tab restoration passed (`/tmp/BarkStableAnchorSEFinal.xcresult`). Six iPhone 17 Pro interaction scenarios also passed (`/tmp/BarkStableAnchorUI.xcresult`): grouping toggles, search gestures, pin switching/anchor stability, sheet-body scroll boundaries, repeated high-scroll restoration and all three detents. Together with the short held-drag case, this is nine UI runs across both screen sizes.
- Debug and Release builds passed with Swift warnings treated as errors; formatting/diff checks passed. Logs: `/tmp/bark-stable-anchor-build.log`, `/tmp/bark-stable-anchor-release.log`.
- At 393 and 5,000 records, the 300-update geometry regression and same-membership result-reordering regression still produce zero marker lookups or add/remove calls. Background projection medians were 3.12–4.27 ms / 13.45–31.17 ms; MainActor heartbeat progress remained present. Physical-device/minimum-iOS and Instruments certification remain separate checks.

User acceptance: select a park at low, drag to medium and back (pin should stay put), compare selected/unselected badge size, then make a small lift past medium and pause before reversing. Both controls should finish their quick departure and return without changing the camera or leaving the tab bar raised.

## Focused interaction and pre-Phase-3 corrections — 0.2.8 (10)

- Tab movement changes only rendered sublayers, not the native layout frame. Repeated high-detail scrolling/collapse therefore keeps the bottom bar at its original resting height. Search/tabs continue moving together; the system Reduce Motion behavior and other-tab restoration are preserved.
- With grouping off, all ungrouped markers use required display priority. Zooming out cannot hide them merely because they collide. Grouping on retains the existing native clusters; IDs, reuse, selection, filters and camera policy remain intact.
- Search results retain their list order, but marker invalidation compares membership and catalog revision. A different order of the same matching parks does no annotation reconciliation.
- Debug-only AppSandbox gives tests/previews independent catalog caches/preferences and inert location/Maps/Settings actions. The Test scheme isolates the host; UI tests use BARK_TEST_SCOPE and loopback fixtures. Release contains no sandbox implementation or test-entry override. The normal app retains real Maps/Location/Settings behavior.
- Relevant regressions now inspect actual native marker membership/visibility, assert the precise timeout error and await observed completion instead of fixed catalog/lifecycle sleeps. App-level isolated-store cleanup awaits shutdown even after a thrown test failure.

The source count is 50 files / 3,478 lines (+87), including the 45-line Debug-only sandbox. Discovery remains 24 files / 1,515 lines (+8). The [current maintainability review](FOLLOWUP_MAINTAINABILITY_AUDIT_2026-09-10.md) finds no remaining cleanup blocker to Phase 3; there is no Phase 3 implementation in this patch.

User acceptance checks:

1. Open a park at medium, expand high, scroll the details, and drag the handle back to medium/low several times. The bottom tabs return to their original height and remain tappable; dismissing or switching tabs restores them too.
2. Turn “Group nearby pins” off. Zoom repeatedly out and in over a dense area: pins remain visible instead of silently disappearing. Some badges will overlap at wide zoom. Turn grouping on again and confirm clusters return.
3. Recheck search/filter preservation, switching between pins at low/medium, Park Info, normal-app Apple Maps handoff and settings persistence. Repeat the sheet interaction with iPhone Reduce Motion enabled.

Completed verification:

- 11 domain test functions passed (`/tmp/bark-phase2-fixes-domain.log`).
- All 48 app test functions passed: 40 Swift Testing + 8 native XCTest (`/tmp/BarkPhase2FixesNative.xcresult`, then final test-harness revisions in `/tmp/BarkPhase2FixesFinalNative.xcresult`). The final run used the small-screen simulator; the first used iPhone 17 Pro.
- Nine iPhone 17 Pro UI scenarios passed (`/tmp/BarkPhase2FixesUI.xcresult`): grouping toggles, pin-to-pin selection, search gestures, sheet body dragging, repeated scrolled-high collapse, three detents, exposed-map dismissal, dark landscape and settings persistence/reset. Two sheet regressions also passed on iPhone SE 3 (`/tmp/BarkPhase2FixesSE.xcresult`). High/medium screenshots from both sizes were visually inspected. The UI runs used identical runtime Swift sources before the version-only bump/final test cleanup.
- Debug test build and Release build passed with Swift warnings treated as errors; strict formatting and diff checks passed. Logs: `/tmp/bark-phase2-fixes-build-final.log`, `/tmp/bark-phase2-fixes-release.log`.
- At 393 and synthetic 5,000 records, changed result ordering caused **zero annotation lookups/add-remove calls** while actual native membership and canonical objects stayed unchanged. A separate 300-update sheet-geometry pass also caused zero marker work (44.60/48.13 ms aggregate Debug time). Off-MainActor projection medians were 2.94–4.07 ms / 12.32–28.12 ms respectively, with MainActor heartbeat progress throughout. These are regression observations, not hardware frame-rate or allocation certification.
- Version 0.2.8 (10) was installed/launched normally on iPhone 17 Pro after test completion, with normal native app configuration rather than a sandbox launch.

Physical-device/iOS 18.4, Instruments, human VoiceOver and hosted-CI verification remain uncompleted release checks. No claim is made that this patch tests unimplemented account/provider isolation; Phase 3 must extend the now-isolated construction boundary before attaching those providers.

## Sheet motion and settings reliability — 0.2.7 (9)

Below high, a vertical body drag now resizes the sheet without also scrolling its contents. Native vertical scrolling is enabled only at the settled high position when the gesture is not resizing. Horizontal tags/actions/thumbnails explicitly retain their own scrolling environment. Removing scroll-to-top resets at live content thresholds eliminates the scroll-then-correct effect. The existing high-detail scroll, top-edge collapse, handle resizing, cancelled-drag cleanup, dynamic text and working actions retain their owners.

Between medium and high, actual measured sheet height supplies one clamped progress value. Search/chips travel upward; the existing native tab bar travels downward at the same time, including while the finger is held down. Reverse movement restores both. System Reduce Motion substitutes fading for those translations. The native bar's safe area stays stable. A 62-line MapTabBarTransition bridge applies only presentation properties through the parent UIKit controller and restores them when Map disappears or dismantles; it cannot keep changing another tab while inactive. It introduces no navigation store, observer, timer or duplicated preference.

The settings review found and corrected these concrete issues:

- Older or partly unsupported saved values could make synthesized decoding reject the entire settings document. AppSettings and filter Query now default missing/unsupported fields individually, retaining recognized choices and existing sanitization.
- A prior map imagery failure could leave appearance changes stuck in offline overview. Explicit appearance changes while connected now allow a native imagery retry; disconnected/offline-overview behavior still applies.
- Distance units were persisted but no implemented distance display used them. The control is visibly unavailable with a short explanation; existing stored values are retained for future consumers. No fake distance behavior was added.

One typed device settings value and one repository remain appropriate for the current and planned map preferences. New fields need compatible defaults, validation, a real consumer, and persistence/invalidation regressions. Feature owners react to relevant values; buttons do not coordinate multiple systems. Reset clears saved preferences/filters/camera without commanding an immediate viewport jump. Account preferences and entitlements must remain separate from this device store. See the [updated code-health audit and growth priorities](FOLLOWUP_MAINTAINABILITY_AUDIT_2026-09-10.md) and [preference implementation contract](../../../01-code/ios/ARCHITECTURE.md#adding-a-device-preference).

Verification:

- Final Debug and Release builds passed with Swift warnings treated as errors. All **11 domain test functions** and **45 app functions** passed (38 Swift Testing functions and seven native XCTest cases). New cases cover per-field saved-data compatibility, successive edits/relaunch/reset, camera opt-out, native appearance/overview recovery, no extra query work, intermediate tab travel, reduced motion and inactive-map restoration.
- All four Pro sheet scenarios passed: body dragging then high scrolling/tab recovery, three detents, exposed-map dismissal and dark landscape reachability. The final Settings UI relaunch/reset and disabled-distance-control checks pass, as does the repeated grouping-setting scenario on this build (`/tmp/BarkSheetSettingsFinalUI.xcresult`).
- A native view-hierarchy regression verifies the outer vertical ScrollView is disabled while all three horizontal rows (tags, actions, thumbnails) remain enabled. That final nested-scroll correction and the body-drag UI pass are in `/tmp/BarkSheetScrollBoundary.xcresult`. The extended final body test also verifies high-to-medium collapse from the title area, re-expansion, high scrolling and tab recovery (`/tmp/BarkSheetBodyFinal.xcresult`).
- The iPhone SE 3 simulator passes the new body-drag/high-scroll/tab-restoration case and largest-accessibility-text search/details (`/tmp/BarkSheetSettingsSE.xcresult`).
- The held-body-drag recording shows title/actions remaining at the content top while the card resizes. Frame sequences show search moving up and tabs down together before finger lift. Evidence: `/tmp/bark-sheet-chrome-drag.mp4`, `/tmp/bark-sheet-chrome-start.png`, `/tmp/bark-sheet-chrome-progress.png`.
- For 393 and 5,000 records, 300 geometry updates still cause **zero marker lookups and zero annotation additions/removals**. Debug totals: 43.43 ms and 46.43 ms. Background query medians: 3.08–4.39 ms and 12.67–30.28 ms; the concurrent MainActor progress check advances. This is not a physical-device frame-rate or memory-allocation certification.
- Strict formatting passed across runtime/test Swift source, and whitespace checks passed. The unchanged package manifest has a pre-existing trailing-comma lint discrepancy when linted as well; it was left outside this focused runtime/test change.

Evidence: `/tmp/BarkSheetSettingsRegression.xcresult`, `/tmp/bark-sheet-settings-domain.log`, `/tmp/bark-sheet-settings-final-build.log`, `/tmp/bark-sheet-settings-release-final.log`, `/tmp/bark-sheet-settings-format.log`. The full regression run preceded the disabled-distance-control clarification and two-line nested-scroll override; each received the focused follow-up checks above. The final counts combine those runs, rather than claiming one all-tests run on the final binary. No actual iOS 18.4 runtime, physical device or hosted-CI certification is claimed.

User check: slowly drag upward from the park title/actions area, hold between detents, then reverse. Content should stay at the top until high; search and tabs should leave/return in opposite directions together. At high, scroll the facts, then close and switch tabs. In Home → Settings, change appearance/grouping, toggle remembered position, relaunch, and reset. Repeat motion with iPhone Reduce Motion enabled.

## Native camera glide — 0.2.6 (8)

Pin-to-pin selection uses MapKit’s native animated center movement while preserving zoom/heading. SwiftUI’s system Reduce Motion value controls the glide and cluster zoom; the sheet already uses it. There is no second stored motion preference, custom animation manager or delayed selection callback. Search-result focus retains its existing explicit zoom behavior. Framing accounts for the map’s inset center as safe-area and attribution margins change during animation, preventing an offset from being applied twice.

Low and medium retain the height the user chose when another park is selected. Low places the pin in the lower part of the visible map; medium places its anchor roughly 40 points above the sheet. Framing uses the settled detent rather than chasing every live drag frame. High continues to use the full detail area; closing high returns to compact browsing. A corrected coordinate for the same selected ID also invalidates framing, resolving that smaller follow-up audit finding.

Changing **Home → Settings → Group nearby pins** re-registers the same canonical annotations under the new policy. This makes the change apply to members already hidden in clusters as well as currently visible pins. A selected park remains an individual pin with required display priority. Selection changes touch at most the previous/new grouping participants; grouping changes intentionally reconcile the result set. Expanding a cluster releases the old park selection before native zoom. IDs, catalog/search/filter authority and annotation reuse remain intact.

All changes stay in existing Discovery presentation files. There is no new runtime file or account/sync work. The [updated growth-priority ranking](FOLLOWUP_MAINTAINABILITY_AUDIT_2026-09-10.md) distinguishes corrected map defects from the remaining order-only marker rescan, provider-test isolation gate, optional file colocation and profiling watchpoints.

Verification for 0.2.6:

- Debug and optimized Release builds pass with Swift warnings treated as errors. Nine domain test functions and all **41 app test functions** pass (36 Swift Testing functions and five native-map XCTest cases). Selection/Directions agreement, stale completion guards, effective-input computation counts and fixed catalog diagnostics remain covered.
- The new Settings regression fails against the unchanged 0.2.5 runtime: switching grouping off leaves native clusters. The corrected runtime passes four off/on transitions, then two more with a selected park, checking actual cluster presence, selected-pin visibility, retained details and result counts. The selected pin uses the same canonical annotation instance. Testing also caught an intermediate MapKit crash caused by changing an attached member's clustering identifier; the final code removes members first and configures their new policy when requested again.
- The final pin-to-pin UI regression passes: both directions preserve pin separation (zoom), update the displayed/selected park, retain medium then low for the next park, place medium within 10–65 points and low within 10–190 points of the handle, and dismiss/deselect on background tap without clearing search. Its setup waits for observed native pin positions to settle; XCTest application-idle alone does not guarantee MapKit animation completion.
- The controlled location test double no longer accepts real authorization delegate notifications. Those notifications caused a request-count timeout unrelated to the map patch. Both cancellation tests pass after isolating callbacks; LocationClient runtime code is unchanged.
- The iPhone SE 3 simulator passes sheet low/medium/high visibility/restoration and largest-accessibility-text search/details. Earlier in this patch, all four Pro Discovery scenarios and all three sheet scenarios passed; the final grouping-order correction was followed by the extended grouping and map-touch regressions on Pro and these two SE checks.
- For both 393 and 5,000 records, **300 geometry updates cause zero marker lookups and zero annotation additions/removals**. Debug totals are 43.26 ms and 46.62 ms. Background query medians are 3.06–4.32 ms and 12.59–30.24 ms respectively; a concurrent MainActor progress task advances in every case. Repeated geometry updates also produce no extra camera command in the dedicated coordinator test.
- A simulator recording shows intermediate native map/pin positions during the glide at unchanged zoom. The deterministic test separately verifies ordinary versus system-reduced-motion animation policy and rapid retargeting to the latest selection. Simulator observations are not physical-device frame-rate, minimum-iOS-18.4 or Instruments certification.

Evidence is split across focused runs, not one all-green run: `/tmp/BarkGroupingBaseline.xcresult` is the expected baseline failure; `/tmp/BarkMapInteractionFinal.xcresult` contains the passing grouping/map-touch scenarios but also a superseded pin-test setup failure and the location-test isolation failure; `/tmp/BarkMapPinDetentVerified.xcresult` contains the final 41 passing app functions but a superseded UI timing failure. `/tmp/BarkMapPinSettlingVerified.xcresult` is the final passing pin-selection/detent run; `/tmp/BarkMapSmallScreenVerified.xcresult` is the passing SE run. All new interaction regressions therefore have passing results on the final runtime. Strict formatting and whitespace checks pass. Earlier Pro Discovery/sheet passes are in `/tmp/BarkMapFinalRegression.xcresult`; its two new interaction failures were subsequently corrected. Build/domain logs: `/tmp/bark-map-release-final.log`, `/tmp/bark-pin-glide-domain.log`. Visual glide evidence: `/tmp/bark-native-glide-proof.png` and its source recording under `/tmp/bark-grouping-verified-images/`.

User check: toggle **Home → Settings → Group nearby pins** off/on several times, including with a selected park. On Map, select a park, drag to low or medium, and select a different visible pin. The chosen height should persist, the map should glide at the same zoom, and medium should place the selected pin just above the card. Repeat with iPhone Reduce Motion enabled. Search text, filters and counts should remain unchanged.

## Focused maintainability corrections — 0.2.5 (7)

The requested audit corrections are implemented without starting Phase 3. SearchModel’s duplicate mutable query is removed. SettingsRepository remains the editable query/filter authority; ParkDetailModel.park remains the selection authority. Directions captures the displayed Park synchronously and owns its cancellable handoff task. Selection changes, dismissal and background stop invalidate queued work and obsolete completion/error state.

One revision/query gate owns asynchronous result projection. `ParkResults.compute` explicitly leaves MainActor and produces one immutable count/list/pin projection; old completions cannot overwrite newer input. Camera, distance units, map style, clustering, status-only changes and unchanged filters do not rerun matching. MapCoordinator reconciles annotations only when the published catalog/matching IDs or clustering actually change. Sheet/camera geometry updates return through the annotation gate without scanning parks or reconfiguring markers. Native annotation identity, clustering and existing UI behavior are retained.

Catalog read, decode, validation, transport, timeout, throttling, storage and cancellation failures now produce fixed local reason/stage codes. No raw URL, query, user identifier or error description enters the logger. The existing simple saved-data fallback is unchanged. Error classification stays with the catalog owners; Diagnostics does not refer back to services.

The task review also closes related lifetime gaps: queued manual refresh has a SettingsModel owner; foreground startup/polling waits for the preceding catalog cancellation; repository completion clears only its own request; startup rechecks cancellation after its actor read; location cancellation carries its request identity and old locate cleanup cannot clear a replacement.

The [rerun maintainability audit](MAINTAINABILITY_AUDIT_2026-09-10.md) records the corrected findings, current sources of truth, remaining non-blocking work and revised scores. **No architecture blocker was found before Phase 3.** Optional view-file colocation and small bundled-read housekeeping were left alone. Accounts, sync, visits, trips, scoring and purchases remain unimplemented.

Verification:

- Final Debug and optimized Release builds passed with Swift warnings treated as errors. Release used `-O -whole-module-optimization`; ENABLE_TESTABILITY was enabled solely to run internal regression measurements.
- Nine domain functions passed. All 39 app tests passed: 36 Swift Testing functions plus three native map XCTest cases. New coverage includes exact computation counts, controlled late completions, selection/catalog-refresh/directions agreement, stale handoff failure, queued manual refresh, rapid foreground restart, catalog diagnostic categories/fallback and location cancellation/replacement.
- Nine relevant Pro UI scenarios passed: navigation/relaunch/background return, live search/count/pins, persisted filters, largest text, location denial/Apple Maps return, map gestures, sheet detents, dark landscape details and exposed-map dismissal. The navigation/lifecycle scenario passed again after the last lifetime guard changes. Existing Home-wide accessibility audit and SE geometry checks were not rerun for this nonvisual correction; their prior evidence remains below.
- Strict formatting checked every runtime and test Swift file; whitespace checks passed.
- For both 393 and 5,000 records, 300 sheet-geometry updates made **zero marker lookups and zero annotation add/remove calls**. Debug totals were 45.99 ms and 57.53 ms respectively (about 0.15/0.19 ms per update). Real filter, catalog and clustering changes still reconcile and retain annotation objects.
- Five samples for empty, broad, specific, no-match and exact-synthetic queries measured background projection medians of 3.15–4.43 ms for 393 records and 12.99–29.30 ms for 5,000 in Debug. A concurrent main-actor progress task advanced in every case. These are simulator measurements; initial MapKit rendering remains native main-actor work and physical-frame-rate performance is not certified.

Optimized Release verification also passed the two count cases. Per-query medians were **1.52–2.26 ms (393 records)** and **6.74–15.73 ms (5,000 records)**; largest individual samples were 3.02/17.00 ms, off MainActor. Evidence: `/tmp/BarkCleanupReleasePerformance.xcresult` and `/tmp/bark-cleanup-release-performance.log`.

Local evidence: `/tmp/BarkCleanupComplete.xcresult`, `/tmp/BarkCleanupUIVerified.xcresult`, `/tmp/bark-cleanup-complete.log`, `/tmp/bark-cleanup-ui-verified.log`, `/tmp/bark-cleanup-build-complete.log`, `/tmp/bark-cleanup-release.log`, `/tmp/bark-cleanup-domain.log`, `/tmp/bark-cleanup-format.log`. The earlier `/tmp/BarkCleanupUIFinal.xcresult` was deliberately interrupted after a test-build issue and is not passing evidence. Final source uses Debug derived data `/tmp/BarkFocusedCleanupFinal` and Release `/tmp/BarkFocusedCleanupRelease`.

Reproduce with the fixture server and commands below. Select `BarkRangerTests` for app regressions; select DiscoveryUITests, MapInteractionUITests, ParkDetailSheetUITests and AppShellUITests/testTabsSheetAndRelaunch for the relevant UI run. Optimized measurements select `BarkRangerTests/DiscoveryPerformanceTests/projectionTimingsAndMainActorResponsiveness(count:)` with configuration Release and ENABLE_TESTABILITY=YES. No fixture server is needed for that synthetic projection timing test. Do not run concurrent UI sessions against the same simulator.

User check: type and edit a search, toggle filters, reset preferences from Home → Settings, and verify count/list/pins agree. Change units or move the map; matching results should stay the same. Change selected parks quickly and use Directions; close/reopen details and drag the sheet. Background/foreground the app during a local fixture update and confirm saved parks remain usable and subsequent refresh still works.

## Sheet and selection refinements — 0.2.4 (6) — historical behavior

The high sheet now stops at the search bar’s outer top edge, leaving the upper map visible and tappable. Tapping map background dismisses details and clears the pin highlight while retaining the query, filters and result count. Individual pin selection keeps the current zoom; selecting a search result retains the existing camera-focus behavior. Cluster taps keep their existing zoom behavior.

Search and the native bottom tab bar disappear as the live sheet height passes medium, before the drag ends. The measured tab overlap is retained while details are open so hiding the bar cannot move the detents during a gesture. Keyboard spacing is excluded from that retained measurement. Low still contains the single-line name and working Directions/Park Info actions; medium still shows the selected pin above the sheet.

Individual artwork is slightly smaller (38×46-point visual badge inside the existing 44×54-point annotation bounds). IDs, touch targets, anchor, native clustering, cluster-pill styling and state colors are retained. Category, swag type and supplied cost now appear together in rounded rectangular tags. The repeated high-detail Swag section is removed; no supplied information is lost. Thumbnail placeholders and the data/catalog architecture are unchanged.

The related selection fix also resolves the audit’s strongest correctness finding: `detail.park` is the authoritative selection, supplied synchronously from the accepted snapshot. `selectedID` derives from it, and dismissal clears it. There is no second asynchronous detail read or queued detail-load task. A regression test verifies immediate A→B selection/detail/Directions agreement, native-pin zoom preservation, and deselection after stop. The [maintainability audit](MAINTAINABILITY_AUDIT_2026-09-10.md) preserves the original findings and adds a ranked, current cleanup decision. Broad audit refactoring has not been performed.

Final Debug and Release builds passed with Swift warnings treated as errors; strict formatting and whitespace checks passed. All nine domain tests passed. All 25 final Pro app tests (22 Swift Testing functions and three XCTest cases) and all eight relevant UI tests passed across the final regression and sheet runs. The three sheet tests cover: detent layout/restore, map-background dismissal/deselection, and dark landscape detail-link reachability. A simulator recording of the held upward drag confirms the tab bar is already hidden while the finger is still down. No automated contrast certification, physical-device result, minimum-iOS-runtime result or new hosted-CI result is claimed.

Local evidence: `/tmp/BarkDetailRefinementSheetFinal.xcresult`, `/tmp/bark-detail-refinement-build-final.log`, `/tmp/bark-detail-refinement-release.log`, `/tmp/bark-detail-refinement-domain.log`, `/tmp/bark-detail-refinement-format-final.log`, and `/tmp/bark-detail-refinement-final.mp4`. Sheet captures are in `/tmp/bark-refinement-sheet-final-images/`. The final regression evidence is `/tmp/BarkDetailRefinementRemainingFinal.xcresult` and `/tmp/bark-detail-refinement-remaining-final.log`. All four selected SE 3 checks passed: the three sheet scenarios plus largest-text search/details. Evidence: `/tmp/BarkDetailRefinementSEFinal.xcresult` and `/tmp/bark-detail-refinement-se-final.log`; captures are under `/tmp/bark-refinement-se-final-images/`. Landscape rendering was additionally inspected from simulator recordings, since the rotated app-only XCTest capture is cropped incorrectly.

Reproduction uses the existing fixture-server/project/scheme commands below with derived data `/tmp/BarkDetailRefinement`. Select `BarkRangerTests`, `BarkRangerUITests/DiscoveryUITests`, `BarkRangerUITests/MapInteractionUITests` and `BarkRangerUITests/ParkDetailSheetUITests`, with parallel UI testing disabled. Pro destination: `platform=iOS Simulator,id=3363BA1A-47D8-45F1-B1A1-CD7FEB8E2F40`; SE destination: `platform=iOS Simulator,id=A6B8C5BD-31C4-41F4-92BF-CF25F1A9AADA`.

User testing: tap a pin at your chosen zoom, drag low→medium→high while watching the bottom tabs, and confirm the sheet stops at the former search-bar top edge. Tap the narrow map strip to close and deselect. Reopen a pin and tap ordinary map background to dismiss. Check the compact category/swag/cost tags, both working actions, smaller marker styling and unchanged query/chips/count after dismissal.

## Park detail sheet — 0.2.3 (5) — historical behavior

The user's final layout replaces the initial all-detents-pin-visible concept:

- **Low:** one condensed park-name line, Directions and Park Info. Search remains visible, most of the map is exposed, and the sheet continues beneath the real bottom tab bar. Content fades toward the tab overlap.
- **Medium:** expanded name, supplied metadata/tags, the same actions and a horizontal strip of neutral 4:3 photo placeholders. Search/tabs remain visible. The selected badge is framed below search and above the sheet.
- **High:** the available screen belongs to park details, actions, placeholders and all existing facts/links. Search/map presentation and bottom tabs are hidden; no map band is reserved to display the selected pin. Close and the drag handle remain reachable while facts scroll.

The sheet lives inside Discovery so the actual native tab bar can sit above low/medium content. SwiftUI's drag gesture uses global coordinates, projected end translation and three geometry-derived snap heights with a spring (or no animation with Reduce Motion). The handle always resizes and has a larger touch area at high. Cancelled gestures reset temporary translation so the card cannot remain between detents. Body gestures resize low/medium and can collapse high from the top; scrolling farther down high stays normal. VoiceOver has an adjustable size handle. Dark-mode Directions uses a dark label on the existing light brand accent for readable contrast. Largest accessibility text opens high so the complete name/actions can scroll.

`Park Info` expands to the supplied full details. Directions uses the unchanged Apple Maps handoff and error state. Existing approved source website, picture and video links are retained. No visit, trip, check-in, recording or fake action is added. The 144×108-point placeholders use a system-neutral fill and photo icon, with no black asset backing, invented URL, download/cache or catalog field. Future real image content has one view owner to replace.

MapScreen assembles presentation; ParkDetailSheet owns drag/snapping; ParkDetailView composes the four small content views; ParkSheetLayout owns geometry; MapSelectionFraming owns only native viewport/attribution placement. Catalog/domain/search/filter models, ParkDetailModel, annotation IDs/reuse/clustering, pin artwork/states, backend and existing web code are unchanged. The implemented ownership/call map and README match these responsibilities.

Final Debug and Release builds passed with Swift warnings treated as errors; formatting/whitespace checks passed. The nine domain tests passed. The final iPhone 17 Pro run passed all 21 app/catalog tests, three map-presentation/framing tests and seven UI tests (four Discovery, retained map-touch behavior and both sheet scenarios). The UI run verifies low/medium search/tab visibility, a single-line low title with real actions, medium pin visibility, high search/tab hiding, snapping back through all positions, unchanged search/filter results after close, dark mode, scrollable landscape links and Apple Maps return.

The small-phone three-detent check passed after increasing the high grabber hit area and handling gesture cancellation. The earlier SE run passed largest text, Apple Maps return and dark landscape link/close reachability.

The raw contrast audit flagged a white-on-black heading and mint-on-charcoal Park Info label; inspected element captures show 21:1 and approximately 8.15:1 respectively. A subsequent SE audit inconsistently flagged a semantic metadata label as well. The unstable contrast assertion was removed from the functional landscape test instead of accumulating per-label exceptions. Contrast is assessed from the captured renders; no automated sheet-contrast pass is claimed. Human VoiceOver and physical-device review remain pending. The final SE dark/landscape functional rerun passed. The earlier raw SE contrast failures remain in `BarkDetailSheetSEFinal.xcresult` and `BarkDetailSheetSEAudit.xcresult` for transparency; their functional drag/landscape assertions passed.

Final local evidence: `/tmp/BarkDetailSheetComplete.xcresult`, `/tmp/BarkDetailSheetSEFinal.xcresult`, `/tmp/BarkDetailSheetSEAudit.xcresult`, `/tmp/BarkDetailSheetSEFunctional.xcresult`, `/tmp/bark-detail-complete-build.log`, `/tmp/bark-detail-functional-build.log`, `/tmp/bark-detail-complete-release.log`, `/tmp/bark-detail-domain.log` and `/tmp/bark-detail-format-final.log`. Screenshots are exported under `/tmp/bark-detail-complete-images/` and `/tmp/bark-detail-se-final-images/`. All evidence is local; no new hosted-CI result or physical-device certification is claimed.

Reproduction uses the project/scheme/fixture-server commands below, with derived data `/tmp/BarkDetailSheet`. The final Pro test selection was `-only-testing:BarkRangerTests -only-testing:BarkRangerUITests/DiscoveryUITests -only-testing:BarkRangerUITests/MapInteractionUITests -only-testing:BarkRangerUITests/ParkDetailSheetUITests`, `-parallel-testing-enabled NO`, destination `platform=iOS Simulator,id=3363BA1A-47D8-45F1-B1A1-CD7FEB8E2F40`. Small-phone runs use destination `platform=iOS Simulator,id=A6B8C5BD-31C4-41F4-92BF-CF25F1A9AADA`; the final functional rerun selects `BarkRangerUITests/ParkDetailSheetUITests/testDarkLandscapeKeepsFullDetailsReachable`.

User testing: choose a long-name park, check low's condensed title/actions and visible search/tabs, drag to medium and confirm tags/photos/pin, then expand high and scroll through real details/links. Drag back through both positions and close; the same query, chips and count should remain. Try Directions and return from Apple Maps, horizontal thumbnail/action scrolling, VoiceOver sizing, large text, dark mode and both phone orientations. The current bottom tab bar's appearance remains system-native.

## Map polish — 0.2.2 (4)

The old approved artwork is reused directly: national parks use `BarkBadge`, other categories use an unchanged `BarkTag` asset copied from `01-code/app/assets/images/bark-tag.jpeg`. `ParkAnnotationView` owns the rounded badge/ring (no pointer, softer corners and a thin border, with the existing 44×54-point size and anchor retained) and optional visited/in-trip accents; `ParkClusterView` owns the black logo/count capsule. Selection uses a gold ring. Visited green/check and in-trip purple/route states are presentation inputs with both flags false in Phase 2; no personal history or account feature is invented. The state examples are rendered in tests only. The exact canonical ParkAnnotation objects and the native `parks` clustering identifier remain in place. Larger visual footprints participate in MapKit’s normal collision layout; no custom grouping/counting algorithm is added.

`NativeMapView` installs one touch observer. The coordinator receives touch-down and declines gesture recognition, allowing MapKit to handle taps, pan, pinch and cluster zoom. It forwards a presentation callback to MapScreen, which dismisses focus and collapses results, including the empty state. Query, filter chips, result count, matching IDs and selected park are untouched. Tapping search immediately reveals the existing result; programmatic camera/catalog changes never invoke the touch callback. Search/filter/data repositories and the feature model are unchanged.

The implemented call map documents these owners; the largest changed runtime file is the 108-line coordinator. MapScreen is 96 lines, ParkAnnotationView 86, ParkClusterView 61 and the native bridge 35. This polish adds **147 net runtime Swift lines** and two runtime files. The separate presentation and interaction test files keep test responsibilities focused.

Verification: Debug and Release builds passed with Swift warnings treated as errors. The full 21 app/catalog checks and two annotation-presentation checks passed, including retained canonical annotation identity across a catalog update. All four existing Discovery UI checks and the existing light/dark accessibility audit passed on iPhone 17 Pro with the previously documented native-control exceptions unchanged. The new map-interaction check passed on both iPhone 17 Pro and iPhone SE 3: real cluster/pin taps, horizontal map movement, keyboard/dropdown collapse, unchanged query/chips/count/pins, restoration on focus and the zero-results case. Rendered badge states and cluster counts 2, 219 and 5000 were inspected; the final pointer-free badge keeps the same collision bounds/anchor and the cluster pill keeps its design.

Local evidence: `/tmp/BarkPhase2PolishFocused.xcresult`, `/tmp/BarkPhase2PolishRegression.xcresult`, `/tmp/BarkPhase2PolishFinalSE.xcresult`, `/tmp/BarkPhase2PolishBadgeFinal.xcresult`, `/tmp/bark-phase2-polish-build-edges.log` and `/tmp/bark-phase2-polish-release-edges.log`. The first two predate the final border-only refinement; the SE run verifies the pointer-free geometry and the final presentation run verifies the image edges. Screenshots are in `/tmp/bark-phase2-polish-final-attachments/` and `/tmp/bark-phase2-polish-badge-final-attachments/`. Temporary evidence is outside Git. This changes no backend, account, payment, old web source or live infrastructure. UIKit/MapKit API references: [annotation views](https://developer.apple.com/documentation/mapkit/mkannotationview), [gesture recognition](https://developer.apple.com/documentation/uikit/uigesturerecognizer).

## UI cleanup — 0.2.1 (3)

This follow-up changes presentation within Discovery and the shell’s per-tab navigation-bar visibility. `MapScreen` owns focus, layout and sheet presentation; three small child views own the search field, removable chips and scrollable dropdown. `MapFeatureModel`, `SearchModel`, the domain filter/index, catalog storage/transport, settings persistence and native map adapters are unchanged. The public catalog/backend are unchanged.

Keyboard focus stays in the persistent field through query edits, clear-search, chip removal and results scrolling. Selecting a result opens existing details and dismisses the keyboard. Submitting search dismisses the dropdown while retaining its filter. Opening filters or leaving Map also dismisses focus. Empty results keep the existing clear-filter action available. Large text uses a flexible scrollable dropdown above the keyboard.

The file/call map and UI tests follow this structure. The original 0.2.0 baseline table remains separate.

| Cleanup check | Completed evidence |
|---|---|
| Debug and Release | Final builds passed with Swift warnings treated as errors; formatting lint and whitespace checks passed. |
| App units | All 21 functions passed during this cleanup; catalog, model and persistence code did not change. |
| iPhone 17 Pro | Seven functional UI tests passed. The final focused light/dark accessibility audit passed with the exceptions below; the strengthened largest-text typing check also passed. These are separate successful checks, not a claim that the earlier full wrapper passed. |
| iPhone SE 3 | All four Discovery tests passed across the initial run and focused rerun: largest-text typing/results, removable/persisted filters, live count/dropdown/pin agreement, location denial and Maps return. An initial session returned duplicate accessibility elements and an unreachable control; after restarting the test device, both affected checks passed with no runtime changes. |
| Visual review | Full-map layout, live count/search, filter chips, light/dark presentation and largest-text small-phone search were inspected. |

Local evidence: `/tmp/BarkUICleanupCountPro.xcresult` (functional checks; superseded audit failure), `/tmp/BarkUICleanupAuditFinal.xcresult` (largest-text typing pass; superseded OCR audit failure), `/tmp/BarkUICleanupAuditVerified.xcresult` (final audit pass), `/tmp/BarkUICleanupSEFinal.xcresult` (two passing Discovery checks; initial simulator failures), `/tmp/BarkUICleanupSERetry.xcresult` (both affected checks passed), `/tmp/bark-ui-cleanup-pro.log` (21 app-unit functions passed), `/tmp/bark-ui-cleanup-build8.log` and `/tmp/bark-ui-cleanup-release-final.log`. Screenshot exports are in `/tmp/bark-ui-cleanup-count-pro-attachments/`, `/tmp/bark-ui-cleanup-se-final-attachments/` and `/tmp/bark-ui-cleanup-se-retry-attachments/`. These temporary machine-local artifacts are not committed.

The Map accessibility audit retains contrast, hit-area, text-size and description checks, with three explicit native-control exceptions: MapKit’s small Legal link; map-image OCR reports with no corresponding accessibility element; and the horizontally scrolling single-line search field’s large-text clipping warning. No other field or app-owned button is excluded. Tests verify the full accessible search value, live count/pin agreement, keyboard focus and selectable results at the largest text size; screenshots receive visual review. Native cluster-count glyphs are avoided by auditing one matching park; the full map is exercised functionally. Human VoiceOver review remains a release prerequisite. Existing Home contrast coverage limits remain as documented in the baseline.

## Original 0.2.0 verification evidence

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
| iPhone 17 Pro UI | All 7 UI tests passed across the full functional run and subsequent focused accessibility run. The full wrapper had an interrupted audit host; it is not reported as an overall pass. The focused final appearance/audit run exited successfully. |
| iPhone SE (3rd generation) | Overall run passed: 21 app-unit + 7 UI functions, 43 device cases, zero failures/skips on iOS 26.5. Map, offline overview, details and largest-text filter screenshots were inspected. |
| Hosted catalog workflow | [Passed on Node 22](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34444717992): 18 publication/script checks, deterministic bundle rebuild, 378 retained backend tests and 2 project-isolation tests. |
| Hosted native workflow | [Passed on implementation commit `4084569`](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34444717894): clean package/app build, all 21 app-unit functions and all 7 UI tests. The subsequent `ba8aa68` follow-up changes test launch ordering, extracted English strings and handoff documentation; its focused appearance test passed locally, and pushing it starts a fresh hosted rerun. Runtime Swift is unchanged. |

The automated Home contrast audit reports both text beneath iOS 26's translucent bars and visibly black paragraphs on an opaque system background. **Home contrast is excluded from the automated audit and reviewed visually; this is a known automation coverage limitation.** Other Home audit types remain enabled, and the other audited screens retain all issue types. Map contrast is audited with one fully visible filtered result; the full 393-record map/list is exercised separately. Largest accessibility text, light/dark screenshots and actual control reachability are additional checks, not a claim of complete human VoiceOver review.

Repairs found during verification include filter reset while Map was unmounted, reconnect backoff waiting behind a longer regular timer, list/map camera recreation, search dismissal while the keyboard is active, numeric fuzzy searches returning adjacent numbered parks, clipped large-text summaries and low-contrast/short-hit-area controls. An overlapping local simulator audit run caused a test-host interruption; interrupted runs are not counted as successful overall runs. A stale simulator appearance state also produced a light screenshot after requesting dark. After restarting the simulator, the final audit sets appearance before launching; the exported dark screenshot was visually verified as dark.

### Timing evidence

Measurements use the app's separate monotonic local-ready and cover-dismissal timings. They exclude process launch before `StartupModel.start`; simulator timings are not a physical-device or cellular benchmark.

| Simulator / actual captured launch | Local catalog ready | Loading cover dismissed |
|---|---:|---:|
| iPhone 17 Pro, initial composition in final app-unit run | 60.94 ms | 61.08 ms |
| iPhone 17 Pro, subsequent composition | 20.72 ms | 20.80 ms |
| iPhone SE 3, initial composition | 27.59 ms | 27.73 ms |
| iPhone SE 3, subsequent composition | 20.17 ms | 20.24 ms |

The default endpoint was unconfigured, so these measure validated local startup, not an online check. Small-phone 5,000-record acceptance measured 394 ms. A completed iPhone 17 Pro unit run accepted, validated, saved and indexed the 5,000-record HTTP fixture and checked its filtered result in **389 ms**. This is a local loopback measurement, not a live spreadsheet publication measurement.

Local evidence is outside Git: `/tmp/BarkPhase2FinalSE.xcresult` (overall pass), `/tmp/BarkPhase2FinalPro.xcresult` (passing unit/functional tests but interrupted audit host), `/tmp/BarkPhase2Appearance.xcresult` (final focused audit pass), `/tmp/bark-phase2-domain-final.log`, `/tmp/bark-phase2-backend-final.log`, `/tmp/bark-phase2-backend-regressions.log` and `/tmp/bark-phase2-release-final.log`. Screenshot exports are in `/tmp/bark-phase2-se-attachments/` and `/tmp/bark-phase2-appearance-attachments/`. Temporary machine-local evidence may eventually be cleared; CI retains its test bundle for seven days. Xcode's AppIntents metadata notices and simulator system accessibility/debugger diagnostics are distinct from Swift compiler warnings.

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

Xcode is already open with **BarkRanger → iPhone 17 Pro**, the implemented architecture tab selected, and the app running on the full 393-park map. The simulator is back in light appearance and test display preferences have been reset. To run again, open `01-code/ios/BarkRanger.xcodeproj` and press **Command-R**.

1. Open **Map**. Expect a full-screen map with native pins/clusters, a wide search bar, live matching/total count and a filter button on its right. Confirm there is no large Map title, count/status block or segmented switch. Expect BARK badge pins and larger black logo/count clusters. Tap a cluster to zoom and a pin to open details at the current zoom. Tap map background to dismiss details and deselect. Zoom and pan; the map stays behind the controls down to the tab bar.
2. Tap search and type **hulls cove** gradually. Results appear below search and update with the pins while the keyboard stays open. Scroll the dropdown, clear text, try a nonsense query, then select Acadia to inspect details. Submit search to dismiss the keyboard while retaining the filter. Then tap search again, touch or drag the map, and confirm the keyboard/dropdown disappear while the text, chips, count and pins remain. Tap search to restore matching results; repeat with zero matches.
3. Combine **National** and **Tag** filters and a search. Remove one chip with its × and confirm the others remain. Leave/relaunch the app and confirm remaining filters persist. Remove the search/category/swag chips to return to all parks. Reset preferences from Home → Settings and confirm Map updates too.
4. Choose **Offline overview** in Settings. Expect the bundled outline, pins and searchable records without requiring street imagery. Test an actual device in airplane mode once signing is available.
5. Tap **Locate me**, deny permission and keep browsing. Open **Directions in Apple Maps**, then return to Bark. The same park details should remain open.
6. Try light/dark appearance and the largest accessibility text size. On a small screen, keep the keyboard open and scroll the dropdown to a result. Scroll Home, filters and details; check that Done, Clear and Directions remain reachable. Return from Map to Home and confirm its navigation controls remain visible.
7. For online-update testing, start the local fixture server, then add `BARK_CATALOG_URL=http://127.0.0.1:8787/active/manifest.json` in **Edit Scheme → Run → Arguments → Environment Variables**. Use the [runbook's scenario commands](../../operations/NATIVE_CATALOG_PUBLICATION.md#reproduce-locally). The `valid` case updates; `slow`/`stalled` keep loading bounded; malformed/shrunk/hash-mismatched data retain accepted parks. Settings → Check for updates requests the same shared refresh.

Removing the local endpoint returns to saved/bundled-only mode; a newer accepted fixture remains saved, by design. The fixture's synthetic source label distinguishes it from live data. Do not use a 5,000-record fixture in a build intended for ordinary park-content testing.

## Code size and remaining prerequisites

Physical source lines include comments/blank lines and exclude generated builds, resource data, assets and documentation.

| Group | Files | Lines |
|---|---:|---:|
| App + domain runtime Swift | 48 | 3,237 |
| App/UI/package test Swift | 15 | 1,759 |
| New backend catalog JavaScript | 4 | 297 |
| New backend/script test JavaScript | 2 | 221 |
| Local fixture/build scripts + Apps Script source | 4 | 183 |
| Native project/package/configuration + two CI workflows + Apps Script manifest | 11 | 838 |

The largest Swift runtime file is **207 lines** (CatalogRepository); MapFeatureModel is 191. The 0.2.5 corrections add **172 net runtime lines and no net runtime files**: SearchModel is removed, ParkResults replaces it, and the other changes make existing task/error ownership explicit. The 0.2.4 refinement adds **19 net runtime Swift lines and no runtime files** over 0.2.3. The original detail sheet added seven small runtime files and **341 net runtime Swift lines** over 0.2.2; source line changes describe added presentation, not a claim of web-code retirement. The earlier 0.2.1 cleanup added **105 net runtime Swift lines** over 0.2.0: the obsolete 40-line SearchSheet is removed; MapScreen dropped from 103 to 90 lines; MapSearchBar, FilterChipsView and MapSearchResults are 50, 52 and 53 lines respectively. No new model, repository or service is introduced. Phase 1 had 509 runtime lines; phase 2, including its UI follow-ups, adds a net **2,728 runtime Swift lines** and real catalog/discovery behavior. The retained backend registry gains 12 net physical lines. **Old web/backend runtime lines removed: 0.** No deployed cost reduction or final replacement saving is claimed while both apps remain supported. Retirement and the final line-cut comparison come after the replacement and separately approved rollout.

Remaining prerequisites: actual iOS 18.4 runtime and physical-device signing/trust; live public-asset/source/trigger configuration and provider checks; human VoiceOver review; native legal/privacy/App Store disclosure review before release. These do not authorize moving users or starting the next phase. The next step is user testing and Phase-2 fixes.
