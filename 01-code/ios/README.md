# Bark Ranger for iPhone

Latest correction: **0.5.15 (74)** preserves the chosen Map day-popup height when tapping another route line and centers the shared stops/time/mileage summary in Map and Planner. Loading and confirmation remain inline without shifting the stop list. Eighteen focused app checks, 51 domain checks, visual review and the signed iPhone build pass. Installed and launched on the connected iPhone 15 Pro Max on September 13; ready for device testing.

Scrolling correction: **0.5.14 (73)** fixes [expanded Map day-popup scrolling](../../04-docs/reports/ios-native/ITINERARY_NORMAL_SCROLL_0_5_14.md), including Acadia clipping/overlap. The shared timeline uses normal scrolling, stable row heights and a small bottom fade. The 11-stop Map test, reorder workflow, focused regressions and signed build pass. Installed and launched on the connected iPhone 15 Pro Max on September 13; ready for physical-device testing.

Latest feature: **0.5.13 (72)** adds [device-only saved places](../../04-docs/reports/ios-native/SAVED_PLACES_0_5_13.md). Searched-place popups have Save/Saved → Remove; saved locations remain as stars independently of trips. Filters includes Show saved pins. The separate storage boundary reserves local notes for future journal work; no journal editor or cloud synchronization is added. Persistence, UI and signed-device build checks passed.

Latest presentation update: **0.5.12 (71)** keeps route loading in the driving-time slot and briefly shows “Day updated” beside mileage, using the same stable stats row in Map and Planner. Fourteen focused checks and the signed iPhone build pass.

Latest routing update: **0.5.11 (70)** adds a [30-day device-only route cache](../../04-docs/reports/ios-native/ROUTE_CACHE_0_5_11.md). Completed road lines and estimated totals survive trip switching and process restarts. Restoring cached lines needs no network or cloud reads; edits request only missing connections. Historical checkpoints below describe their original implementation.

Version **0.5.2 (61)** contains phases 1–5: offline discovery, native accounts, account-scoped persistence/sync, visits, shared Map/Planner/Overview trip editing and Passport. Map and Trips share one authoritative editable draft. Free accounts retain read-only access to existing data; Premium permits account-backed edits. Google and non-Apple account features are enabled in the normal build; Apple sign-in remains capability-gated. See [Config/README.md](Config/README.md) for the active provider/build configuration and the [account runbook](../../04-docs/operations/NATIVE_ACCOUNT_TESTING.md) for isolated tests.

The [0.5.2 efficiency update](../../04-docs/reports/ios-native/RECEIPTS_AND_TRIP_PAGING_0_5_2.md) loads ten recent trips plus the active trip, shares Load more between Map/Trips, and preserves downloaded archives and drafts. Successful native receipt storage is compact and backward-readable; that backend optimization awaits deployment.

Version 0.4.35 applies one shared native action-button style: charcoal fills and teal labels/icons in dark mode, preserving the existing light-mode styles.

The 0.4.33 correction resets the horizontal park-action row when a different pin is selected. It preserves the row's scroll position when resizing the same park sheet, with no new model or stored scroll state.

The [0.4.32 update](../../04-docs/reports/ios-native/PASSPORT_NAVIGATION_0_4_32.md) simplifies Passport navigation, orders state progress using nearby parks and removes the duplicate day-menu button. It also records the confirmed production leaderboard-format mismatch and the pending rollout decision; the UI update does not silently convert historical scores into validated ranks.

The [current pre-Phase-5 review](../../04-docs/reports/ios-native/PHASE_5_READINESS_0_4_31.md) records ownership, measured checks, fixed Passport/cancellation issues and remaining growth concerns. **Phase 5 is now implemented; use the [Phase 5 handoff](../../04-docs/reports/ios-native/PHASE_5.md) for current status and physical-test/deployment gates.** Historical checkpoints below describe how Discovery evolved; use [ARCHITECTURE.md](ARCHITECTURE.md) and the current review for present contracts.

## Historical Discovery checkpoints

Phase 2 retains **393 bundled parks**, local search/filters, full details, native MapKit, offline geographic overview, Locate Me, Apple Maps directions and device settings.

The 0.2.5 cleanup makes selection/directions share one Park, deduplicates catalog/query projection off the main actor, and keeps sheet/camera geometry out of marker reconciliation. Internal catalog failure categories preserve the same saved-data fallback. Version 0.2.6 added native pin-to-pin camera gliding, reliable grouping-setting changes and remembered low/medium sheet height. Selection sits lower above the sheet. Camera and sheet motion honor the system Reduce Motion preference. Version **0.2.7 (9)** keeps detail scrolling locked until high, slides search/tabs with the sheet, preserves saved choices as preference fields evolve, and retries imagery after an explicit appearance change. Distance units are visibly unavailable until distance measurements exist. See the [follow-up maintainability audit and growth priorities](../../04-docs/reports/ios-native/FOLLOWUP_MAINTAINABILITY_AUDIT_2026-09-10.md).

Version **0.2.8 (10)** fixes the returning tab bar’s resting position, keeps ungrouped pins visible at wider zoom levels, and skips marker work for result reordering. Tests/previews now use separate catalog caches, preferences and inert external actions.

Version **0.2.9 (11)** keeps the selected pin at the same medium-safe screen position in both low and medium, adds a modest selected-pin enlargement, and gives search/tabs a quick reversible slide after crossing medium instead of tying their travel to drag distance.

Version **0.2.10 (12)** reduces individual badge artwork to 34×42 points while retaining the existing touch target, map anchor, selected enlargement and cluster design.

Version **0.2.11 (13)** gives park details a brisk 0.26-second downward dismissal. High details keep their height while exiting; the next selection opens low. Reduce Motion uses a fade.

Version **0.2.12 (14)** consumes a popup-dismissal tap before MapKit can use it to start double-tap zoom. The next drag pans normally, and deliberate native zoom remains available after dismissal.

Version **0.2.13 (15)** matches park-detail entrance and exit timing, keeps the camera fixed through every sheet height, and gives new pin selections a brisk eased glide. The map no longer receives live sheet height or changes its margins during sheet movement.

Version **0.2.14 (16)** handles completed pin taps directly, removing the measured half-second wait before native selection. Camera/sheet timing stays unchanged, and dragging from a pin still pans the map.

Version **0.2.15 (17)** prevents transient map-loading errors during zoom/press gestures from switching to offline overview. Automatic overview follows network-path loss; the explicit Overview setting still works. Native MapKit retains loading/retry ownership while connected.

Version **0.2.16 (18)** reveals low-to-medium details progressively as you drag: name first, metadata/tags next, photos last. Pulling back down reverses that reveal while Directions/Park Info remain available. Category, distinct source type, state, swag and cost share one slimmer tag row.

## Open and run

Open `BarkRanger.xcodeproj`, choose the shared **BarkRanger** scheme and **iPhone 17 Pro**, then press **Command-R**. Home opens without sign-in. Tap **Map** for the full-screen map. Tap the wide search bar to browse results; its inline matching/total count, dropdown and pins update together while the keyboard stays open. Active filters appear as removable chips beneath search. Touch or drag the map to collapse search while keeping its text, filters and count; tap the field to reopen the same results. Pins use the approved BARK artwork, and larger dark clusters pair the logo with their park count. Select a park for the three-position detail sheet: low keeps one condensed name line and Directions/Park Info above the tabs; medium adds metadata and neutral photo placeholders while search/tabs stay visible; high stops at the search bar’s top edge, leaving the upper map exposed. Search/tabs finish a short slide away once the drag passes medium; dragging back to medium restores them. Low and medium share one selected-pin position, so resizing between them does not move the map. Drag the handle or swipe the card; at high, the facts scroll normally. **Park Info** expands high. **×** or a tap on exposed map background dismisses the card and deselects the pin without clearing search. Pin taps glide while keeping the current zoom (immediate repositioning with iPhone Settings → Accessibility → Motion → Reduce Motion); search-result selections can still focus a park. Category, swag type and supplied cost use compact rectangular tags. Use **Home → Settings** for map appearance, offline overview, saved catalog status, permissions and local legal documents.

The default build loads the newest valid bundle/saved revision. **Live spreadsheet publication is not deployed or configured yet.** Local fixtures exercise refresh behavior; see the [simple local update instructions](../../04-docs/operations/NATIVE_CATALOG_PUBLICATION.md#reproduce-locally). A saved copy is never labeled fresh just because a network path exists.

Toolchain: **Xcode 26.6 (17F113), Swift 6.3.3**, Swift 6 language mode with complete concurrency checking. Minimum deployment target **iOS 18.4**; installed/tested simulator runtime **iOS 26.5**. Physical-device signing/trust and an actual iOS 18.4 runtime remain separate checks. See [Config/README.md](Config/README.md).

## Find the owner

[ARCHITECTURE.md](ARCHITECTURE.md) maps every implemented file, its functions and direct calls. Start with `BarkRangerApp → AppComposition → RootView / AppLifecycle`, then follow startup into `CatalogRepository`. The catalog is independent of accounts; one filter result drives both pins and counts.

- `BarkRanger/App`: assembly, navigation, lifecycle and startup.
- `BarkRanger/Data/Catalog`: accepted revisions, HTTP, validation and atomic disk storage.
- `BarkRanger/Data/User`: scoped personal store, decoder, sync/receipts, membership and device/account preference boundary.
- `BarkRanger/Features`: Home, Discovery, Settings, Account, Trips and Passport views/models; shared itinerary state/components live in Itinerary.
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
  CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build-for-testing

xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath "$BARK_CHECK_DIR/DerivedData" \
  -resultBundlePath "$BARK_CHECK_DIR/CatalogTests.xcresult" \
  -parallel-testing-enabled NO CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES test-without-building
```

Use **Product → Test** in Xcode for app unit/UI checks, with the fixture server running. Package tests run separately. The server uses only public/synthetic local fixtures; it cannot publish data. The shared Test action isolates the hosted app. UI tests supply `BARK_TEST_SCOPE`, a Debug-only UUID for both catalog cache and preferences; relaunch reuses that scope. Fixtures accept loopback URLs only. Tests/previews disable location requests and Maps/Settings handoffs; app tests await shutdown and delete their scoped artifacts. UI test sandboxes remain disposable Caches data, separate from normal development storage.

The native workflow pins Xcode 26.6 and starts its own loopback server. The catalog workflow uses Node 22 (the backend's declared runtime); local checks currently run on Node 24.15.0. Both workflows are read-only with respect to production and contain no deployment. Refer to the phase report for actual completed run evidence and remaining checks.

## Phase handoff

- [Current pre-Phase-5 review and corrections](../../04-docs/reports/ios-native/PHASE_5_READINESS_0_4_31.md)
- [Phase 4 implementation report](../../04-docs/reports/ios-native/PHASE_4.md)
- [Phase 3 report and testing checklist](../../04-docs/reports/ios-native/PHASE_3.md)
- [Local account/emulator instructions](../../04-docs/operations/NATIVE_ACCOUNT_TESTING.md)
- [Phase 2 report and testing checklist](../../04-docs/reports/ios-native/PHASE_2.md)
- [Six-phase execution contract](../../04-docs/plans/ios-native-2026-09-09/IMPLEMENTATION_PHASES.md)
- [Complete proposed Swift map](../../04-docs/plans/ios-native-2026-09-09/SWIFT_FILE_MAP.md)
- [Catalog publisher and rollback runbook](../../04-docs/operations/NATIVE_CATALOG_PUBLICATION.md)

Phase 5 was explicitly started and is implemented. Passport opens Walks & expeditions below its header; Home opens Share & export and Help & feedback; Passport also opens sharing. Phase 6 requires a separate explicit start. The current review is not a user migration, production deployment or release-readiness certification.

GitHub destination: [USBarkRangers/USBarkRangers](https://github.com/USBarkRangers/USBarkRangers), branch `codex/ios-native-setup`, remote `usbarkrangers`. Never push this native work through the multi-remote `both` alias or deploy the old web app as a side effect.
