# Architecture and behavioral contracts

## Build scope

The [six-phase execution plan](IMPLEMENTATION_PHASES.md) controls implementation order. Build one phase, hand it to the user for testing, fix that phase, and wait for an explicit start of the next. Existing accounts, billing and stored field formats stay in place. No account archive importer, Safari transfer layer, data backfill, dual database or production rollout belongs in these build phases. Journaling and a new server data layout are later work.

`CloudUserDecoder` reads the existing server format as the normal format. A native local schema version protects future iOS updates; it does not justify building a user-migration framework now. Use one small durable queue of the supported operations because offline saves and retries remain ongoing app behavior.

## Platform and module boundary

Proposed minimum: **iOS 18.4**, Swift 6 language mode and strict concurrency, using a stable Xcode toolchain pinned when implementation starts. This is a planning assumption, chosen in part for Apple's unified multistop Maps URLs; it is not based on measured customer device distribution. Check that distribution before locking the deployment target. Supporting older iOS releases would require a tested handoff fallback and additional availability branches. [Unified Maps URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls).

Use one Xcode app target, one Live Activity extension target, unit/UI test targets, and one small local Swift package named `BarkDomain`. Do not create a package or protocol for every class. `BarkDomain` contains values and deterministic rules, and imports Foundation only. The app's adapters conform to narrow protocols colocated with the consumers that need test doubles.

Dependency direction:

```text
BarkRangerApp → AppComposition → RootView / AppLifecycle
                                  ↓
                        Feature views → Feature models
                                           ↓
                          Repositories / specialized services
                                  ↓                 ↓
                         LocalStore / clients     Apple adapters
                                  ↓                 ↓
                          SwiftData / Firebase    MapKit / Core Location /
                                                 StoreKit / ActivityKit

All of the above may use BarkDomain values and policies.
BarkDomain calls none of the above.
The Live Activity extension uses only ActivityAttributes and its presentation.
```

`AppComposition` wires objects only; it does not make business decisions. `AppLifecycle` owns foreground/reconnect tasks only; it is not a second view model. Feature models are `@MainActor @Observable`. Storage and catalog writers are actors. Immutable domain values cross actor boundaries as `Sendable` values; do not pass SwiftData models or mutable Firebase snapshots between actors.

Prefer ordinary constructor injection. Keep a protocol when a side effect needs a deterministic fake, such as the catalog client, clock, location provider, account client, or cloud write transport. Do not wrap strings, numbers, or every Foundation call in interfaces.

## Storage and identities

| Data | Authority | Local representation | Who may change it |
|---|---|---|---|
| Official parks | Validated published catalog | Immutable JSON snapshot + memory index | `CatalogRepository` after `CatalogValidator` accepts a full revision. |
| Catalog pointer/version | Publication manifest | Atomic pointer plus current/previous snapshot | `CatalogDiskStore`; never a view. |
| Visits, trip drafts/saves, walks, expedition state | Local intent plus accepted server records | User-scoped SwiftData store with base records and outbox | Corresponding repository in one local transaction. |
| Account identity | Firebase Auth | SDK credential + small remembered UID reference in Keychain | `AccountService` and `AccountSession`. |
| Premium | Server entitlement and verified StoreKit transaction | UID-bound, expiring access snapshot | `EntitlementRepository`; clients never edit the Firestore entitlement. |
| Device UI settings | Device preference | Typed local settings; selected fields optionally cloud synced | `SettingsRepository`. |
| Rank/public score | Server-generated leaderboard | Paged, time-stamped local read cache | `LeaderboardRepository` reads; backend writes. |
| Raw GPS/Health data | Device | Protected local recording files / HealthKit | `WalkRecorder` / `HealthWorkoutImporter`; no automatic Firestore upload. |

`ParkID` is the existing canonical identifier, **never a regenerated UUID during import, row number, name, or rounded coordinate**. A separate `siteID` supports physical-site deduplication without collapsing legitimate park records. Preserve existing scoring equivalence with fixtures before publishing site IDs. A trip stop has its own `StopID` and is either an official park reference or a custom place with coordinates. Custom places never enter the official catalog.

Date and distance conventions: store timestamps in UTC, display local time, calculate elapsed session time with a monotonic clock, and store distance in meters. Old miles and milliseconds convert only in `CloudUserDecoder`. Keep a day/time-zone key for streak and manual-entry policy; timezone changes must not mint extra daily credit.

There are three separate concepts: local save durability, server acceptance, and location-based visit evidence. A GPS-tagged visit can still be pending sync. A server-accepted manual visit is still manual. Do not call either state simply “verified.”

## Launch state machine

The system launch screen is static. The loading experience below belongs to `StartupView` after the app starts; do not put networking in a launch storyboard.

1. `BarkRangerApp` obtains the composition and starts `StartupModel.start()` once.
2. `CatalogRepository.loadLocal()` tries the newest accepted disk snapshot, then the previous valid snapshot, then the bundled snapshot. Pick the highest supported validated revision, so a newer app's bundle can replace an older disk catalog. Nothing waits for authentication.
3. `LocalStore.open(scope:)` opens guest data or the remembered UID's protected local store. `AccountSession.restoreRememberedScope()` exposes only that user's saved content and the appropriate cached access state. Auth unresolved is distinct from signed out.
4. `CatalogRepository.refresh(deadline:)` makes one conditional manifest request. Start it independently of Firebase setup. `NWPathMonitor` is only a scheduling hint; an HTTP response determines service reachability.
5. A changed compatible manifest leads to a bounded download, full validation, disk commit, then a single published catalog revision. Same revision/304 returns unchanged. Apply no rows while parsing.
6. Dismiss the loading screen after valid local content and either the fresh-data decision or the **3-second network budget**. Clear offline status can take the fast path; do not add a minimum spinner duration. Disk-open/corruption failures show a recoverable error, not an indefinite spinner.
7. Auth, entitlement refresh, account sync, and map imagery continue independently. Later valid catalog updates replace data without resetting selection, filters, trip edits, scroll position, or the whole screen.

| Situation | Data when loader disappears | Next action |
|---|---|---|
| Fresh install, no reception | Bundled parks and offline outline; no invented personal records | Retry on foreground/connectivity signal. |
| Cached parks, no reception | Most recent validated local revision | Continue local read/edit behavior allowed by account/access policy. |
| Healthy service, manifest unchanged | Local parks confirmed current | No catalog download or marker rebuild. |
| Healthy service, changed catalog finishes inside budget | Newly validated revision | Show its publication date. |
| Connectivity returns while loader is present | Fresh revision if it completes within remaining budget | Otherwise open local and finish refresh after reveal. |
| Bars/Wi-Fi but captive portal, DNS failure, stalled body, HTTP 429/5xx | Local data with “Using saved park data” status | Bounded retry with jitter and `Retry-After`. |
| Invalid, older, truncated, oversized, or unsupported revision | Previous accepted revision | Record a compact diagnostic; retry later. |
| Local files corrupt | Previous valid file or bundle | Quarantine the invalid file; never delete personal data as catalog repair. |
| Personal database unavailable | Catalog remains usable; personal-data recovery screen | Preserve database files and offer export/retry; no automatic destructive reset. |

Refresh on cold launch, foreground return when stale, explicit refresh, and a debounced unsatisfied-to-satisfied path change **even when parks already exist**. That last case fixes the existing reconnect handler's restriction to an empty catalog (`dataService.v143.js:732`). One request is in flight per catalog. Retry roughly 1, 3, 10, then 30 seconds after recoverable failure, with jitter and server backoff; stop aggressive retries in background. While actively browsing, the regular successful-check cadence is at most once per minute; reconnect recovery and explicit refresh may check sooner. Do not use a timestamp cache-buster.

“Within seconds” is the measured foreground fetch target once a published revision is reachable. Sheet edit-to-publication latency and iOS background execution are separate. iOS does not guarantee scheduling a background refresh at an exact time. Background catalog refresh is not needed for launch correctness and is omitted from the initial implementation. [Background scheduling limits](https://developer.apple.com/documentation/backgroundtasks/bgtaskrequest/earliestbegindate).

## Catalog contract and publication

The publisher reads the source sheet once with the Sheets API and emits typed JSON. Devices do not read or parse CSV. The public manifest contains schema version, monotonically increasing revision, payload URL, SHA-256, decompressed byte limit, record count, publication time, source-read time, minimum reader version, and explicit retired/merged ID metadata. URLs must remain on the configured catalog host. Never put secrets, user data, or operational metadata in this asset.

Park JSON retains ID, site ID, name, states/territories, category, cost, swag, information, URLs, coordinates, and all existing sheet detail fields: entrance fees, swag location, approved areas, restrictions, hazards, and extra swag. Normalize the existing header variants at publication. The bundled 0.142 fallback has **393 rows**, while another fallback has 374 and older data has other counts. “399” is an example, not a schema invariant.

Validation rejects duplicates, missing IDs/names, invalid coordinates, unexpected schema, hash/size mismatch, and unexplained removals. Preserve the old 300-row and 10% shrink guards as migration alarms; replace magic lower bounds with an explicit approved retirement set before genuine catalog reductions. Legitimate removals become tombstones/aliases, not unexplained disappearance. Visits to retired parks remain readable and exportable.

Publication order is payload first, then manifest pointer with an object-generation precondition. Concurrent publishers cannot roll the pointer backward. Client commit similarly writes and validates a temporary file, atomically replaces the pointer, retains one prior revision, and removes abandoned temporaries later. Revision rollback is published as a **new revision** pointing to approved old content.

For faster direct sheet edits, use a tiny Apps Script installable edit/change trigger that requests the authenticated publisher, plus a reconciliation schedule. Existing `syncToSpreadsheet` calls the publisher after an accepted write because API edits do not fire Apps Script edit triggers. Both paths coalesce bursts and only publish after validation. They are best effort, not a transactional guarantee of a particular number of seconds. An explicit “Publish now” operation returns the resulting revision for a curator who needs certainty. [Apps Script trigger restrictions](https://developers.google.com/apps-script/guides/triggers/installable).

A managed object store serves immutable public catalog files; a small revalidated manifest request is the only per-session freshness check. Use Google Cloud Storage within Bark's project initially. The app uses `Cache-Control: no-cache`/conditional requests for the mutable manifest and immutable caching for revisioned payloads. Do not inherit the current five-minute endpoint freshness plus one-day stale policy for the manifest. Add a separately priced CDN only if measured traffic makes it worthwhile. No Firestore park reads per person and no new function invocation per ordinary catalog read.

## Map, filtering, directions, and trip planning

Use a single `NativeMapView` bridge around `MKMapView`. This provides native clustering and overlay support while the rest of the app remains SwiftUI. `MapCoordinator` translates IDs, selection, camera changes, and overlay render requests. It knows nothing about billing, Firestore, or expedition scoring.

One `ParkFilter.apply()` result produces both the annotation list and the `99 / total` summary. Define this as **matching catalog records**, not cluster bubble count and not viewport-visible count. Passport progress instead uses distinct physical sites. Preserve category, swag, visited/unvisited, and trip-only filters. Search is local-first with existing abbreviations and bounded fuzzy ranking; town suggestions use `MKLocalSearchCompleter`/`MKLocalSearch` only after the appropriate user action and access gate.

Preserve selected/in-trip/visited marker semantics, separate numbered itinerary stops from clustered park pins, and avoid recreating the whole map when a record changes. Native clustering replaces custom clustering maintenance. Existing performance toggles map to system Reduce Motion, one reduced-detail preference, and native clustering/gesture options; old browser-specific names are not carried forward as meaningless settings.

Default/streets become Apple standard maps, satellite becomes imagery, and terrain becomes a labeled Apple elevation presentation where available. This is not a promise of OpenTopoMap's contours or identical cartography. If exact contour detail is a required feature, retain that licensed overlay as an explicit later exception; do not silently label elevation as an equivalent topographic map.

For offline context, `OfflineBasemapOverlay` supplies a local opaque background and bundled low-detail geographic outlines. Park pins, trip bookends, and local trail geometry render above it with a visible “Offline overview — street detail unavailable” label and a park-list alternative. The existing app guarantees only cached tiles; the native plan strengthens catalog availability but cannot preserve its particular browser tile cache. MapKit's cache has no offline availability guarantee. Use public-domain Natural Earth data with recorded provenance, including non-contiguous states and territories. [MapKit offline behavior](https://developer.apple.com/forums/thread/772258), [local tile overlays](https://developer.apple.com/documentation/mapkit/mktileoverlay), [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/).

`TripRoutePlan.build()` remains the only owner of day-boundary continuity, empty days, adjacent duplicates, start/end bookends, and segment identity. All previews, overlay lines, and exports consume this result. `TripOptimizer` preserves nearest-neighbor ordering, maximum stops/day, and estimated drive-hour partitioning; it never runs an all-pairs paid directions matrix. Estimates remain labeled estimates.

`RoutePreviewService` requests only the active day's displayed legs, with low concurrency, cancellation, in-memory reuse, and throttling/backoff. Do not precompute 50 days at launch or persist Apple route data indefinitely without a terms review. Offline shows itinerary order and explicitly dashed straight connections, not a fictional road route or ETA. [MKDirections behavior and throttling](https://developer.apple.com/documentation/mapkit/mkdirections).

Apple Maps receives an ordered day via the unified `/directions` URL and repeated `waypoint` parameters on the proposed minimum OS. Validate supported route size on real devices and split long days into explicit successive navigation groups if needed, with a visible continuation. `openMaps(with:)` with directions has a two-item limit; do not mistake its array for arbitrary multistop support. Keep optional Google Maps export as a plain user-selected link to preserve the existing feature. [Unified URLs](https://developer.apple.com/documentation/mapkit/unified-map-urls), [two-item launch constraint](https://developer.apple.com/documentation/mapkit/mkmapitem/openmaps(with:launchoptions:)).

## Personal writes, conflicts, and account switching

Use SwiftData for the local baseline, visible projection, and typed outbox. A visit add/remove/date change, walk completion, or trip save commits the visible change and its operation in **one local transaction before reporting success**. Store UID, operation ID, entity ID, expected server version/fingerprint, payload, creation time, retry state, and error category. No whole-user-document replacement from a stale device.

`SyncEngine` submits operations through `CloudUserClient` to an idempotent callable. The backend validates auth, access, tombstone, schema, and current data; applies the operation and records its receipt atomically. A timed-out client retries the **same operation ID**. Client acknowledgement must match UID, operation ID, and entity version before removing the outbox entry.

The native Firestore adapter is read-only and uses a memory cache. It subscribes to the current user document, explicitly tracks server-vs-cache metadata, and merges server state under pending local operations. SwiftData is the only durable user-facing offline store. This small journal is intentional: Firestore offline writes alone use last-write-wins semantics, and client transactions fail offline. [Offline persistence](https://firebase.google.com/docs/firestore/manage-data/enable-offline), [transaction limitations](https://firebase.google.com/docs/firestore/manage-data/transactions).

During coexistence, the backend mutates the current `users/{uid}.visitedPlaces` array transactionally and preserves unknown fields. Do not introduce per-visit collections plus two-way mirrors as part of the first release. Native expected-state checks compare the touched entity to the actual current record, including changes from old clients that do not increment native revisions. Non-overlapping visit changes merge. A stale update to a removed/changed record becomes a visible conflict; it does not resurrect the record. Bulk removals respect the existing rules' protection and the user's selected IDs.

Trips conflict at the saved-trip revision level: preserve both versions or ask which to keep; never silently discard a day or custom stop. Walks use stable session IDs and a server dedupe record. Completion awards use stable expedition-run IDs. Receipt expiry requires a stale-operation fence and a reconciliation path; do not make a delayed retry become a second award. Bad requests and revoked access stay as local unsynced records with an explanation/export path, not infinite retries.

On sign-out/switch, stop listeners, cancel scoped tasks, checkpoint/pause recording, end the old Live Activity, clear old feature state, close that UID's store, and open the new scope. Delayed callbacks carry a session generation and cannot publish into the next account. Explicit sign-out clears remembered automatic access, but preserves encrypted/protected pending records for that UID until a deliberate deletion. A canceled sign-out must not partially clear session state.

Account deletion requires recent authentication and a durable backend tombstone first. Clean owned data and public leaderboard entries in resumable work. Old tokens, webhook deliveries, and retries must not recreate the account. Apple subscription management and account deletion are separate actions; do not imply deleting an account cancels Apple's billing.

## Tracking and Live Activities

Distinguish **virtual expedition progress** from a **real recording session**. Starting an expedition does not start GPS. Starting a walk creates one session ID, requests only needed permission, begins Core Location updates with a retained background activity session, and optionally starts a Live Activity. Persist checkpoints periodically and at start, pause, resume, finish, and scope changes. [Background location requirements](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background).

`WalkRecorder` consumes location samples. `WalkDistancePolicy` filters stale/poor-accuracy fixes and implausible jumps, splits route segments across gaps, and never connects an unknown gap as if walked. `LocationClient` owns system authorization and lifecycle. In tracking mode it is the sole owner of continuous location updates; map locate/check-in requests reuse its recent valid fix or request a bounded one-shot fix.

Core Motion is an optional lower-power, explicit step-based session source. HealthKit import is an optional completed-workout source. Choose **one credited distance source per time interval**, retain source and external ID, exclude Bark-exported workouts from re-import, and do not sum phone, watch, Health, and GPS estimates for the same walk. Pedometer history is limited to the past seven days. HealthKit does not reliably reveal whether read permission was denied; “no accessible workouts” is not “permission definitely denied.” [CMPedometer history](https://developer.apple.com/documentation/coremotion/cmpedometer/querypedometerdata(from:to:withhandler:)), [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data).

A motion-only session can recover historical device measurements when the app next runs; it does not gain continuous background execution merely because a Live Activity exists. Its island summary must show the last update/staleness honestly. GPS-mode recording receives the supported Core Location background treatment. Health import reads an existing completed workout; adding Health export or live Apple Watch workout control is outside this first migration.

Do not add a watchOS app or a custom workout-session framework to this migration. Importing existing Apple workouts and tracking on iPhone satisfy the requested native tracking path. GPS and motion observations improve platform behavior; neither is tamper-proof proof of a park visit.

The current source gives **zero new points for logging miles** and **one point for an expedition completion**; preserve historical `walkPoints` and old `pointMiles` adjustments. Manual entries remain available under existing Premium rules. The current “15 miles per day” prompt actually clamps one submission; define and test whether the intended daily aggregate cap should be corrected before claiming parity. Keep the existing 25 km check-in policy visible as a broad proximity rule, not proof of entry at a gate.

Live Activity attributes hold session ID and non-sensitive display name. Content state holds distance, elapsed/start time, paused state, expedition progress, and stale status. No full GPS history or catalog goes into the extension. The host updates it from actual recording events; its view cannot fetch data or run tracking. End it when the walk ends. Support compact, minimal, expanded, and Lock Screen presentations, disabled permissions, and devices without Dynamic Island. Apple limits activity lifetime and payload size; continuation of a long walk must not depend on the island remaining visible. [ActivityKit constraints](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities).

The minimal first release uses a tap/deep link into the recording screen for pause/finish. Adding cross-process interactive pause buttons is not necessary for parity and would need a separate command coordination contract. A filter count never starts a fake ongoing activity.

## Purchases, identity, privacy, and access

Keep Firebase UIDs and email/password/Google sign-in. Add Sign in with Apple as an equivalent native sign-in choice. Link an Apple credential to an authenticated existing account explicitly; never merge accounts solely because two emails look equal. Preserve email verification, password reset, reauthentication, sign-out, profile editing, restore access, and account deletion.

New digital iOS purchases use StoreKit 2 with product metadata from the store, a stable server-issued `appAccountToken`, verified transactions, and a transaction-update listener. The backend validates Apple-signed transaction data with Apple's official Node server library and writes the same normalized entitlement that existing consumers understand. Process notification redelivery, out-of-order events, refunds, revocations, expiry, grace periods, and restore idempotently. Existing Lemon renewals continue through their current webhook. Track entitlement grants by provider before deriving effective access, so a canceled Apple grant cannot overwrite an active Lemon/manual grant. [Apple server library](https://developer.apple.com/documentation/appstoreserverapi/simplifying-your-implementation-by-using-the-app-store-server-library).

Use the App Store purchase flow by default across storefronts. Existing subscribers sign into their existing account to obtain access. Preserve billing management through the appropriate provider, with a storefront-specific review of any external purchase/portal UI before release. Do not assume Bark is a reader app. Support in-app account deletion, explain subscriptions clearly, and supply review access. These are release requirements, not a reason to remove existing users. [App Review Guidelines, sections 3.1, 4.8, and 5.1](https://developer.apple.com/app-store/review/guidelines/).

The public offline catalog is available to everyone. Paid editing/access uses a UID-bound cached entitlement with an explicit validity period; preserve the existing 30-day maximum cache age subject to earlier expiry until a reviewed replacement policy exists. A refresh failure does not erase purchases; a confirmed expiry/revocation changes future access without deleting saved history. A local flag never authorizes a server write.

Use Firebase App Check/App Attest for native requests and retain existing server authorization/rate limits. App Check is not user identity or GPS proof. Stage enforcement so old web clients are not accidentally blocked. [Firebase App Attest](https://firebase.google.com/docs/app-check/ios/app-attest-provider).

Request location, motion, Health, and Photos permissions only at relevant actions. Keep raw route and Health samples on device by default, export only after explicit sharing, and send only the minimal walk summary needed for cloud expedition progress. Remove photo location metadata from support attachments. Preserve current support categories, three-image limits, and email fallback; show clearly whether a report was filed, emailed, or both.
