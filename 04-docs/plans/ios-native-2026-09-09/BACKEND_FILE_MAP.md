# Backend simplification and file contracts

## Keep the platform; simplify the work it performs

Keep JavaScript Firebase Functions and the existing Firestore/Auth project. User confirmed that efficiency, speed, cost, and scaling matter more than the backend language. Use native Swift SDKs on the phone; do not add a Swift server, CloudKit mirror, subscription aggregator, search server, custom tile server, or microservice mesh.

The backend still has necessary responsibilities: protect paid access, preserve existing subscription renewals, apply durable user operations, maintain public scores, publish clean park data, delete accounts safely, run support, and maintain admin tools. There is no honest zero-backend equivalent while preserving these features.

**Do not expect the backend alone to shrink dramatically.** New StoreKit verification and robust native write handling replace some routing/catalog work. The main gains are fewer requests on the hot path, no ORS calls from iOS, no per-user sheet parsing, no raw-GPS writes to Firestore, and isolated responsibilities. File extraction alone does not remove lines or lower a bill.

Keep `barkrangermap-auth` explicitly asserted in all existing functions/hosting/rules predeploy hooks. No proposed asset, function, rule, credential, or deployment targets JDDM. Its migration retirement is recorded as completed September 9 in the ownership guide; historical cleanup checklists are not authority to delete Bark resources. **Never remove Bark's ORS secret while the web app still calls ORS.** [Ownership guide](../../FIREBASE_PROJECT_OWNERSHIP.md).

## Build scope and later cleanup

The [six-phase execution plan](IMPLEMENTATION_PHASES.md) assigns backend work to the native feature that needs it. Build and exercise new code locally/emulators first. No phase deploys functions, changes production rules, installs spreadsheet triggers, migrates users or deletes endpoints. Preserve current account document/collection shapes; B14 is ordinary decoding/patching, not a migration engine.

Retain one concrete callable dispatcher and durable operation receipts for offline retries. Implement only the operation kinds currently needed; no plugin system, event bus, second user database, dual-write mirror or migration service. Unchanged support/admin/operations behavior can remain in its existing module until a justified extraction.

## Target backend source inventory

Prefix: `01-code/functions/`. This is the proposed maintained backend after consumer-web retirement, with legacy billing/support/admin compatibility preserved. Tests/configuration are inventoried separately. Small cohesive modules should stay together; proposed budgets include comments and spacing. Each module exports only the named responsibilities; private validation helpers remain local.

| ID / file | Responsibilities and proposed functions | Calls / called by | Budget |
|---|---|---|---:|
| B01 `index.js` | Thin deployment registry. Binds public function names, regional/runtime options, secrets, schedules, and existing predeploy-compatible exports. No business handlers or top-level network warmups. | Imports handler factories below. | 140 |
| B02 `infrastructure/firebase.js` | `getServices()` creates Admin Auth/Firestore/Storage once; `assertProject()` rejects wrong project; emulator construction is explicit and production credentials never enter test defaults. | Firebase Admin SDK; composition only. | 100 |
| B03 `infrastructure/runtimeConfig.js` | `loadConfig()` validates provider IDs, known hosts, feature switches and limits; `functionOptions(name)` returns per-function secrets/instance settings. No guessed product IDs or secret literals. | Environment/secret bindings; handlers/registry. | 130 |
| B04 `shared/authPolicy.js` | `requireUser`, `requireRecentAuth`, `requireVerifiedEmail`, `requireAdmin`, `requireNotDeleted` return verified caller context. Checks deletion tombstone and applicable App Check policy before privileged work. | Admin Auth/Firestore, SDK callable context; mutation/billing/admin handlers. | 190 |
| B05 `shared/entitlements.js` | `normalizeGrant`, `effectiveEntitlement`, `requireFeature`, `writeEffectiveEntitlement` combine Apple/Lemon/manual/access-code grants without one provider clobbering another. Existing status semantics are fixture-tested against current rules. | Firestore transaction, clock; billing/mutations. | 280 |
| B06 `shared/rateLimits.js` | Retain current shared module's durable quota behavior. `consume`, `consumeInTransaction`, `retryDetails` enforce per-user/global/provider limits and return reset data. Remove ORS-specific constants only after its retirement. | Firestore transactions; all chargeable/abuse-sensitive entry points. | 430 |
| B07 `shared/mutationReceipts.js` | `readReceipt`, `assertFreshOperation`, `writeReceipt`, `assertPayloadMatches` enforce stable operation IDs, payload fingerprints and idempotency. Expired receipt windows reject stale replay instead of blindly applying again. | Firestore transaction; user mutations and provider handlers. | 220 |
| B08 `user/userMutations.js` | `applyUserMutation` validates envelope/UID/kind and dispatches a typed operation; `commitOperation` applies mutation, user update, receipt and changed leaderboard projection transactionally. It does not contain every feature's arithmetic. | B04–B07, B09–B12, B14, B25. | 330 |
| B09 `user/visitMutations.js` | `addVisit`, `removeVisit`, `changeVisitDate`, `removeSelectedVisits` apply exact ID intents against current server data and expected entity fingerprint. Enforce free cap, canonical/retired IDs, shape, and safe bulk intent. Preserve others' concurrent visits. | B05/B14, catalog schema, transaction supplied by B08. | 280 |
| B10 `user/tripMutations.js` | `saveTrip`, `deleteTrip`, `validateTrip` enforce owner, Premium, stop/bookend identities, notes/size/day bounds and expected revision. Return conflict with preserved server version; never replace arbitrary user fields. | B05/B14 and transaction supplied by B08. | 240 |
| B11 `user/expeditionMutations.js` | `assignTrail`, `recordWalk`, `editWalk`, `removeWalk`, `claimCompletion` validate finite distance/source/session ID, dedupe permanent run awards, preserve historical point adjustments and derive totals. Does not trust a submitted total score. | B05/B14, trail definitions, transaction supplied by B08. | 350 |
| B12 `user/profileMutations.js` | `updateProfile`, `updateSettings`, `recordAchievements`, `recordDailyActivity` whitelist fields, preserve earliest badge dates and stronger tiers, validate allowed achievement IDs and daily rules. Admin adjustment uses an explicit audited admin-only operation. | B04/B05/B14; B08 dispatches. | 220 |
| B13 `user/accountDeletion.js` | `requestDeletion`, `resumeDeletion`, `deleteOwnedData` preserve tombstone-first, recent-auth, provider-aware cleanup and retry behavior. Apple billing cannot be canceled by deleting Firebase identity. Keep required billing audit history under a documented retention policy. | B04, Admin Auth/Firestore, Lemon account adapter, support cleanup. | 320 |
| B14 `user/currentSchema.js` | `readUser`, `readTrip`, `applyUserPatch`, `resolveStoredIdentity`, `measureDocumentSize` handle existing field names and legacy date/ID forms. Native operations preserve unknown unrelated fields. Flag unbounded histories before Firestore size limits. | Domain contract fixtures, Firestore values; user/billing/leaderboard handlers. | 280 |
| B15 `billing/appleTransactions.js` | `getAppStorePurchaseContext`, `verifyAppStorePurchase`, `verifySignedTransaction`, `bindOriginalTransaction`, `reconcileSubscription` validate Apple signature/certificate trust via official library, environment, bundle/product IDs, expiry/revocation and account token. Issue/reuse a stable server-owned appAccountToken before purchase; original-transaction binding cannot be stolen by another UID. | Official Apple App Store Server Node library, B04/B05/B07. | 400 |
| B16 `billing/appleNotifications.js` | `appStoreNotifications`, `persistNotification`, `processNotification` verify signed payload, dedupe UUID and apply current provider state even when events arrive out of order. Return success after durable processing; failed/pending receipts remain reprocessable on provider retry, rather than being mistaken for completed duplicates. | B15/B05/B07, Firestore durable work state. | 240 |
| B17 `billing/lemonApi.js` | `createCheckout`, `fetchSubscription`, `listSubscriptions`, `getPortal`, `cancelSubscription` isolate current Lemon HTTPS/URL/config/timeout/retry behavior. One provider adapter, no UI-specific routing logic. | HTTP client/config; Lemon account handlers. | 580 |
| B18 `billing/lemonWebhook.js` | `lemonSqueezyWebhook`, `verifyRawBodySignature`, `normalizeEvent`, `applyEvent` preserve HMAC validation, event ordering, idempotency, cancellation/refund/status semantics and deleted-account behavior. Never remove because new iOS sales use Apple. | B17/B05/B07/B29, Firestore. | 650 |
| B19 `billing/lemonAccount.js` | `createCheckoutSession`, `restorePremiumPurchase`, `getCustomerPortalUrl`, `cancelPremiumSubscription` preserve existing subscriber recovery/management, ownership and email-verification checks. New native paid acquisition calls StoreKit; this still supports legacy web/account management. | B17/B04/B05/B06/B29. | 650 |
| B20 `billing/accessCodes.js` | `redeemAccessOrPromoCode`, `resolveLegacyGrant` preserve current enabled/disabled behavior, expiry and audience semantics. Native promotional UI uses permitted StoreKit offers; do not invent an external-payment bypass. | B04/B05/B06, Firestore; legacy compatibility callers. | 160 |
| B21 `catalog/sourceSheet.js` | `readSourceRows`, `normalizeHeaders`, `sourceRevision` use authenticated Sheets API once per publication. Retain canonical IDs, source coordinates and all approved fields. No client calls to the private Sheets API. | Google APIs; publisher/admin tools. | 170 |
| B22 `catalog/catalogSchema.js` | `normalizePark`, `validateCatalog`, `validateRetirements`, `encodeSnapshot` define the canonical public schema, stable hashing and completeness guard. Approved schema and golden fixtures match Swift decoder. No provider I/O. | Pure JS/crypto; B21/B23/B09/admin. | 260 |
| B23 `catalog/publishCatalog.js` | `publishCatalog`, `publishCandidate`, `promoteManifest`, `writeLegacySnapshot` acquire/coalesce a publication lease, validate full data, upload immutable payload, then compare-and-swap manifest. Mirror old fallback only during coexistence. Failed publish leaves the old pointer intact. | B21/B22, Cloud Storage, Firestore lease; B24/admin sheet write. | 300 |
| B24 `catalog/catalogTriggers.js` | `handleEditSignal`, `reconcileCatalog`, `publishNow` verify HMAC/timestamp/replay protection for script signals, authenticate admin publish, and invoke publication. A low-frequency reconciliation job catches missed/script/formula/import edits. A stalled publisher never blocks a user's launch. | B23/B04/B06, shared secret, clock. | 170 |
| B25 `leaderboard/leaderboard.js` | `calculateScore`, `buildProjection`, `writeIfChanged`, `syncLeaderboardScore` retain unique-site scoring and no-op writes. Native mutations update projection once; old callable stays until web retirement. Rank reads remain paged/aggregated, with deterministic tie semantics. | B14, Firestore transaction; B08/legacy callers. | 290 |
| B26 `support/feedback.js` | `submitFeedback`, `validateReport`, `persistReport`, `deliverReport` preserve categories, guest/email fallback compatibility, durable report ID, attachment limits, and Discord delivery state. Successful file receipt is distinct from delivery success. | B04/B06/B27/B29, Firestore. | 270 |
| B27 `support/feedbackAttachments.js` | Retain magic-byte/size/name validation. `normalizeFeedbackScreenshots`, `sniffImageType`, `decodeBase64Image`, `safeFileName` accept at most three bounded images. Forward then discard bytes under existing policy; no image-storage service is added. | Buffers only; B26. | 125 |
| B28 `support/supportDesk.js` | Retain current three handlers: `ingest`, `interactions`, `processStatusJob`, plus their internal validation/state logic. Preserve email-bank/Discord status reconciliation and secrets. This is independent business tooling, not browser cruft. | Current support integration/Firestore; index exports. | 752 |
| B29 `operations/alerts.js` | `reportFailure`, `postDiscord`, `sendPaymentAlert`, `redactContext` consolidate shared severity/dedup/delivery code. Preserve charged-but-not-entitled alerts and support operational messages. Do not wrap catalog reads in payment alerts. | HTTP/mail adapters, config; support/billing/jobs. | 400 |
| B30 `operations/clientDiagnostics.js` | `reportClientError`, `normalizeDiagnostic`, `buildErrorDigest` accept native/browser typed diagnostics with rate limits and redaction. Daily digest feeds the common daily report; no per-GPS-fix logging or full session replay. | B06/B29, Firestore; native Diagnostics/old clients. | 330 |
| B31 `operations/reports.js` | `dailyOpsMetrics`, `weeklyOpsReport`, `buildBusinessReport` preserve named business/reporting outputs and account reconciliation while sharing collection/window/format logic. Error digest is a section of the daily report after equivalence is verified. | B30/B32/B33/B29, Firestore aggregate reads. | 500 |
| B32 `operations/costMonitoring.js` | `hourlyCostMonitoring`, `evaluateThresholds`, `persistAlertState` retain cost/provider budget alarms and deduped escalation. Managed budget alerts complement this; they are not a spending cap. Never remove billing alarms merely to shorten a file. | B33/B29, Firestore, configured cloud metrics. | 650 |
| B33 `operations/metricsSources.js` | `collectTraffic`, `collectCloudCosts`, `collectAccountCounts`, `collectPurchaseFunnel` adapt existing cost/GA4/GoatCounter metrics with one date-window contract. Native metrics remain distinct from web views; preserve zero vs unavailable semantics. | Google/analytics HTTP APIs, Firestore aggregations, config; B31/B32. | 650 |
| B34 `admin/parkExtraction.js` | `extractParkData`, `validateExtractionInput`, `normalizeAIResult` preserve admin-only text/image extraction, chosen model routing and review candidate output. AI never writes the authoritative sheet without the existing reviewed sync step. | B04/B06, existing Gemini adapter/config; restricted admin web tool. | 180 |
| B35 `admin/sheetEdits.js` | `syncToSpreadsheet`, `matchExistingPark`, `mergeReviewedFields`, `appendApprovedPark` preserve UUIDs, approved append, coordinates/force-geocode and dated notes; trigger catalog publish after successful write. | B04/B21/B22/B23, Google APIs; restricted admin web tool. | 260 |

Apple supplies a supported Node server library for transaction and notification verification; use it rather than hand-written receipt crypto. [Apple App Store Server Library](https://developer.apple.com/documentation/appstoreserverapi/simplifying-your-implementation-by-using-the-app-store-server-library).

## Transitional source retained in addition to that inventory

Do not rename or delete public production endpoints during the initial extraction. The existing web app continues using its current contracts. Extraction preserves behavior and exported names; changes are introduced additively with their own fixtures. These temporary modules are excluded from the post-retirement target budget but included in coexistence cost expectations.

| Transitional file | Responsibilities/calls | Retirement gate |
|---|---|---|
| `legacy/orsHandlers.js` | `getPremiumRoute`, `getPremiumRouteCompact`, `getPremiumGeocode` and route/snap/fallback helpers extracted intact from index; uses remaining ORS modules, auth, entitlement and limiter. | All supported web routing callers retired or moved; zero authorized traffic through an agreed observation window; provider/shared-key dependency review. |
| Existing `orsEndpoints.js` | Endpoint constants. | Same ORS gate. |
| Existing `orsSafety.js` | Provider retry/admission/error behavior. | Same ORS gate. |
| Existing `orsTelemetry.js` | Existing ORS request accounting. | Same ORS gate; retain audit history. |
| Existing `routeRequestStrategy.js` | Recovery/fallback decision policy. | Same ORS gate. |
| Existing `routeResponseCompact.js` | Compact response translation for beta callers. | Same ORS gate. |
| Existing `catalogSnapshot.js` and `dataIntegrity.js` | Old CSV fallback response and weekly publication behavior until replacement has proven compatibility. | Web catalog callers retired; native public assets verified; rollback window complete. |

Existing `supportDesk.js`, `feedbackAttachments.js`, and rate limits can be moved without behavior rewrites. Existing `opsDiscord.js`, `opsMetrics.js`, `analyticsReporting.js`, `businessReporting.js`, `costMetrics.js`, `costReporting.js`, `ga4Metrics.js`, and `healthMonitoring.js` map to B29–B33. Consolidate only duplicated work; preserve unique report fields and alerts in comparison fixtures. Backend reduction budgets are contingent on that consolidation succeeding.

## All 24 current exported functions

| Current export | Native/migration disposition |
|---|---|
| `getPremiumRoute` | iOS uses MapKit; retain for web, then ORS retirement gate. |
| `getPremiumRouteCompact` | Same; its `minInstances: 1` is a potential standing-cost removal only after web routing retirement. |
| `getPremiumGeocode` | iOS uses MapKit search; retain for web, then retire. |
| `createCheckoutSession` | Native sales use StoreKit; retain legacy/web billing acquisition as long as it remains offered. Audit its current warm-instance setting with real demand. |
| `redeemAccessOrPromoCode` | Preserve current legacy grants and disabled/enabled policy; App Store offers handle new native promotions. |
| `getCustomerPortalUrl` | Preserve for existing Lemon accounts; choose provider-specific management in native UI. |
| `restorePremiumPurchase` | Preserve Lemon recovery; native Apple restore is a separate verified transaction flow. |
| `cancelPremiumSubscription` | Preserve Lemon cancellation; Apple customers use Apple subscription management. |
| `lemonSqueezyWebhook` | Keep while any Lemon billing lifecycle can generate relevant events. |
| `syncLeaderboardScore` | Keep for old clients; native mutations update projection atomically; later remove public compatibility callable only. |
| `submitFeedback` | Reuse with native metadata/durable receipt and current limits. |
| `supportDeskIngest` | Keep support automation. |
| `supportDeskInteractions` | Keep support automation. |
| `supportDeskStatusJob` | Keep support automation. |
| `deleteAccount` | Preserve and adapt for Apple provider references and additional local/native server records. |
| `reportClientError` | Reuse with a native diagnostic schema; reduce frequency, not failure visibility. |
| `dailyErrorDigest` | Merge its content into daily ops only after output equivalence; then retire the duplicate schedule. |
| `weeklyCatalogSnapshot` | Keep during transition; replace with publisher reconciliation/immutable catalog history when web fallback no longer needs it. |
| `catalogSnapshot` | Keep CSV response for web; native reads public revisioned JSON directly. |
| `dailyOpsMetrics` | Keep shared daily business report. |
| `weeklyOpsReport` | Keep weekly business report. |
| `hourlyCostMonitoring` | Keep cost alerting; update service inventory after routing retires. |
| `extractParkData` | Keep restricted admin refinery. |
| `syncToSpreadsheet` | Keep reviewed admin writes; add accepted-write publication signal. |

Additive entry points: `applyUserMutation`, `getAppStorePurchaseContext`, `verifyAppStorePurchase`, `appStoreNotifications`, `publishCatalog` (authenticated/admin or verified edit signal), and `catalogReconcile` (scheduled). An offline credential-cache lookup does not require another endpoint. Catalog freshness reads do not invoke a function.

Endpoint count may initially increase. Do not claim that 24 functions turn into two while preserving all these workflows. Fewer billable requests and clearer ownership are the useful improvements.

## Spreadsheet signal: the only new Apps Script

Proposed separate directory `05-tools/google-apps-script/catalog-publication/`, independent of the user-edited support email bank:

| File | Functions/responsibility | Calls |
|---|---|---|
| `Code.js` | `installTriggers()` creates the approved edit/change triggers; `onCatalogEdit(event)` filters relevant tab/range; `onCatalogChange(event)` requests reconciliation for structural changes; `requestPublication()` sends a timestamped HMAC signal; `publishNow()` reports an accepted/pending publication result to the curator. No parsing or row mutation here. Estimated 100–160 physical lines. | Apps Script trigger/Properties/UrlFetch APIs → `publishCatalog` endpoint. |
| `appsscript.json` | Minimal scopes, timezone and runtime declaration; no secret values. | Apps Script runtime. |
| `README.md` | Exact ownership/setup, signal-secret storage/rotation, edit/API-trigger limitations, retries and manual publish procedure. | Curator/operator. |

Store the signal secret in script properties and server secrets, never in the sheet, iOS bundle, or repository. Direct edit signals are best effort; reconciliation covers missed events. Avoid Drive notification channel registration/renewal unless measured trigger gaps require that extra infrastructure.

## Authoritative native mutation protocol

Request contains a schema version, stable operation ID, entity type/ID, expected entity fingerprint or revision, and narrowly typed payload. UID comes from verified auth, not the payload. Server receipt contains operation ID, accepted/conflict/rejected result, entity version and server time. Mismatched reuse of an operation ID is rejected.

The backend must not trust a client-written `premium`, `score`, `isAdmin`, `verifiedByServer`, or entitlement object. Location evidence is recorded as a submitted observation; abuse resistance does not make it unforgeable. Existing web writes remain a compatibility risk until their write paths are retired and rules can be tightened.

For old-array coexistence, transactionally read the latest aggregate and touched entity. Preserve unrelated entries and fields, enforce record-size bounds, and compare expected content. Avoid per-visit document migration and two-way mirrors in the first release. Once old writers are gone, evaluate subcollections for unbounded walk histories/trip data with a separate versioned migration; this is a scale gate, not an invisible requirement omitted from estimates.

New internal mutation receipts, provider grants, notification state, and publication leases are server-only collections. Extend the existing rules with explicit denies/owner reads as needed and keep the existing `users/{uid}`, `savedRoutes`, achievements and deletion protections. Admin SDK bypasses client rules, so handler validation and tests are mandatory.

## Cost and performance model

Measure **catalog bytes per session, callable requests per mutation, Firestore reads/writes, route calls, standing instances, cold-start time and notification work**. The rewrite does not make hosting, storage, paid subscriptions or monitoring free.

For a catalog with revisioned payload size S and U cold/foreground checks, unchanged checks transfer a small manifest or 304 rather than U full CSV downloads. Only clients behind the current revision fetch S. Publication cost depends on source edits/reconciliation, not user count. At the current few hundred parks, whole validated JSON snapshots are simpler than per-row deltas.

For a walk, local samples/checkpoints do not produce cloud writes. One completed-walk operation plus receipt/projection work replaces per-sample cloud traffic (and avoids introducing it where the current app already batches). For visits/trips, idempotency prevents retries from duplicating writes/points. Request counts should be measured because reading receipts also has a cost.

MapKit removes iOS requests to Bark's ORS proxies. That can reduce provider/quota and warm-route-instance costs after supported web callers retire. It does not establish an unlimited routing allowance, precise dollar saving, or identical route quality. Test actual remote-park coordinates and throttle handling before retiring the fallback.

Keep all current production resources intact through planning and native development. Use explicit deployment allowlists, project checks, backups and rollback receipts during implementation. Do not deploy or delete resources as a side effect of extracting files.
