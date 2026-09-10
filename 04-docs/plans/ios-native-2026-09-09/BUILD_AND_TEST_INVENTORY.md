# Build support files and verification inventory

This document describes future work only. No prototype, test implementation, migration, resource change, or deployment has been performed for this plan.

## Existing data and the build boundary

Use existing Firebase UIDs and stored field/collection formats. Development uses synthetic fixtures, local Firebase emulators and explicitly configured test environments. No existing customer is enrolled, charged, edited or deleted during these build phases. No production deployment, new cloud project or spreadsheet trigger installation is implied.

The native app reads cloud records through ordinary `CloudUserDecoder` field conversion. It does not import Safari storage, show a migration wizard, run backfills or create a second user database. Browser-only unsynced records stay in the old app for now. Their handling belongs to the later rollout plan; the current CSV export is not a full account backup.

Preserve these known shapes in synthetic fixtures: canonical/coordinate visit IDs, retired or unresolved parks, timestamps, historical scores, `visitedPlaces`, settings, expedition fields/history, streaks, provider entitlement states, `savedRoutes` with all stop/day/bookend/custom-place fields, and both existing achievement representations. Preserve earliest earned dates and stronger evidence/tier. Decode current formats directly and never replace a whole user document with a stale client copy.

Keep local save durability, account isolation, narrowly scoped retries and truthful server acknowledgement. Those remain necessary after every user is on iOS. The first SwiftData schema belongs in `LocalSchema`; introduce a store upgrade plan only when the native app has an actual earlier installed schema to upgrade. Do not create an empty migration framework for hypothetical changes.

## Six build phases and user testing

The authoritative sequence and reusable AI instructions are in [IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md). Its six linked prompts replace the previous phase 0–7 sequence. There is no user-migration phase inside the build.

1. Foundation and app shell.
2. Catalog and discovery.
3. Accounts, persistence and sync.
4. Visits, trips and passport, including leaderboard.
5. Expeditions and native capabilities, sharing and support.
6. Purchases and integration hardening.

Each phase ends with an install/run guide, AI verification evidence and a practical user checklist. The user tests as much as needed; fixes stay in the same phase. The next phase begins only when the user explicitly asks to start it. Device/provider checks that cannot run locally remain clearly unverified, never silently passed. Final production test coverage and user rollout are planned separately after the six builds.

Files are introduced progressively. For example, the shell exists in phase 1, catalog loading in phase 2, account startup in phase 3; the same files grow only within their mapped responsibility. No missing later-phase imports, fake successful actions, 105-file scaffold or disabled-test shortcut is acceptable. The file map's phase column now means first introduction.

## All proposed non-production-Swift files

Paths are proposed, not created. Do not add entitlements, permissions, packages or capabilities that no implemented feature needs. The [phase index](IMPLEMENTATION_PHASES.md#additional-developmentsupport-files-and-when-they-belong) also maps development fixture tools and phase handoff reports.

| Proposed path | Responsibility / contents / consumers |
|---|---|
| `01-code/ios/BarkRanger.xcodeproj/project.pbxproj` | App, Activity extension and tests; minimum OS, Swift concurrency mode, capabilities, exact target memberships. Xcode-managed. |
| `01-code/ios/BarkRanger.xcodeproj/xcshareddata/xcschemes/BarkRanger.xcscheme` | Shared build/test/archive scheme with explicit test targets and no developer-only account dependency. |
| `01-code/ios/BarkRanger.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` | Resolved Firebase and GoogleSignIn package versions. Resolve current supported versions at implementation, review licenses, then pin. No assumed version numbers in this plan. |
| `01-code/ios/Packages/BarkDomain/Package.swift` | Pure Swift package manifest with domain target, resources if required, and tests. Not a runtime service. |
| `01-code/ios/Config/Base.xcconfig` | Shared build settings, minimum OS, supported devices, warning/concurrency policy. |
| `01-code/ios/Config/Debug.xcconfig` | Debug/test overrides, emulator endpoints and local diagnostics; includes Base. No production secrets. |
| `01-code/ios/Config/Release.xcconfig` | Release optimization, assertions and production host allowlist/project identity; includes Base. No hardcoded credentials. |
| `01-code/ios/BarkRanger/Info.plist` | URL handling, location/motion/Health permission explanations, Live Activity flag; background location only for implemented tracking. Static launch appearance configured here. |
| `01-code/ios/BarkRanger/BarkRanger.entitlements` | Sign in with Apple, HealthKit and associated-domain capabilities actually used. No broad background fetch, push, or App Groups entitlement without a feature requiring it. |
| `01-code/ios/BarkRanger/GoogleService-Info.plist` | Future real Firebase **iOS app registration** for Bark's project; use explicit demo/emulator configuration until registration is separately authorized. Do not copy the web app ID as the native ID. Firebase configuration is public identification, not an admin key. |
| `01-code/ios/BarkRanger/PrivacyInfo.xcprivacy` | Actual required-reason API use/data declarations, checked against SDK manifests and implementation. Not fabricated from a generic template. |
| `01-code/ios/BarkRanger/Resources/Localizable.xcstrings` | All user-facing labels, pluralization, accessibility and error states; keep English first, localization-ready. |
| `01-code/ios/BarkRanger/Resources/Assets.xcassets/Contents.json` | Asset catalog root metadata. |
| `01-code/ios/BarkRanger/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json` | App icon metadata for the approved production icon. |
| `01-code/ios/BarkRanger/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png` | Approved Bark icon artwork adapted for iOS; no newly invented branding required. |
| `01-code/ios/BarkRanger/Resources/Assets.xcassets/BarkWatermark.imageset/Contents.json` | Watermark asset metadata. |
| `01-code/ios/BarkRanger/Resources/Assets.xcassets/BarkWatermark.imageset/BarkWatermark.png` | Existing approved watermark artwork; image export consumes it. |
| `01-code/ios/BarkRanger/Resources/catalog.bundled.json` | Validated complete catalog with manifest metadata; build gate checks IDs/hash/count/schema. Current fallback is a seed, not automatically the latest source. |
| `01-code/ios/BarkRanger/Resources/trails.json` | Existing 11 trail definitions plus versioned geometry and display text/provenance; decoded by TrailRepository. |
| `01-code/ios/BarkRanger/Resources/achievements.json` | Existing achievement IDs, requirements, titles and display descriptions. AppComposition decodes definitions and injects them into the pure AchievementPolicy. |
| `01-code/ios/BarkRanger/Resources/education.json` | Current B.A.R.K. education, approved community/resource URLs and support address. HomeView/Settings use it. |
| `01-code/ios/BarkRanger/Resources/offline-geography.geojson` | Small approved/provenance-recorded geographic outline dataset, including islands/territories; no copied Apple map tiles. |
| `01-code/ios/BarkRanger/Resources/offline-background.png` | One small opaque neutral tile used locally at all overview zooms; not a tile pyramid. |
| `01-code/ios/BarkRanger/Resources/attribution.json` | Dataset/library/artwork source, license and version notices displayed from settings. |
| `01-code/ios/BarkRanger/Resources/privacy.md` | Bundled current privacy text, useful offline, paired with hosted policy. |
| `01-code/ios/BarkRanger/Resources/terms.md` | Bundled current terms, useful offline, paired with hosted terms. |
| `01-code/ios/BarkRangerActivity/Info.plist` | Widget/Live Activity extension metadata; no network or location configuration. |
| `01-code/ios/BarkRangerActivity/PrivacyInfo.xcprivacy` | Extension's actual privacy declarations; no tracking collection is planned. |
| `01-code/ios/Tests/StoreKit/BarkRanger.storekit` | Local StoreKit product/subscription test configuration, reconciled with actual App Store Connect products when created. |
| `03-tests/fixtures/native-contracts/catalog.json` | Synthetic/sanitized catalog, aliases, malformed/retired examples and expected validation decisions. |
| `03-tests/fixtures/native-contracts/users.json` | Synthetic current-server user shapes, entitlement matrix and expected merge results. No real emails/tokens. |
| `03-tests/fixtures/native-contracts/trips.json` | Route boundary/custom stop/notes/order/optimization examples consumed by Swift and JS tests. |
| `03-tests/fixtures/native-contracts/scoring.json` | Distinct-site/state/badge/date/streak/mileage/completion examples consumed by both languages. |
| `03-tests/fixtures/native-contracts/sync.json` | Out-of-order/duplicate/expired-operation/conflict examples with expected server receipts/local outcomes. |
| `03-tests/fixtures/native-contracts/walks.json` | Synthetic location gaps/noise/overlaps/source/import examples; never real personal movement history. |
| `.github/workflows/ios-checks.yml` | Pinned macOS/Xcode runner; build, pure/unit/UI critical tests and archive validation. No deployment on every PR and no production auth data. |
| `.github/workflows/backend-checks.yml` | Existing/new Node tests, emulator rules/transactions and contract fixture validation; project-isolation checks remain mandatory. |
| `.github/workflows/catalog-checks.yml` | Validate bundled catalog/schema/hash and cross-language contract fixtures. Reads test data by default; production publication is a separate deliberate job/action. |
| `01-code/ios/README.md` | Five-minute setup, demo/offline launch, target/dependency map, test/build steps and a brief guided code walkthrough for a reviewer. |
| `01-code/ios/ARCHITECTURE.md` | Maintained concise implemented dependency/state diagrams and pointers to this planning reference. |
| `01-code/ios/CONTRIBUTING.md` | File/ownership rules, concurrency/error conventions, verification expectations and where a new feature belongs. |
| `04-docs/adr/0001-native-ios-and-firebase.md` | Implemented decision and consequences: Swift UI/domain + retained Firebase backend; alternatives considered. |
| `04-docs/adr/0002-offline-catalog-and-personal-outbox.md` | One durable local user store, immutable public catalog, conflict/idempotency model and why Firestore caching alone was insufficient. |
| `04-docs/adr/0003-native-tracking-and-live-activities.md` | GPS/motion/Health source choice, background limits, privacy and filter-count placement. |
| `04-docs/adr/0004-provider-entitlements.md` | Apple/Lemon grant resolution, linking, restore, server validation and deletion policy. |
| `04-docs/runbooks/IOS_RELEASE_AND_ROLLBACK.md` | Phase 6 records engineering build prerequisites and unverified external checks only. Actual App Store/TestFlight distribution, backend deployment and user rollout procedures are later work; no deployment authorization is granted. |
| `04-docs/runbooks/CATALOG_PUBLICATION.md` | Source approval, manual/triggered publish, validation, manifest promotion, provenance and rollback. |

Modify existing `firebase.json`, `06-config/firestore.rules`, functions `package.json`/lockfile, root README/test commands and scoped hosting headers only as required during implementation. Keep explicit project predeploy checks for all three resource types. Add catalog-publication script files listed in BACKEND_FILE_MAP; leave `support-email-bank` files and other user changes alone.

These configuration/resource/documentation files are not all Swift, and they are not counted as production Swift source in the estimate. Package.swift is build configuration. No temporary browser exporter or native archive importer is planned.

## Every proposed native test source file

Use Swift Testing for deterministic value/policy tests and XCTest/XCUITest where device/UI integration requires it. Test observable outcomes, durable boundaries and known regressions. Do not write a test that simply duplicates the implementation line for line.

Package test prefix: `01-code/ios/Packages/BarkDomain/Tests/BarkDomainTests/`.

| File | Named behaviors to verify / calls |
|---|---|
| `ContractFixtures.swift` | Test-only loader for the repository's shared sanitized contract files, using an explicit fixture-root path in CI and a documented repository-relative fallback locally. Keep fixture I/O outside pure production policy code. |
| `CatalogIdentityTests.swift` | `canonicalIDsRemainStable`, `ambiguousAliasStaysUnresolved`, `retiredParkStillResolves`; D01/D02 and catalog fixture. |
| `ParkFilterTests.swift` | `countMatchesIDs`, `tripOnlyIncludesBookendsCorrectly`, `zeroMatchesIsNotEmptyCatalog`; D10, synthetic catalog/visits/trip. |
| `ParkSearchTests.swift` | `abbreviationsRankCorrectly`, `diacriticsAndTyposWork`, `resultLimitIsStable`; D11. |
| `VisitPolicyTests.swift` | `fifthAllowedSixthBlocked`, `removeAtLimitAllowed`, `proximityBoundaryAndBadFix`, `upgradeDoesNotDuplicateSite`; D12. |
| `TripRoutePlanTests.swift` | `emptyDaysAndBookends`, `dayContinuity`, `adjacentDuplicates`, `customStopsPreserved`, `onlyChangedSegmentsInvalidate`; D13/trips fixture. |
| `TripOptimizerTests.swift` | `notesAndStopIdentityPreserved`, `constraintsProduceLabeledEstimates`, `allStopsAppearExactlyOnce`; D14. |
| `AchievementPolicyTests.swift` | `physicalSiteDedup`, `multipleStateProgress`, `earliestEarnedDatePreserved`, `rankDependentBadgeNoScoreLoop`, `streakTimezoneBoundary`; D15/scoring fixture. |
| `EntitlementTests.swift` | `providerUnion`, `cacheUIDMismatch`, `expiryAndGraceMatrix`, `revokedAppleDoesNotEraseActiveLemon`; D07/users fixture. |
| `ExpeditionPolicyTests.swift` | `milesDoNotMintNewPoints`, `oneAwardPerRun`, `oldPointAdjustmentsPreserved`, `manualCorrectionUpdatesTotals`; D16. |
| `WalkDistanceTests.swift` | `noisyStationaryGPS`, `teleportAndGapSplit`, `overlappingSourcesNotAdded`, `distanceNeverNegative`; D17/walks fixture. |

App unit/integration prefix: `01-code/ios/BarkRangerTests/`.

| File | Named behaviors to verify / calls |
|---|---|
| `TestFixtures.swift` | Loads the shared sanitized JSON fixtures and builds preview values; no production account loader. |
| `TestClock.swift` | Manually advanced deadline/retry clock implementation; timers never require minutes of real sleeping. |
| `TestClients.swift` | Narrow fakes for HTTP, cloud mutation, account events and sample streams; scriptable timeout/body-stall/receipt behavior. Avoid a second fake app architecture. |
| `StartupTests.swift` | Local data before auth; fresh/bundled/cache-corrupt/304/slow body/captive portal; fresh-before-deadline versus saved-after-deadline; tests A05/C01. |
| `CatalogPersistenceTests.swift` | Interrupted payload/pointer writes, newer-bundle/older-disk selection, rollback revision, hash/size/schema/retirement rejection; C01–C04 on temporary disk. |
| `PersonalStoreTests.swift` | Atomic visible-change+outbox commit, disk-full behavior, native schema reopen/preservation, no automatic destructive reset; U01–U02. |
| `SyncEngineTests.swift` | Lost response after server commit, duplicate receipt, changed-operation ID reuse, terminal rejection, delayed old account callback, pending overlay over older snapshots; U10/U11. |
| `CloudUserDecoderTests.swift` | Every known Firestore shape, alias ambiguity, earliest badges, historical miles/points, all saved-trip fields; U12 plus shared fixtures. |
| `AccountIsolationTests.swift` | A→B, sign-out/failed-sign-out, pending data kept but hidden, expired cached scope, deleted-user retry; P01/P02/A03. |
| `VisitRepositoryTests.swift` | Kill after local save/before send/after server commit, add/remove/edit conflicts and bulk selected-ID intent; U04/U10. |
| `TripRepositoryTests.swift` | Draft persistence, Premium cloud-save gate, simultaneous edits preserve conflict copy, page failure retains list; U05/T07. |
| `MapPresentationTests.swift` | Annotation identities stable; selected/visited/trip/cluster semantics; filter count independent of viewport; offline outline covers non-contiguous geography; M02/M04. |
| `RoutePreviewTests.swift` | Exact route-plan order, cancellation, throttling, partial missing legs, edit invalidation, no 50-day launch fanout; P14/T08. |
| `MapsHandoffTests.swift` | Escaping, Apple waypoint order, supported navigation group continuation, optional Google export, unsupported URL rejection; P13. |
| `WalkRecorderTests.swift` | Checkpoint restart, pause/resume gap, protected storage failure, finish while offline, scope change, source overlap and duplicate Health import; E05/U13/P09/P10. |
| `LiveActivityTests.swift` | Disabled/ended/stale activities, reconcile prior activity, safe payload size, finishing walk ends activity, no activity for filters; P11/W01. |
| `PurchaseServiceTests.swift` | Verified/unverified/pending/canceled transaction, durable retry, UID/token binding, restore, refund and product metadata failure; P04/P05 and StoreKit test configuration. |
| `SharingAndFeedbackTests.swift` | Large/rotated photo, normalized watermark placement, export memory bounds, CSV escaping/formula safety, attachment byte/count limits, retry preserves draft; P15/F07/F09/F11. |

UI test prefix: `01-code/ios/BarkRangerUITests/`.

| File | End-to-end user scenarios |
|---|---|
| `OfflineLaunchUITests.swift` | Fresh-install bundled catalog, returning cached user, loading cover, offline park list/detail and foreground reconnection. |
| `DiscoveryUITests.swift` | Search/filters/count/selection, Dynamic Type/VoiceOver access labels, empty results and directions handoff return. |
| `AccountAndVisitsUITests.swift` | Sign-in variants, free cap, pending offline visit/delete, account switch, restore visibility, delete-account flow. |
| `TripPlannerUITests.swift` | 50 days, custom stop/bookends, note editing/reorder, save/reload/conflict, route preview failure and navigation continuation. |
| `ExpeditionUITests.swift` | Permission refusal, manual miles, active recording controls/recovery, complete/claim once, history import UI. Physical background tests supplement this suite. |
| `PurchasesUITests.swift` | StoreKit purchase/pending/restore/manage scenarios, existing Lemon entitlement and avoidance of a second purchase. |
| `SharingAndSupportUITests.swift` | PhotosPicker cancel, watermark/share/export, attachment/error/fallback, education/QR/legal access offline. |

## Backend test inventory and reuse of current tests

Retain the existing 27 function test files and 122 root test files throughout coexistence. Some test the web DOM/service worker and eventually leave with that platform; rules, billing, support and identity tests continue to protect live services. Their current line count is not “fat.”

Proposed additional tests under `01-code/functions/tests/`:

| File | Functions/behaviors exercised |
|---|---|
| `native-user-mutations.test.js` | User dispatcher/receipts: UID isolation, operation reuse, stale retry, rollback, no partial user/receipt/projection commit. |
| `native-user-mutations.emulator.test.js` | Real transaction contention: old web write racing native add/delete, free cap, stale entity fingerprint, tombstone resurrection prevention. |
| `native-trip-expedition.test.js` | Trip conflicts/size limits, walk dedupe, exactly-once run award, historical score adjustments and sanitized inputs. |
| `apple-transactions.test.js` | Idempotent purchase-context/token issuance and verified library boundary fixtures, wrong environment/bundle/product/token, cross-UID original-transaction binding, expired/revoked/grace access. |
| `apple-notifications.test.js` | Signature failure, durable receipt failure, duplicates/out-of-order notifications, restart/retry and deleted users. |
| `catalog-publication.test.js` | Header/field normalization, duplicate/retired IDs, rejected shrink, concurrent publish CAS, rollback-as-new-revision, old snapshot compatibility. |
| `catalog-signals.test.js` | Edit signal auth/replay/timestamp, irrelevant range ignore, coalescing, source/API writes and reconciliation fallback. |
| `native-contract-parity.test.js` | Runs the shared entitlement/scoring/route identity/mutation fixtures against backend rules/policies; detects Swift/JS business-rule drift. |
| `ops-consolidation.test.js` | Old vs consolidated daily/weekly/digest/cost/support output fields, time windows, zero/unavailable values and alert routing. |

Proposed supporting tests: `03-tests/catalog-publication-script.test.js` for edit/change trigger wiring and absence of secret literals.

Extend existing `03-tests/rules/firestore-entitlement.rules.test.js` and project-isolation tests when contracts change. Preserve the user's current uncommitted test edits; do not overwrite them with a regenerated file.

## Device and operational acceptance matrix

| Area | Required evidence before production release |
|---|---|
| Launch | Fresh install and previously used app; airplane mode, very slow cell, captive portal, stalled response body, rejected manifest, low disk and corrupt cache. Measure cold local-ready and loader-dismiss times independently. Proposed network-decision target ≤3 s; report actual p50/p95 by device. |
| Maps | Supported phone without Dynamic Island plus a Dynamic Island model; older supported hardware; portrait/landscape; largest accessibility text; Alaska/Hawaii/Guam/other territories; map/list alternatives. Screen rendering must not depend on tile success. |
| Tracking | Real outdoors walk with screen locked, app switch, phone call, battery saver, denied/revoked precise location, permission changed mid-walk, low battery, device restart/force-quit and recovery. Compare against a recorded reference route; disclose measurement differences. Simulator success is insufficient. |
| Persistence | Terminate at each local/remote commit boundary; reconnect after receipt loss; pending data over entitlement expiry; switch accounts during response; simultaneous web/native edits. No disappearance, resurrection or duplicated award. |
| Billing | New Apple customer, existing Lemon/manual/access-code customer, dual-provider account, different Apple account/device, restore, pending approval, refund, expiry and account deletion. Verify authoritative server state as well as UI. |
| Accessibility | VoiceOver actions/reading order, Dynamic Type, Reduce Motion, non-color state indicators, large tap targets, keyboard/screen-reader forms, safe area on all supported phones. |
| Cost/scale | Replay realistic sessions against emulators/staging; record manifest/data traffic, sync reads/writes, backend cold start, max-instance behavior, 429 backoff and public leaderboard paging. No unsanctioned load test against production. |
| Source quality | Fresh clone builds with documented steps; no credentials; dependency direction enforced by module imports/review; SDK/concurrency warnings handled; no runtime file imports from the legacy web directory. |

## What a senior engineer should be able to inspect

The first screenful of the future README should explain the app, launch it in a deterministic offline demo, and point to three short examples: `CatalogRepository` for resilient I/O, `TripRoutePlan` for a pure algorithm, and `SyncEngine` for durable distributed state. Include actual measured results after implementation, not these planning estimates as if achieved.

The architecture decisions should explain tradeoffs: retaining Firebase to preserve accounts, why the offline outbox exists, why Dynamic Island represents a walk rather than filters, and why MapKit does not remove offline-data responsibilities. Tests should make failure cases reproducible. A small well-explained feature with real behavior is a stronger portfolio sample than a directory full of placeholders.

## After the six builds: separately planned rollout and retirement

Nothing in these prompts authorizes retirement. A later plan may retire a web/runtime path only after native parity is proven, supported old users have a migration path, observed usage permits it, and recovery has been exercised. Keep billing/provider webhooks for the full relevant subscription lifecycle; native rollout alone is not that gate. Keep admin/legal/support pages and their tools unless a separately verified replacement exists.

Record an exact deletion allowlist, affected resource names, last observed callers, backup/version references, rollback process and ownership check. Preserve current Firebase project checks. Never use wildcard function deletion or remove a secret based on another repository's migration history. The app source can shrink only after this gate; until then, coexistence intentionally makes the repository larger.
