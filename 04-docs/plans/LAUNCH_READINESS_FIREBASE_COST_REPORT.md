# BARK Ranger Map Launch Readiness and Firebase Cost Report

Date: 2026-05-09
Scope: codebase audit, Firebase cost/read-write model, Lemon Squeezy entitlement audit, QA/release readiness.
Repo: `/Users/carterswarm/BarkRangerMap`

Confirmed findings are based on the repository as inspected on 2026-05-09. Assumptions are labeled explicitly.

## Official Sources Checked

- Firestore pricing and billing: https://cloud.google.com/firestore/pricing and https://firebase.google.com/docs/firestore/pricing
- Firebase pricing for Auth, Firestore, Functions, Hosting: https://firebase.google.com/pricing
- Firestore best practices: https://firebase.google.com/docs/firestore/best-practices
- Firebase Functions environment/secrets: https://firebase.google.com/docs/functions/config-env
- Lemon Squeezy webhooks, signing, event lifecycle, subscriptions, test mode, checkout, customer portal, refunds/chargebacks:
  - https://docs.lemonsqueezy.com/help/webhooks/webhook-requests
  - https://docs.lemonsqueezy.com/help/webhooks/signing-requests
  - https://docs.lemonsqueezy.com/help/webhooks/event-types
  - https://docs.lemonsqueezy.com/help/products/subscriptions
  - https://docs.lemonsqueezy.com/help/getting-started/test-mode
  - https://docs.lemonsqueezy.com/api/checkouts/create-checkout
  - https://docs.lemonsqueezy.com/help/online-store/customer-portal
  - https://docs.lemonsqueezy.com/help/payments/refunds-chargebacks

Key documentation facts applied:

- Firestore bills document reads/writes/deletes, storage, network, aggregation queries, and index entries read; realtime listeners charge document reads when documents are added/updated/removed from the listener result and can re-bill after reconnects.
- Firestore free quota exists for one free database per project, but production launch planning should use gross cost and budget alerts rather than relying on free quota.
- Firestore best practices recommend cursors instead of offsets, query limits, avoiding hotspot documents and high write rates to narrow key ranges, using asynchronous/parallel reads where possible, and keeping security rules efficient.
- Security rules `get()`, `exists()`, and `getAfter()` can add billed reads. Current `firestore.rules` uses `exists()`/`get()` only for saved-route premium checks; hot visited-place and leaderboard rules do not use them.
- Firebase Functions billing includes invocations, compute time/memory/CPU, outbound networking, and related Google Cloud usage. Secrets are supported via environment/secrets configuration; this repo uses `runWith({ secrets: [...] })`.
- Lemon Squeezy webhook signing uses an HMAC SHA256 signature over the raw request body. Webhook retries and duplicate deliveries should be expected, so handlers must be idempotent.
- Lemon Squeezy test mode is separate from live mode. Test-mode checkouts/events are not a substitute for a live payment launch. **Project note:** the current test-mode-only implementation is a known intentional pre-release state and should be the final controlled switch before the release candidate, after the non-payment safety fixes are complete. **Owner approval lock: DO NOT TAKE OUT UNTIL CARTER APPROVES.** When Carter approves the live-mode switch, beta testers should be routed through real paid Lemon Squeezy checkout.
- Lemon Squeezy subscription docs describe active, cancelled, expired, past due/unpaid, and resumed lifecycle behavior; cancelled subscriptions generally retain access until the paid period ends, while expired subscriptions should not.

## 1. Executive Summary

Launch recommendation: **YELLOW for a very limited private beta only. RED for paid public launch tomorrow.**

If launched tomorrow to a small private beta, the map, CSV-backed public park data, local search/filtering, signed-in visited-place sync, basic premium gating UI, route callable entitlement checks, and Lemon Squeezy test-mode checkout flow would probably work well enough to learn from real users.

If launched tomorrow to a Facebook group or paid public launch, the biggest problems would be:

- **Payment readiness:** checkout and webhooks are currently hard-coded for Lemon Squeezy test mode in `functions/index.js`. This is known and intentional for pre-release testing; it should be the last owner-approved release-candidate switch, not the first thing to change while the rest of the safety work is still moving.
- **Entitlement state correctness:** webhook signature verification, durable processed-event receipts, and provider timestamp/rank ordering now exist in test mode. The remaining paid-launch gap is final live-mode verification plus chargeback/dispute policy.
- **Security/data integrity:** clients cannot self-grant `entitlement`, the free tracked-visit cap is rules-enforced at 5, and leaderboard writes are now server-authoritative through a callable. Clients can still write achievement documents, and the score input data is still partly client-authored.
- **Cost/scalability:** normal use is likely cheap. Pathological use can produce the observed 9,000 reads and 3,000 writes per user/day. The leaderboard itself uses cursor pagination, not full reads, but repeated exact-rank aggregation can still add hidden cost and latency.
- **QA readiness:** functions/rules/function-emulator tests pass. Post-Stage-0 QA now has local ignored free, premium/test-entitlement, and second-account storage states; the full signed-in Playwright smoke passed 40/40 against a local static server.

Biggest risk: **payment entitlement and data integrity**, not raw Firestore cost.

Launch readiness score: **54 / 100**

| Area | Score | Reason |
|---|---:|---|
| Product readiness | 62 | Core app exists, but mobile/payment/support launch polish is not proved. |
| Firebase cost readiness | 70 | Normal Firestore usage should be cheap; budgets/alerts/kill switches are not confirmed. |
| Firestore efficiency | 66 | Public park data is outside Firestore and leaderboard pages are cursor-based, but duplicate user-doc listeners and repeated rank aggregation remain. |
| Payment reliability | 58 | Signature, idempotency, ordering, and state-machine tests are stronger; live mode is still intentionally locked until final RC approval. |
| Entitlement correctness | 62 | Server writes entitlement and client reads it read-only; past-due, cancelled-active, and refunded states are now explicit. |
| Security rules | 68 | Entitlement protected, free visit cap is rules-enforced, and direct leaderboard writes are denied; achievements remain abusable. |
| Bug risk | 52 | Many smoke tests exist; launch-critical E2E is not yet green in this environment. |
| Mobile readiness | 45 | Not deeply verified in this pass yet; known Android/search/zoom concerns remain. |
| Monitoring/rollback readiness | 35 | No confirmed budget alerts, dashboards, App Check enforcement, or feature flags. |
| Support/refund readiness | 40 | Portal URL exists, but refund/chargeback policy and repair tooling are incomplete. |

## 2. Current Architecture Map

### Frontend Structure

- `index.html` loads a static browser app from many plain JS modules.
- State is shared through `window.BARK`, legacy globals, and modules such as `modules/barkState.js`, `state/appState.js`, `repos/VaultRepo.js`, `repos/ParkRepo.js`.
- Static hosting is configured from repo root in `firebase.json`, with `functions`, tests, `plans`, and docs ignored from hosting deployment.

### Public Park/Pin Data

Confirmed: public park/pin data is **not loaded from Firestore**. `modules/dataService.js` loads a published Google Sheets CSV, caches it in `localStorage`, and falls back to `assets/data/bark-fallback.csv`. It polls the Google Sheet every 5 minutes and on refocus after at least 60 seconds. Firestore cost for map browsing/search is therefore near zero, except leaderboard/user/account paths.

Risk: Google Sheets polling is external bandwidth/latency risk, not Firestore cost. It can still affect launch UX if the Sheet is slow or blocked.

### Firebase Auth Usage

- `services/authService.js` initializes Firebase and registers `firebase.auth().onAuthStateChanged`.
- Signed-in users start two realtime listeners on the same user document:
  - `repos/VaultRepo.js` listens to `users/{uid}` for `visitedPlaces`.
  - `services/authService.js` also listens to `users/{uid}` for entitlement, settings, admin, streak, walk/expedition state.
- Account switch handling stops the old user snapshot, stops the `VaultRepo` visit subscription when UID changes, resets premium entitlement, and clears account-scoped runtime state.

Risk: no obvious listener leak was found, but the double listener causes duplicate initial reads and duplicate listener update reads for every user-doc write.

### Firestore Collections/Subcollections

Confirmed paths from code and rules:

- `users/{uid}`: profile fields, settings, `visitedPlaces`, entitlement, streak, walk/expedition state, score mirrors.
- `users/{uid}/savedRoutes/{routeId}`: saved route documents, cursor-paginated.
- `users/{uid}/achievements/{achievementId}`: client-created achievement stamps.
- `leaderboard/{uid}`: public leaderboard rows, read by clients and written by the server-side `syncLeaderboardScore` callable.
- `system/leaderboardData`: hourly top-100 aggregate written by a scheduled function but not currently used by the frontend leaderboard.
- `_adminRateLimits/{action_uid_window}`: admin callable rate limits.
- `_premiumCallableRateLimits/{action_uid_window}`: server-written per-user rate limits for premium route/geocode callables.
- `_lemonSqueezyWebhookEvents/{sha256(providerEventId)}`: server-written durable Lemon Squeezy webhook receipts for duplicate/out-of-order protection.
- `feedback/{autoId}` is written by `modules/uiController.js`, but no matching allow rule exists in `firestore.rules`; likely denied in production rules.

### Cloud Functions

Main file: `functions/index.js`.

- Premium ORS callables: `getPremiumRoute`, `getPremiumGeocode`.
- Payment callables/webhooks: `createCheckoutSession`, `lemonSqueezyWebhook`.
- Leaderboard callable: `syncLeaderboardScore`.
- Scheduled aggregate: `generateHourlyLeaderboard`.
- Admin spreadsheet/Gemini functions exist later in `functions/index.js`.
- Secrets are bound with `runWith({ secrets: [...] })` for Lemon Squeezy API/webhook keys.

### Major Feature Map

| Feature | Main files | Data read paths | Data write paths | Auth required | Free vs Premium | Known risks |
|---|---|---|---|---|---|---|
| Map/pins | `modules/dataService.js`, `repos/ParkRepo.js`, `modules/mapEngine.js`, `modules/renderEngine.js` | Google Sheets CSV/static fallback | Local cache only | No | Free | External Sheet availability; not Firestore cost. |
| Search/filter | `modules/searchEngine.js`, `services/authPremiumUi.js` | Local `ParkRepo`; premium geocode callable | Local UI state | No for local; yes/premium for global | Local free; global premium | Geocode abuse if premium and unthrottled. |
| Visited places | `services/checkinService.js`, `services/firebaseService.js`, `repos/VaultRepo.js`, `firestore.rules` | `users/{uid}` snapshot | `users/{uid}.visitedPlaces` whole-array writes | Yes for cloud | Free 5 cap rules-enforced; premium more | Duplicate listeners; premium document growth. |
| Stats/passport | `modules/profileEngine.js`, `gamificationLogic.js` | Local visits/parks; achievements subcollection once/session | Achievement batch writes | Yes for persisted achievements | Mostly free | Achievement spoofing. |
| Leaderboard | `modules/profileEngine.js`, `renderers/leaderboardRenderer.js`, `functions/index.js` scheduled top 100 and `syncLeaderboardScore` callable | `leaderboard` limited queries; REST aggregation; unused `system/leaderboardData` | Server callable writes `leaderboard/{uid}` from user data | Read public; sync signed-in | Main pagination is already good | Source data still partly client-authored; repeated rank aggregation. |
| Routes/trips | `renderers/routeRenderer.js`, `services/firebaseService.js`, `services/orsService.js`, `functions/index.js` | Premium saved route subcollection; ORS callable | Premium saved route docs, owner deletes | Save/load yes and premium; delete owner cleanup | Manual planning free; save/load and route generation premium | Route callable spam; saved-route shape not validated. |
| Premium/paywall | `modules/paywallController.js`, `services/premiumService.js`, `services/authPremiumUi.js` | User entitlement listener | Checkout callable only; webhook writes entitlement | Yes | Premium unlocks tools | Test-mode-only live blocker. |
| Account/profile | `services/authService.js`, `services/authAccountUi.js` | Firebase Auth, `users/{uid}` listener | Profile seed/settings writes | Yes | Same; billing visible by entitlement | Account-switch must stay tested. |
| Feedback | `modules/uiController.js` | None | `feedback.add()` | No/optional | All users | Rules likely deny. |

Local caching/session state:

- `modules/dataService.js` caches CSV in `localStorage`.
- `modules/searchEngine.js` caches global geocode results in memory with a 50-entry cap.
- `repos/VaultRepo.js` owns the in-memory visits `Map` and pending mutation reconciliation.
- `modules/barkState.js` exposes legacy globals and a `SESSION_MAX_REQUESTS` client safety counter.
- `services/premiumService.js` stores entitlement in memory and checks UID metadata before returning premium active.

Risky duplicate/global state:

- `window.BARK` plus legacy globals (`window.currentWalkPoints`, `window._lastSyncedScore`, `window._leaderboardLoadedOnce`, `window._lastLeaderboardDoc`) create cross-module coupling.
- `users/{uid}` is both the auth/entitlement/settings document and the whole visited-place storage document, so one write wakes both listeners.
- `system/leaderboardData` exists but is not consumed by the current leaderboard UI, leaving an optimization unused.

### Payment/Lemon Squeezy Integration

Main files:

- `functions/index.js`
- `modules/paywallController.js`
- `services/premiumService.js`
- `services/authAccountUi.js`
- `functions/tests/checkout-session.test.js`
- `functions/tests/lemonsqueezy-webhook.test.js`

Confirmed:

- Checkout creation is server-side callable and uses Lemon Squeezy `/v1/checkouts`.
- Webhook signature verification uses raw-body HMAC SHA256 and timing-safe compare.
- Entitlement is written server-side into `users/{uid}.entitlement`.
- Webhook processing now writes durable processed-event receipts in `_lemonSqueezyWebhookEvents` and ignores duplicate or stale/out-of-order events in a Firestore transaction.
- Client premium checks are read-only through `services/premiumService.js`.

Release-candidate switch:

- `buildLemonSqueezyCheckoutPayload()` sets `attributes.test_mode: true`.
- `mapLemonSqueezyEntitlement()` ignores webhooks unless `attributes.test_mode === true`.
- Lemon Squeezy official docs state live mode requires live API keys and test-mode API keys interact with test data only.

That is fine for beta testing and is a known intentional state. Treat the live-mode conversion as the **last owner-approved release-candidate change** after entitlement ordering, limits, leaderboard integrity, QA, budget alerts, and monitoring are ready. **DO NOT TAKE OUT UNTIL CARTER APPROVES.** Once Carter approves removing test mode, beta testers should be expected to pay through the real Lemon Squeezy checkout flow. It remains a hard gate for public paid launch.

## 3. Firestore Read/Write Cost Model

Pricing assumptions for the model:

- Assumption: Firestore Standard edition, US regional pricing. If the database is multi-region, operation prices can be higher; verify the actual Firebase project location before launch.
- Firestore pricing source says usage is billed for document reads/writes/deletes, index entries read, storage, and network bandwidth.
- Free quota source says one free database per project gets 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, 1 GiB stored data, and 10 GiB/month outbound transfer. This model shows gross cost and does not rely on free quota for safety.
- Price used in calculations: reads $0.03/100k, writes $0.09/100k, deletes $0.01/100k, storage $0.18/GiB-month.

Behavior assumptions:

| Profile | Reads/user/day | Writes/user/day | Deletes/user/day | Storage growth/user/month | Notes |
|---|---:|---:|---:|---:|---|
| A. Light free | 10 | 1 | 0 | 3 KB | Open app, local search, initial leaderboard, little/no account use. |
| B. Normal free | 80 | 35 | 0 | 25 KB | Sign in, up to 5 tracked visits, profile/passport/stats, one leaderboard visit and a few pages. |
| C. Heavy premium | 600 | 400 | 5 | 250 KB | 100-300 saves, route planner, stats, achievements, repeat visits. |
| D. Stress/abuse | 9,000 | 3,000 | 10 | 1 MB | Based on observed stress test; pathological, not normal use. |

### A. Light free user

| DAU | Reads/day | Writes/day | Deletes/day | Storage growth/mo | Cost/day | Cost/mo | Cost/year | Cost/user/day | Paying users @ $9.99/yr |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 500 | 50 | 0 | 0.1 MB | $0.0002 | $0.0059 | $0.0715 | $0.0000 | 0.0 |
| 100 | 1,000 | 100 | 0 | 0.3 MB | $0.0004 | $0.0118 | $0.1430 | $0.0000 | 0.0 |
| 250 | 2,500 | 250 | 0 | 0.7 MB | $0.0010 | $0.0294 | $0.3574 | $0.0000 | 0.0 |
| 500 | 5,000 | 500 | 0 | 1.5 MB | $0.0019 | $0.0588 | $0.7148 | $0.0000 | 0.1 |
| 1,000 | 10,000 | 1,000 | 0 | 2.9 MB | $0.0039 | $0.1175 | $1.43 | $0.0000 | 0.1 |
| 2,500 | 25,000 | 2,500 | 0 | 7.3 MB | $0.0097 | $0.2938 | $3.57 | $0.0000 | 0.4 |
| 5,000 | 50,000 | 5,000 | 0 | 14.6 MB | $0.0195 | $0.5876 | $7.15 | $0.0000 | 0.7 |
| 10,000 | 100,000 | 10,000 | 0 | 29.3 MB | $0.0390 | $1.18 | $14.30 | $0.0000 | 1.4 |

### B. Normal free user

| DAU | Reads/day | Writes/day | Deletes/day | Storage growth/mo | Cost/day | Cost/mo | Cost/year | Cost/user/day | Paying users @ $9.99/yr |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 4,000 | 1,750 | 0 | 1.2 MB | $0.0028 | $0.0835 | $1.02 | $0.0001 | 0.1 |
| 100 | 8,000 | 3,500 | 0 | 2.4 MB | $0.0055 | $0.1669 | $2.03 | $0.0001 | 0.2 |
| 250 | 20,000 | 8,750 | 0 | 6.1 MB | $0.0139 | $0.4173 | $5.08 | $0.0001 | 0.5 |
| 500 | 40,000 | 17,500 | 0 | 12.2 MB | $0.0278 | $0.8346 | $10.15 | $0.0001 | 1.0 |
| 1,000 | 80,000 | 35,000 | 0 | 24.4 MB | $0.0555 | $1.67 | $20.31 | $0.0001 | 2.0 |
| 2,500 | 200,000 | 87,500 | 0 | 61.0 MB | $0.1387 | $4.17 | $50.77 | $0.0001 | 5.0 |
| 5,000 | 400,000 | 175,000 | 0 | 122.1 MB | $0.2775 | $8.35 | $101.54 | $0.0001 | 10.0 |
| 10,000 | 800,000 | 350,000 | 0 | 244.1 MB | $0.5550 | $16.69 | $203.09 | $0.0001 | 20.1 |

### C. Heavy premium user

| DAU | Reads/day | Writes/day | Deletes/day | Storage growth/mo | Cost/day | Cost/mo | Cost/year | Cost/user/day | Paying users @ $9.99/yr |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 30,000 | 20,000 | 250 | 12.2 MB | $0.0270 | $0.8129 | $9.89 | $0.0005 | 1.0 |
| 100 | 60,000 | 40,000 | 500 | 24.4 MB | $0.0540 | $1.63 | $19.78 | $0.0005 | 2.0 |
| 250 | 150,000 | 100,000 | 1,250 | 61.0 MB | $0.1351 | $4.06 | $49.45 | $0.0005 | 4.9 |
| 500 | 300,000 | 200,000 | 2,500 | 122.1 MB | $0.2702 | $8.13 | $98.90 | $0.0005 | 9.8 |
| 1,000 | 600,000 | 400,000 | 5,000 | 244.1 MB | $0.5405 | $16.26 | $197.80 | $0.0005 | 19.5 |
| 2,500 | 1,500,000 | 1,000,000 | 12,500 | 610.4 MB | $1.35 | $40.64 | $494.49 | $0.0005 | 48.8 |
| 5,000 | 3,000,000 | 2,000,000 | 25,000 | 1.19 GiB | $2.70 | $81.29 | $988.99 | $0.0005 | 97.6 |
| 10,000 | 6,000,000 | 4,000,000 | 50,000 | 2.38 GiB | $5.40 | $162.58 | $1,977.97 | $0.0005 | 195.3 |

### D. Stress/abuse user

| DAU | Reads/day | Writes/day | Deletes/day | Storage growth/mo | Cost/day | Cost/mo | Cost/year | Cost/user/day | Paying users @ $9.99/yr |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 450,000 | 150,000 | 500 | 50.0 MB | $0.2700 | $8.11 | $98.67 | $0.0054 | 9.7 |
| 100 | 900,000 | 300,000 | 1,000 | 100.0 MB | $0.5401 | $16.22 | $197.35 | $0.0054 | 19.5 |
| 250 | 2,250,000 | 750,000 | 2,500 | 250.0 MB | $1.35 | $40.55 | $493.37 | $0.0054 | 48.7 |
| 500 | 4,500,000 | 1,500,000 | 5,000 | 500.0 MB | $2.70 | $81.10 | $986.74 | $0.0054 | 97.4 |
| 1,000 | 9,000,000 | 3,000,000 | 10,000 | 1000.0 MB | $5.40 | $162.21 | $1,973.47 | $0.0054 | 194.8 |
| 2,500 | 22,500,000 | 7,500,000 | 25,000 | 2.44 GiB | $13.50 | $405.51 | $4,933.69 | $0.0054 | 487.1 |
| 5,000 | 45,000,000 | 15,000,000 | 50,000 | 4.88 GiB | $27.00 | $811.03 | $9,867.37 | $0.0054 | 974.2 |
| 10,000 | 90,000,000 | 30,000,000 | 100,000 | 9.77 GiB | $54.01 | $1,622.06 | $19,734.74 | $0.0054 | 1948.4 |

### Cost Interpretation

- Normal Firestore operation cost is not the main launch blocker. At 500 normal free users/day, gross Firestore cost is about **$0.83/month**. At 1,000 normal free users/day, gross Firestore cost is about **$1.67/month**.
- A heavy all-premium day at 1,000 DAU is still about **$16.26/month** in Firestore operations/storage by this model. The more important premium costs are Functions/ORS usage, support, and payment correctness.
- The observed 9,000 reads/3,000 writes stress profile is pathological. At 1,000 users/day all behaving like that, Firestore would be about **$162/month**; at 10,000/day, about **$1,622/month**. That is survivable for a short incident only if budget alerts and kill switches exist.
- The free 5-visit limit now meaningfully limits user-document growth, write opportunities, and product-tier bypass for free users through both client checks and Firestore rules.

## 4. Firestore Efficiency Audit

Initial confirmed rankings:

| Area | Rank | Evidence | Recommendation |
|---|---|---|---|
| Public park data/search/filter | Excellent | `modules/dataService.js`, `modules/searchEngine.js`; CSV/local repo, no Firestore park reads. | Keep public catalog outside Firestore or serve static JSON/CSV from CDN/Hosting. |
| Leaderboard pagination | Good | `modules/profileEngine.js` uses `limit(5)` and `startAfter(window._lastLeaderboardDoc)`. | Keep the current cursor UX; exact-rank caching is watchlist-only unless monitoring shows a problem. |
| Leaderboard rank lookup | Risky | REST `runAggregationQuery` in `fetchExactLeaderboardRankForScore()` runs on load, load-more, and score sync. | Cache rank for session/TTL; compute rank snapshots server-side for active users. |
| User document listeners | Acceptable/Risky | `VaultRepo.startSubscription()` and `authService` both listen to `users/{uid}`. | Merge or split data so one listener handles user doc, or move `visitedPlaces` to a subcollection if it grows. |
| Visited places writes | Acceptable/Risky | Every mark/unmark writes whole `visitedPlaces` array on `users/{uid}`. | Fine at 5 free visits; for premium 300+ visits, move to `users/{uid}/visitedPlaces/{parkId}` or enforce max document size guard. |
| Free visit limit | Improved | `services/checkinService.js` and `firestore.rules` enforce 5 for non-premium users. | Keep rules tests green; consider callable/subcollection only if premium document growth becomes painful. |
| Entitlement writes | Good/RC switch pending | Rules block client entitlement fields; server webhook writes entitlement. | First add processed event storage; switch live/test mode as the final RC change. |
| Achievements | Risky | Client reads/writes `users/{uid}/achievements`; rules validate shape, not criteria. | Server-calculate achievements or treat as cosmetic only. |
| Feedback | Broken/Risky | `modules/uiController.js` writes `feedback`, rules deny arbitrary top-level collections. | Add a safe feedback rule/function or remove UI until fixed. |

### Operation-Level Audit

| Feature | File/function | Firestore operation | Trigger | Documents read/written | Frequency | Risk | Fix |
|---|---|---|---|---|---|---|---|
| App boot, signed out | `services/authService.js` auth null branch | `leaderboard.orderBy(...).limit(5).get()` | Auth state resolves with no user | 5 leaderboard docs | Once per boot/auth null | Acceptable | Use `system/leaderboardData` to make this 1 doc. |
| Auth sign-in | `services/authService.js` `onAuthStateChanged` | `users/{uid}.onSnapshot()` | User signs in | 1 doc initial, then every user-doc update | Long-lived | Risky duplicate listener | Merge with `VaultRepo` listener or split visited data. |
| Visited load | `repos/VaultRepo.js` `startSubscription` | `users/{uid}.onSnapshot()` | User signs in | 1 doc initial, then every user-doc update | Long-lived | Risky duplicate listener | Same as above. |
| Account switch/logout | `authService.stopUserSnapshotSubscription`, `VaultRepo.stopSubscription` | Unsubscribe | Auth state changes | No read/write | Every switch/logout | Good | Keep. |
| Create profile | `services/authAccountUi.js` `saveCreatedAccountProfile` | `users/{uid}.set(...merge)` | Email/password account create | 1 write | Account create | Good | Keep protected entitlement fields denied. |
| Mark visited | `services/checkinService.js` `markAsVisited`; `firebaseService.syncUserProgress` | `users/{uid}.set({visitedPlaces})` | User taps mark | 1 write of full array; listener update reads | Per mark | Risky at scale; free limit client-only | Server enforce limit; consider subcollection for premium. |
| Unmark visited | `checkinService.markAsVisited`; `firebaseService.updateCurrentUserVisitedPlaces` | `users/{uid}.update({visitedPlaces})` | User unmarks | 1 write of full array | Per unmark | Acceptable | Keep, but callable/rules guard destructive writes. |
| Verified GPS check-in | `checkinService.verifyGpsCheckin` | `users/{uid}.update({visitedPlaces})` | Geolocation succeeds | 1 write of full array | Per check-in | Client-side GPS trust | Server-side GPS is hard; keep as honor/verified split or validate tighter. |
| Daily streak | `firebaseService.attemptDailyStreakIncrement` | `users/{uid}.get()`, `set(streak)` | Mark/check-in queues once/day | 1 read + 1 write first mark/day | Daily/user | Acceptable | Move into same callable as visit write later. |
| Canonicalization | `VaultRepo.handleVisitedSnapshot`; `firebaseService.normalizeLocalVisitedPlacesToCanonical` | `users/{uid}.update({visitedPlaces})` if changed | Snapshot/data load | 0 or 1 write | Rare | Acceptable, but surprise writes | Log/write once; avoid repeated snapshot loops. |
| Achievements load/write | `gamificationLogic.js` `evaluateAndStoreAchievements` | `users/{uid}/achievements.get()`, batch `set()` | Profile/stats/share evaluation | Reads all achievement docs once/session, writes new/upgraded | Session/profile changes | Risky integrity | Server-derived or mark cosmetic. |
| Stats/passport | `modules/profileEngine.js` | Local compute from `VaultRepo` and `ParkRepo` | Profile render | No direct Firestore | Frequent UI | Good | Keep local. |
| Leaderboard score sync | `modules/profileEngine.js` `syncScoreToLeaderboard`; `functions/index.js` `syncLeaderboardScore` | Client calls callable; server reads `users/{uid}` and writes `users/{uid}` score mirrors plus `leaderboard/{uid}` | Score changes, debounced | 1 callable, 1 user-doc read, 2 server writes, optional rank aggregation | Debounced but repeated with marks/walks | Better integrity; source data still partly client-authored | Done for direct leaderboard writes; later harden source inputs if needed. |
| Leaderboard initial | `profileEngine.loadLeaderboard` | `leaderboard.limit(5).get()` | Auth boot/profile | 5 doc reads + optional aggregation | Once/session or manual | Good/Risky | Use cached top doc and rank TTL. |
| Leaderboard See More | `profileEngine.loadMoreLeaderboard` | `startAfter(lastDoc).limit(5).get()` | User clicks | 5 doc reads + optional aggregation | Per click | Good pagination; optional aggregation risk | No offset; keep UX; exact-rank cache only if monitoring shows a problem. |
| Saved routes list | `firebaseService.loadSavedRoutes` | Premium-gated `users/{uid}/savedRoutes.orderBy(...).startAfter(cursor).limit(n).get()` | Route panel | 3 initial, 5 more | Per panel/page | Good; now premium-only | Keep cursor pagination and premium rules check. |
| Saved route open/delete | `firebaseService.loadSavedRoute/deleteSavedRoute` | Premium-gated one doc get; owner cleanup delete | User action | 1 read or 1 delete | User action | Good; load now premium-only | Keep delete cleanup for owners. |
| Route generation | `services/orsService.js`; `functions/index.js` `getPremiumRoute` | Function checks per-user rate limit, then reads `users/{uid}` entitlement | Premium route request | 1 rate-limit read/write within limit, 1 entitlement read, function/network; over-limit stops before entitlement/ORS | Per generation | Lower after rate limit; App Check still needed | Keep 30/hour default; add App Check before public scale. |
| Global geocode | `searchEngine.fetchGlobalGeocode`; `functions/index.js` `getPremiumGeocode` | Function checks per-user rate limit, then reads `users/{uid}` entitlement | Premium global search | 1 rate-limit read/write within limit, 1 entitlement read, function/network; over-limit stops before entitlement/ORS | Per uncached query | Lower after rate limit; App Check still needed | Keep 120/hour default; keep client cache. |
| Checkout start | `paywallController.startCheckout`; `functions/index.js` `createCheckoutSession` | No Firestore write | User clicks checkout | Function invocation only | Per click | Test-mode blocker | Live/test config and anti-double-click exists client-side. |
| Webhook entitlement | `functions/index.js` `handleLemonSqueezyWebhook` | Transaction reads processed-event receipt and user doc, then writes entitlement plus receipt | Lemon Squeezy webhook | Usually 2 reads + 2 writes; duplicate events read 1 receipt and write nothing | Provider events | Live-mode still locked; chargeback event design pending | Keep test mode until RC; confirm real provider payload timestamps before public paid launch. |
| Subscription display | `services/authAccountUi.js` | Reads local `premiumService` state from listener | Profile render | No extra read | UI refresh | Good | Portal URL should be verified. |
| Feedback | `modules/uiController.js` | `feedback.add()` | Submit feedback | 1 write attempted | User action | Broken by rules | Callable or rules allow with validation/rate-limit. |

Answers to specific Firestore questions:

- Does the app ever read all parks from Firestore? **No.** Public parks are CSV/static fallback.
- Does the app ever read all leaderboard entries? **No evidence found.** Initial and See More are both `limit(5)`.
- Does it use offset pagination? **No offset found.** It uses `startAfter(lastDoc)`.
- Does See More rerun the whole query? **No.** It queries the next 5 after the last doc.
- Does leaderboard auto-refresh every 10 seconds? **No polling/listener found.**
- Are there realtime listeners where one-time gets would be better? **Yes.** Two `users/{uid}` listeners are active for signed-in users.
- Are listeners left active after logout/account switch? **No evidence.** Cleanup functions exist and are called.
- Are writes debounced/batched? Leaderboard score sync is guarded by `_leaderboardSyncInProgress` and `_lastSyncedScore`; achievements use batch writes. Visit writes are per action and not batched across rapid toggles.
- Are public/static datasets stored outside Firestore? **Yes.** This is a major cost win.

## 5. Leaderboard Deep Dive

Confirmed:

- Storage: one document per user at `leaderboard/{uid}`.
- Initial load: `orderBy('totalPoints','desc').limit(5).get()`.
- See More: `orderBy('totalPoints','desc').startAfter(window._lastLeaderboardDoc).limit(5).get()`.
- No offset pagination found.
- No realtime listener or 10-second polling for leaderboard found.
- `See More` does **not** reread all 3,540 leaderboard entries.
- Hidden issue: if the current user is not in the cached page list, each initial load/load-more can call `fetchExactLeaderboardRankForScore()`, a Firestore REST aggregation count of all rows with higher `totalPoints`.

Conclusion: the suspected “reads all 3,540 docs every See More” bug is **not present** in the inspected code. The leaderboard’s main pagination is good. The only recommended change is to avoid repeating the separate exact-rank aggregation unnecessarily.

Optimized design:

- Public signed-out/signed-in initial view reads `system/leaderboardData` top 50/100, generated hourly by `generateHourlyLeaderboard`.
- Manual refresh button can query live `leaderboard.limit(10)` when desired.
- See More should keep the existing cursor pagination and user-visible behavior for beta. Do not cap normal browsing unless monitoring shows abuse; if a cap is ever needed, put it behind a feature flag and keep the user's own rank visible.
- Exact personal rank uses a cached field such as `users/{uid}.leaderboardRankSnapshot` updated hourly/daily or after score changes by a function.
- If exact rank must stay client-triggered, cache `fetchExactLeaderboardRankForScore()` per UID/score/session for 10-30 minutes and never run it on every load-more click.
- Add App Check and rate-limit leaderboard refresh/load-more actions client-side; optionally add a function proxy if abuse appears.
- Make leaderboard writes server-derived from visited/walk data, not client-authored totals.

Before/after cost estimate for 10,000 signed-out/anonymous opens/day:

| Design | Reads/day | Cost/day | Notes |
|---|---:|---:|---|
| Current initial leaderboard `limit(5)` | 50,000 | $0.0150 | Cheap, but scales linearly and is not cached. |
| Cached `system/leaderboardData` one-doc top list | 10,000 | $0.0030 | 80% fewer reads for initial leaderboard. |

Before/after for one signed-in user near bottom clicking See More 100 times:

| Design | Direct page reads | Rank aggregation calls | Main risk |
|---|---:|---:|---|
| Current | 500 docs | Up to 100 repeated count aggregations | Latency and index-entry billing. |
| Cached-rank design | 500 docs or capped lower | 0-1 rank lookup | Predictable cost; better UX. |
| Optional flagged depth cap | 50 docs | 0-1 rank lookup | Only use if monitoring shows abuse; not needed for the first beta by default. |

## 6. Free vs Premium Tier Design

Confirmed free/premium behavior:

- Free limit of 5 visited places exists in `services/checkinService.js` and is enforced by `firestore.rules`.
- Premium unlock is read from `services/premiumService.js`.
- Premium map filters/styles/trail controls are gated in `services/authPremiumUi.js`, `modules/paywallController.js`, and settings/search modules.
- Premium route/geocode is server-enforced by `requirePremiumCallable()` in `functions/index.js`.

Resolved gap: the free tracked-visit limit is now 5 and Firestore rules deny non-premium direct `users/{uid}.visitedPlaces` writes above 5. Premium users with active, manual-active, past-due, or cancelled-active entitlement on the same user document can exceed 5. Legacy/expired over-limit users are locked from adding or swapping over-limit visits, but can remove visits one at a time.

Recommended tier design:

| Feature | Signed out | Free signed-in | Premium | Current implementation | Recommended implementation | Risk |
|---|---|---|---|---|---|---|
| Browse map/view pins | Yes | Yes | Yes | CSV/local | Keep free | Low |
| Local search | Yes | Yes | Yes | Local over `ParkRepo` | Keep free | Low |
| Visited-aware filters | No | No/locked | Yes | UI-gated | Keep premium, sanitize state | Medium |
| Save visited places | No or prompt | 5 max | Unlimited or high cap | Client + rules-enforced free cap | Keep 5 free cap; premium cap by doc-size or subcollection later | Medium |
| Passport/stats | Limited/local | Yes | Enhanced | Local from visits | Keep mostly free for engagement | Low |
| Achievements | View local | Yes | Yes/enhanced | Client writes achievements | Treat as cosmetic or server derive | Medium |
| Leaderboard | Top 10/50 | Existing cursor browsing + own rank | Deep browse | Public cursor pages | Keep current cursor UX; only add a flagged depth cap if monitoring shows abuse | Medium |
| Route generation | No | No | Yes | Server premium callable with per-user rate limit | Keep; App Check still recommended | Medium if abused |
| Trip planner manual stops | Limited | Yes | Yes | Mostly client/local | Keep free manual planning; saved route persistence and route generation are premium | Medium |
| Saved routes | No | No | Yes | Premium-gated saved routes owner subcollection | Keep save/load premium-only; owner delete allowed for cleanup | Low/Medium |
| Global town search | No | No | Yes | Server premium geocode with per-user rate limit | Keep; client cache and App Check still recommended | Medium |
| Account/profile | Prompt | Yes | Yes | Auth UI/user doc | Keep | Low |
| Manage subscription | No | If inactive history | Yes | Static Lemon portal URL | Verify portal URL/user flow | Medium |
| Checkout | Sign in first | Yes | Already premium hides checkout | Server callable | Live/test config required | P0 |
| Premium verification | No | Checkout return verify | Active | Reads entitlement listener | Keep; add webhook monitoring | Medium |
| Refund handling | N/A | N/A | Lose access | Refund maps to non-premium canceled | Store `refunded` status and support reason | Medium |
| Account switching | Runtime reset | Runtime reset | Runtime reset | Mostly covered | Keep E2E required | Medium |

Pricing/business notes:

- At 500 normal free DAU, Firestore cost is roughly $0.83/month by this model. At 1,000 normal free DAU, roughly $1.67/month. Firebase cost alone does not require aggressive monetization.
- $1/year can cover normal Firestore but leaves little room for payment fees, support, ORS usage, chargebacks, and admin time.
- $5/year is viable for a community tool if route usage is capped and support is light.
- $9.99/year gives room for payment processing, refunds, occasional abuse, and support, but increases expectations that premium billing is polished.
- Too-generous free tier risk: route/geocode abuse and no reason to upgrade.
- Too-restrictive free tier risk: the Facebook group bounces before seeing value. Current launch default: free browsing/search + 5 tracked places + limited leaderboard, premium for route generation/global search/deep tools.

## 7. Payments, Lemon Squeezy, and Entitlement Audit

Confirmed strengths:

- Checkout is server-created.
- Client cannot choose arbitrary UID or entitlement.
- Webhook signature verification uses raw body, `X-Signature`, HMAC SHA256, and timing-safe compare.
- Webhook idempotency now stores provider event receipts in `_lemonSqueezyWebhookEvents/{sha256(providerEventId)}`.
- Out-of-order protection compares provider event timestamps plus status ranks before changing entitlement.
- Cancelled subscriptions keep access until a future `ends_at`.
- Cancelled-but-active subscriptions are stored as `status:'cancelled_active'`.
- Past-due/unpaid subscriptions keep Premium active during billing retry/grace.
- Refund events immediately remove Premium by setting `premium:false,status:'refunded'`.
- Manual admin overrides are not downgraded by Lemon Squeezy webhook events.

Confirmed paid-launch gates:

- Test-mode-only checkout and webhook mapping. This is known and should stay test-only until the final release-candidate switch.
- No chargeback/dispute-specific webhook handling was found; Lemon Squeezy docs describe chargebacks/refunds but event support needs a provider-confirmed design.
- Live-mode readiness still needs one real low-risk/refunded transaction after Carter approves the final RC switch.

Subscription state machine:

| State | Show Premium? | Manage subscription? | Firestore fields | Webhook/event | Bugs possible |
|---|---|---|---|---|---|
| `no_subscription` | No | No | `premium:false,status:'free',source:'none'` or no entitlement | None | User sees stale local premium if reset fails; current UID guard helps. |
| `checkout_started` | No until webhook | Maybe show verifying | Optional pending checkout metadata | Checkout callable return only | Checkout success redirect before webhook can show delayed verification. |
| `active` | Yes | Yes | `premium:true,status:'active',source:'lemon_squeezy',providerSubscriptionId,currentPeriodEnd` | `subscription_created`, `subscription_updated`, payment success/recovered | Live-mode currently ignored. |
| `on_trial` | Yes if trial is product policy | Yes | `premium:true,status:'active'` plus `trialEndsAt` or `providerStatus:'on_trial'` | Provider status/trial fields | Current code collapses trial into active if status active; no explicit trial UI. |
| `past_due` | Yes during dunning/grace unless provider expired | Yes, show payment attention | `premium:true,status:'past_due'` | `subscription_payment_failed`, `subscription_updated` past_due/unpaid | Fixed in Stage 2 hardening. |
| `cancelled_but_access_until_period_end` | Yes until `ends_at` | Yes/history | `premium:true,status:'cancelled_active'`, `currentPeriodEnd:ends_at` | `subscription_cancelled` with future `ends_at` | Fixed in Stage 2 hardening. |
| `expired` | No | Yes/history/support | `premium:false,status:'expired'` | `subscription_expired` or cancelled with past `ends_at` | Correct enough. |
| `refunded` | No immediately | Support/history | `premium:false,status:'refunded'`, provider invoice/order id | `subscription_payment_refunded`, `order_refunded` | Fixed in Stage 2 hardening. |
| `chargeback/disputed` | Usually no or manual review | Support only | `premium:false,status:'disputed'` | Provider-supported dispute/chargeback event, if available | No specific handling found. |
| `paused` | Product decision; usually no if service paused | Yes | `premium:false,status:'paused'` | Subscription paused/resumed events if configured | No paused handling found. |

Payment readiness score: **58/100** for public paid launch, **78/100** for internal test-mode beta. Score is still not public-launch green because live mode is intentionally locked, chargeback/dispute handling is not provider-confirmed, and the final low-risk live transaction has not been approved or run.

## 8. Security Rules and Data Integrity Audit

Rules file: `firestore.rules`.

Strengths:

- Users can read/write only their own `users/{uid}` document.
- Client create/update is blocked from entitlement, premium, subscription, provider, role/admin, and custom-claims fields.
- Saved routes are scoped to owner and save/load/read/update are premium-gated through the parent user entitlement.
- Public `system` docs are read-only.
- Rules now use `exists()`/`get()` only on the premium-only `savedRoutes` subcollection to check the parent user entitlement. Hot visited-place and leaderboard rules still do not use `get()`/`exists()`.

Risks:

- Direct client writes to `leaderboard/{uid}` are now denied. Remaining leaderboard integrity risk is source data that is still partly client-authored, especially walk/expedition points.
- Owner can write achievement documents with any valid-looking id/tier/timestamp.
- Owner can no longer update `visitedPlaces` above 5 unless the existing user doc has active, manual-active, past-due, or cancelled-active entitlement. Rules now also require `visitedPlaces` to be a list when that field changes and allow legacy/expired over-limit users to shrink, not grow or swap, their visit list.
- `feedback` writes appear denied by default rules.

| Rule area | Current protection | Missing tests | Exploit risk | Cost risk | Fix |
|---|---|---|---|---|---|
| User doc ownership | Owner-only read/create/update; delete denied | Large/invalid field constraints | Medium | Medium | Add field allowlist or callable for sensitive mutations. |
| Entitlement | Protected keys blocked on create/update | Live webhook state tests in rules not relevant; function tests needed | Low client spoof risk | Low | Keep protected list; server-only entitlement writes. |
| Free visit limit | Rules-enforced 5 max for non-premium users; premium can exceed | Keep rules tests and runtime smoke current | Low/Medium | Low/Medium | Done for free cap; consider callable/subcollection if premium storage grows. |
| Achievements | Owner-only, shape validation | Criteria validation, malicious unlock | Medium | Low | Server-derived or cosmetic-only. |
| Leaderboard | Public read; direct client create/update/delete denied; server callable writes rows | Keep callable/rules tests current | Low/Medium | Low/Medium | Done for direct leaderboard writes; consider server-derived walk/achievement inputs later. |
| Saved routes | Premium owner-only for read/create/update; owner delete allowed for cleanup | Size/shape/count limits | Medium | Medium | Add max fields/size if needed. |
| Feedback | Denied by default | Desired success + spam/malicious fields | Low functional bug | Low | Callable with rate limit or validated rules. |
| Admin-only paths | `_adminRateLimits` not matched, default denied to clients | Admin path tests | Low | Low | Keep server-only. |
| Rules read cost | `get/exists` only on saved-route premium checks | Saved-route entitlement rules coverage | Low | Low | Keep `get/exists` out of hot rules; acceptable for premium saved-route reads/writes. |

## 9. QA, Bugs, and Release Blockers

Test results:

| Command | Result | Notes |
|---|---|---|
| `npm --prefix functions test` with Node 20 PATH | Pass: 75/75 | Checkout, webhook, entitlement, ORS handler, kill-switch, and route/geocode rate-limit unit tests passed. |
| `npm run test:rules` with Node 20 PATH | Pass: 21/21 | Firestore rules entitlement/admin/ownership/free-visit-limit tests passed. Java 18 warning: firebase-tools v15 will require Java 21+. |
| `npm run test:functions:emulator` with Node 20 PATH | Pass: 9/9 | Auth/Firestore/Functions emulator ORS callable entitlement tests passed. |
| `bug015-free-visited-limit-smoke` with local static server | Pass: 5/5 | Free cap is now 5: fifth add succeeds, sixth add/GPS are blocked, unmark works, and premium can exceed 5. |
| `npm run test:e2e:smoke` without local server | Fail due environment | `npm` not on default PATH initially; after PATH fix, Playwright failed with `ERR_CONNECTION_REFUSED` because `localhost:4173` server was not running. |
| `BARK_E2E_BASE_URL=http://localhost:4173/index.html npm run test:e2e:smoke` with static server and full storage-state env | Pass: 40/40 | Free, premium/test entitlement, and second-account storage states were available under ignored `playwright/.auth/` files. A first run found one route test timeout caused by the long-route warning; the test harness now chooses continue, and the full rerun passed. |
| `bark-app-identity-smoke` rerun alone with server | Pass: 1/1 | Confirms prior identity failure was server/start timing, not app identity. |

E2E failure to fix or triage:

- `tests/playwright/bug017-product-rules-audit-smoke.spec.js`: fixed. The failure was test expectation drift; the test clicked trail controls last and the app correctly showed the `Virtual trail tracking` premium paywall.

Skipped E2E coverage:

- Previously skipped signed-in coverage is now running locally with `BARK_E2E_STORAGE_STATE`, `BARK_E2E_PREMIUM_STORAGE_STATE`, and `BARK_E2E_STORAGE_STATE_B`. The full smoke passed 40/40. Remaining caveat: trip planner stop persistence after reload is not supported by current runtime state; the existing test covers dynamic styling and visit persistence.

Release blockers:

| Priority | Title | Evidence/file | Impact | Suggested fix | Test to prove fixed |
|---|---|---|---|---|---|
| Done | Emergency kill switches missing | App config/UI feature paths | Risky beta features could not be disabled quickly | Added feature flags for route/geocode, checkout, leaderboard load-more, feedback, and risky premium tools | Stage 0 branch merged; function tests and browser flag smoke passed |
| Done | Free visited limit bypassable | `services/checkinService.js`, `firestore.rules` | Product tier bypass; possible write growth | Lowered free cap to 5 and added rules enforcement | Rules tests passed 21/21 for 5/6 visits and premium bypass |
| Done | Leaderboard score spoofing | `firestore.rules`, `modules/profileEngine.js`, `functions/index.js` | Direct fake totals blocked | Added `syncLeaderboardScore` callable and denied direct client leaderboard writes | Function tests passed 86/86; rules tests passed 24/24; leaderboard browser smoke passed 3/3 |
| Done | Webhook event ordering/idempotency weak | `functions/index.js` | Wrong access after delayed/replayed events | Added processed-event transaction + provider timestamp/rank ordering | Webhook tests passed 47/47; functions tests passed 81/81 |
| Done | Past-due removes access immediately | `functions/index.js`, `premiumService`, account/paywall UI | Angry users during billing retry | Added `past_due` grace, `cancelled_active`, and `refunded` states | Webhook tests passed 47/47; auth-account UI tests passed 4/4 |
| Done | Product-rules E2E failure | `tests/playwright/bug017...` | Premium gating/copy drift | Fixed test expectation for valid trail-specific paywall | Targeted smoke passed 2/2 |
| Done | Signed-in E2E not run | Playwright env | Account switch/mobile/checkout not proved | Created/validated storage states and ran full suite | Full signed-in smoke passed 40/40 |
| P2 | Feedback likely denied | `modules/uiController.js`, `firestore.rules` | Support channel broken | Add safe write path | Rules/function test |
| P2 | Duplicate user-doc listeners | `authService`, `VaultRepo` | Extra reads | Consolidate or split model | Instrument one listener path |
| P0 final RC | No final budget/rollback confirmation | Cloud console/config | Cost incident risk | Kill switches first; budget alerts in final pre-RC checklist | Fire drill |
| P0 absolute final RC | Lemon Squeezy final live-mode switch | `functions/index.js` | Users may pay without live entitlement if switched too early or too late | Keep test mode during fixes; make final controlled live/test switch only after Carter approves | Live/test unit fixtures + real live low-price/refunded smoke |

## 10. Scalability and Abuse Analysis

Confirmed stress-test profile of 9,000 reads and 3,000 writes/user/day is pathological, not representative of normal browsing. Likely generators:

- repeated login/logout causing user-doc listeners and leaderboard reloads,
- repeated visited-place writes to `users/{uid}`,
- daily streak reads/writes,
- achievement reads/writes,
- leaderboard load-more pages plus exact rank aggregation,
- route/geocode callables, each adding a server entitlement read,
- saved route operations.

Normal map browsing is cheap because search/filter/pins use local CSV data, not Firestore.

Scenario notes:

- 100 join in one day: likely fine if most are light/normal; watch auth and leaderboard loads.
- 500 join in one day: Firestore remains cheap; support and checkout confusion become bigger risk.
- 1,000 join in one day: still affordable under normal behavior; route throttles and kill switches should be live.
- 5,000 from a Facebook post: normal Firestore cost is still low, but any confusing UI loop or route/leaderboard spam can amplify quickly.
- A user scripts the app: current client request counter is not security. App Check, rules/callables, and function rate limits are needed.
- User saves every pin: free UI stops at 20, but direct Firestore write can bypass. Premium whole-array storage may hit Firestore document size eventually.
- User repeatedly logs in/out: causes listener setup, leaderboard loads, and account reset work. Not catastrophic but noisy.
- Webhook replay: exact duplicate event receipts are now durably ignored, and older provider-timestamp events cannot regress entitlement.
- Quota/budget exceeded: no confirmed kill switch exists for leaderboard/route/checkout. Add flags before public launch.

Recommended abuse controls:

- Enable Firebase App Check enforcement for Firestore and Functions after verifying hosting/app clients.
- Add per-user per-window counters for ORS callables.
- Keep the current leaderboard See More UX; add debounce/feature-flag controls only if monitoring shows abuse.
- Move premium-sensitive writes behind callables or server-derived jobs.
- Add app-side kill switches before beta.
- Add budget alerts and log-based alerts before the broader paid/public release candidate.
- Add emergency static config such as `window.BARK_LAUNCH_FLAGS` or `system/appConfig` with cached reads to disable route planner, checkout, leaderboard deep browse, and Sheet polling.

## 11. Monitoring, Analytics, and Budget Guardrails

Before any broader launch, set:

- Google Cloud budget alerts at $1, $5, $10, $25, $50/day projected burn and $50/$100 monthly actual.
- Firestore read/write/delete dashboard by hour.
- Function invocation/error alerts for `createCheckoutSession`, `lemonSqueezyWebhook`, `getPremiumRoute`, `getPremiumGeocode`.
- Log-based alert on webhook 4xx/5xx, ignored live-mode events, missing UID, store mismatch, and entitlement downgrades.
- App analytics for checkout starts/completes/abandoned, premium state, route generations, leaderboard loads, See More clicks, visited writes/user/day.
- Emergency feature flags or kill switches for route planner, leaderboard, checkout, premium-only callables, and Google Sheet polling.

Sequencing note: kill switches are the next app task. Budget alerts are still required before paid/public launch, but they belong in the final pre-RC operational checklist after the app-side controls exist.

## 12. Refactor Plan for Efficiency and Stability

Stage 0 must focus on:

- adding emergency kill switches/feature flags first,
- keeping Lemon Squeezy test mode until the final owner-approved RC switch,
- disabling or capping risky features only through flags if needed,
- support/refund policy,
- maintaining the rules-enforced 5 free visit limit and watching whether premium storage needs a later subcollection.

Leaderboard note: the main leaderboard pagination is already good. Exact-rank caching is a watchlist/polish item unless monitoring shows repeated rank lookup cost or latency.

| Stage | Files likely touched | Risk | Expected impact | Test plan | Done criteria |
|---|---|---|---|---|---|
| Stage 0: emergency launch safety | `modules/barkState.js`, `modules/profileEngine.js`, `services/orsService.js`, `modules/paywallController.js` | Low/Medium | Keep beta controllable while Lemon Squeezy remains test-only | Unit tests and manual flag tests | Risky features can be stopped without code surgery; live/test mode switch remains locked until Carter approves. |
| Stage 1: cost fixes | `modules/profileEngine.js`, `functions/index.js`, `repos/VaultRepo.js`, `services/authService.js` | Medium | Reduce user-doc read amplification and watch leaderboard metrics | Instrument read paths; E2E leaderboard tests | One clear user-doc ownership plan; exact-rank caching only if monitoring shows repeated rank lookup cost or latency. |
| Stage 2: payment correctness | `functions/index.js`, `premiumService.js`, `authAccountUi.js`, webhook tests | Medium | Correct entitlements after cancel/refund/retry while still in test mode | Webhook state machine tests | Done for test-mode hardening; final live webhook verification remains an RC-only task after Carter approval. |
| Stage 3: free/premium enforcement | `checkinService.js`, `firebaseService.js`, `functions/index.js`, `firestore.rules` | Medium/High | Enforce remaining product tiers | Rules/callable tests + E2E free/premium storage states | Free direct writes cannot bypass 5 visits; remaining work focuses on leaderboard/achievements. |
| Stage 4: QA hardening | Playwright tests, test fixtures, docs | Low | Prove mobile/account/checkout flows | Full smoke suite with free/premium users | No skipped launch-critical tests. |
| Stage 5: scale polish | App Check, analytics, dashboards, admin tools | Medium | Operational maturity | Dashboard/fire-drill | Admin can diagnose entitlement, cost, webhook, and abuse issues quickly. |

## 13. Release Plan

Safest option: **A. Private beta with 5-10 testers.**

Not recommended tomorrow:

- Facebook soft launch.
- Full group launch.
- Any paid live launch.

Pre-launch checklist:

- Confirm Firestore region/pricing; enable budget alerts during the final pre-RC operational checklist.
- Keep Lemon Squeezy in test mode unless Carter has explicitly approved the final live-mode RC switch; verify webhook endpoint/secrets while still in test mode.
- Add/verify support email, refund policy, and customer portal flow.
- Run functions, rules, functions emulator, and full E2E with free/premium storage states.
- Add emergency feature flags for route planner, checkout, leaderboard, and premium gating.

Launch-day checklist:

- Start with 5-10 named testers.
- Watch Firestore reads/writes, function errors, webhook logs, checkout starts/completes, and support messages hourly.
- Keep route generation and deep leaderboard behind premium/flags.
- Record known issues publicly enough that testers do not churn on surprises.

First 24 hours:

- Check Firestore reads/user and writes/user against the normal model.
- Check webhook success rate and entitlement update latency.
- Review every refund/cancel/support request manually.
- If reads spike, disable leaderboard deep browse and route generation first.

Rollback plan:

- Disable checkout link/paywall action.
- Disable route/geocode callables at UI flag level.
- Hide leaderboard See More or switch to cached `system/leaderboardData`.
- Freeze new premium promotion posts until webhook/entitlement logs are clean.

Support/refund policy draft:

> Premium is billed through Lemon Squeezy. You can manage or cancel your subscription from the billing link in your account. Cancelled subscriptions keep Premium access through the paid period. Full refunds remove Premium access when the refund is processed. If Premium does not appear after checkout, contact support with the email used at checkout.

Admin announcement guidance:

- Do not pitch Premium until live/test payment mode is resolved.
- Ask beta users to report device/browser, signed-in account email, and exact action.
- Avoid “unlimited” claims until server-side limits are enforced.

Emergency cost playbook:

1. Check Firestore usage by collection/query and Functions invocation logs.
2. Disable route planner and leaderboard load-more flags.
3. Disable checkout if entitlement/webhooks are failing.
4. Raise issue in admin channel with current spend projection.
5. Patch and deploy the smallest limiting fix, then reopen features gradually.

## 14. Final Ranked Risk Register

| Rank | Risk | Severity | Likelihood | Evidence | Cost impact | User impact | Fix | Owner | Launch blocker? |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Leaderboard source-data spoofing | P1/P2 | Medium | Direct leaderboard writes are blocked, but some source fields like walk points are still client-authored | Low/Medium | Leaderboard trust can still be gamed indirectly | Harden source inputs/server-derived scores further if leaderboard becomes high-stakes | Firebase | No for private beta; yes before broad public competition |
| 2 | Lemon Squeezy final RC live-mode switch | P0 | Certain before launch | `functions/index.js` still intentionally test-mode-only | Low direct, high revenue/support | Users pay or cannot pay correctly if switched casually | Keep test mode until Carter approves RC, then configurable mode + live webhook test | Payments | Yes public |
| 3 | Chargeback/dispute state handling unconfirmed | P1 | Medium | No provider-confirmed chargeback/dispute event mapping yet | Low | Disputed/refunded edge cases may need manual support | Confirm Lemon event support and add fixtures | Payments/Product | Yes paid |
| 4 | Route/geocode spam beyond server limits | P2 | Low/Medium | Premium callables now have per-user hourly limits; App Check not yet enforced | Medium | Slow/expensive external calls are capped per user but scripted account creation remains possible | Add App Check and monitoring | Functions/Ops | No for private beta |
| 5 | Free visit limit regression | P2 | Low | Rules now enforce 5 free visits; runtime smoke must stay current | Low/Medium | Free users could regain premium value if rules regress | Keep rules + BUG-015 smoke in release suite | Firebase/QA | No if tests run |
| 6 | Exact rank aggregation repeated | P2 | Medium | `fetchExactLeaderboardRankForScore` on load-more | Low/Medium | Slow leaderboard | TTL/cache only if monitoring shows a problem | Frontend | No |
| 7 | Duplicate user-doc listeners | P2 | High | `authService` + `VaultRepo` | Low/Medium | More reads; state complexity | Consolidate/split | Frontend | No |
| 8 | Feedback denied | P2 | High | `feedback.add`, default deny rules | Low | Users cannot contact support in app | Safe feedback path | Full-stack | No |
| 9 | Signed-in E2E can go stale | P2 | Medium | Storage states are local ignored files; full smoke passed 40/40 on 2026-05-09 | Unknown when stale | Account/checkout regressions could slip if not rerun before RC | Refresh storage states and rerun full smoke before each paid beta/RC | QA | No, if rerun before launch |
| 10 | No final budget alerts | P1 | High | Cloud console/config not confirmed | High during incident | Cost anxiety during promotion | Budget alerts in final pre-RC checklist | Ops | Yes public |
| 11 | Achievement spoofing | P2 | Medium | Client achievement writes | Low | Badge trust issue | Server derive/cosmetic | Firebase | No |

## 15. Final Recommendation

Current recommendation: **do not launch paid/public tomorrow. Launch only a constrained private beta after Stage 0 safety work.**

Top fixes before asking Facebook admins to promote:

1. Confirm chargeback/dispute handling and support policy before live payment.
2. Add App Check/monitoring around function abuse before broader launch.
3. Keep the free 5-visit rules tests and signed-in E2E in the release suite.
4. Decide whether leaderboard walk/expedition source data needs server hardening before a public competition.
5. Run one final Lemon Squeezy test-mode delivery re-skim before Carter approves the live-mode RC switch.

Final RC steps after those fixes: add budget alerts/monitoring, then make the Lemon Squeezy live/test switch only after Carter explicitly approves and test one real low-risk transaction.

Top 5 things not worth worrying about yet:

1. Raw Firestore cost under normal browsing; it is tiny compared with support/payment correctness.
2. Moving public park data into Firestore; the CSV/static approach is currently a cost advantage.
3. Rewriting the whole frontend state model; targeted listener/write fixes are enough for beta.
4. Deep premium analytics perfection before the first 5-10 testers.
5. Firestore storage cost for normal users; document-size/design matters more than dollars.

Realistic Firebase cost:

- 500 users/day normal free: about **$0.83/month Firestore**.
- 1,000 users/day normal free: about **$1.67/month Firestore**.
- 1,000 heavy premium users/day: about **$16/month Firestore**, plus Functions/ORS costs.
- Catastrophic modeled case, 10,000 stress/abuse users/day: about **$1,622/month Firestore** before Functions/network and before kill switches.

Single code issue most likely to make costs explode: any remaining unbounded action that bypasses server controls, especially leaderboard/client-authored writes or scripted account creation without App Check. Route/geocode now have kill switches and per-user server limits.

Single payment issue most likely to cause user anger: a user pays in live mode but the final test-to-live switch or real provider delivery is not verified. Test-mode webhook ordering/idempotency is now hardened, and the test-mode-only state itself is known and should be changed last.
