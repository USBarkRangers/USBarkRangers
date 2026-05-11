# Phase 4C.4 Backend / Rules Premium Enforcement Plan

Date: 2026-05-01

Status: planning only. Do not implement runtime code, tests, Firebase rules, payment provider work, payment buttons, checkout, webhooks, or deployment in Phase 4C.4.

## Evidence

Inventory command run:

```sh
rg -n "getPremiumRoute|getPremiumGeocode|httpsCallable|functions\\.httpsCallable|isPremiumGlobalSearchUnlocked|premiumLoggedIn|premiumClustering|toggle-virtual-trail|toggle-completed-trails|entitlement|premiumService|isPremium\\(" services modules renderers repos state engines core functions firebase.json firestore.rules index.html -g '*.js' -g '*.html' -g '*.rules' -g '*.json'
```

Notes:

- `functions/index.js` exists and exports `getPremiumRoute` and `getPremiumGeocode`.
- `firebase.json` configures Functions and Hosting only.
- No root `firestore.rules` file exists in this repo at this time; the inventory command reported `rg: firestore.rules: No such file or directory`.
- `services/orsService.js` calls Firebase Functions through `firebase.functions().httpsCallable(...)`.
- `services/premiumService.js` is a read-only client entitlement normalizer. It is useful for UI state, but it is not a security boundary.
- Phase 4C.3 already switched only `#premium-filters-wrap`, `#visited-filter`, and `#map-style-select` to entitlement gating.

## 1. Current Surface Inventory

| Surface | Current classification | Current behavior | Risk | Recommended enforcement path |
|---|---|---|---|---|
| `#premium-filters-wrap` | UI-only and already entitlement-gated | `authPremiumUi.applyPremiumGating(isPremium)` applies `premium-locked` / `premium-unlocked`. | Low | Keep as client UX only. No backend enforcement needed for wrapper class. |
| `#visited-filter` | UI-only and already entitlement-gated | Disabled and reset to `all` when non-premium; enabled for premium/manual override. | Low | Keep in `authPremiumUi` and Playwright coverage. |
| `#map-style-select` | UI-only and already entitlement-gated | Disabled and reset to `default` when non-premium; enabled for premium/manual override. | Low | Keep in `authPremiumUi` and Playwright coverage. |
| Trail buttons | UI-only but still auth-gated | `#toggle-virtual-trail` and `#toggle-completed-trails` are still unlocked by signed-in auth state. | Medium | Switch DOM gating and `expeditionEngine` click guards together in a later PR. |
| Expedition click guards | UI/client guard, still auth-gated | `expeditionEngine` checks Firebase current user, then allows trail overlay toggles. | Medium | Use entitlement state and paywall copy in the same PR as trail button DOM changes. |
| Global town/city search | Client-only gate plus backend quota path | `searchEngine.isPremiumGlobalSearchUnlocked()` checks Firebase current user, then calls ORS geocode through a callable. | High | Gate UX with `premiumService.isPremium()`, but require server-side callable enforcement before treating this as protected. |
| Offline mode / `localStorage.premiumLoggedIn` | Client-only and unsafe | `dataService.loadData()` checks `localStorage.getItem('premiumLoggedIn') === 'true'` while offline. | High | Remove localStorage as a grant path. Use server-confirmed entitlement cache policy only if offline paid access is intentionally supported. |
| Premium clustering / bubble mode | Unclear product decision | `settings.premiumClustering`, `barkPremiumClustering`, and `window.premiumClusteringEnabled` drive marker-layer behavior. | Medium | Decide if paid. If paid, gate settings and cleanup invalid free-state values. If not paid, rename away from premium. |
| `settings.premiumClustering` | Firestore/settings-sensitive | Cloud settings hydration/writes include `premiumClustering`. | Medium | Do not confuse with entitlement. If paid, rules or backend cleanup may need to prevent free users from saving enabled premium clustering. |
| ORS `getPremiumRoute` callable | Backend callable / quota protected | `functions/index.js` currently calls `requireAuthCallable(context)`, then spends ORS route quota. | Critical | Enforce entitlement server-side before calling ORS. |
| ORS `getPremiumGeocode` callable | Backend callable / quota protected | `functions/index.js` currently calls `requireAuthCallable(context)`, then spends ORS geocode quota. | Critical | Enforce entitlement server-side before calling ORS. |
| Entitlement field writes | Firestore rule sensitive | Client reads `users/{uid}.entitlement` through auth snapshot; no rules file is present in repo. | Critical | Rules must prevent client writes to entitlement fields. Admin SDK/webhooks may write. |
| Payment provider / checkout / webhooks | Deferred | No provider, payment buttons, checkout, or webhooks exist in this phase. | High when added | Keep separate until entitlement and backend enforcement are tested. |

## 2. Threat Model

The premium system must not allow:

- A client setting localStorage/sessionStorage to unlock premium features.
- A client writing `users/{uid}.entitlement`, `premium`, `status`, `manualOverride`, provider IDs, or equivalent fields.
- A signed-in free user calling `getPremiumRoute` or `getPremiumGeocode` and consuming paid ORS quota.
- A signed-out user calling premium callables.
- A checkout success redirect, URL param, or client-side success flag unlocking premium without backend verification.
- A signed-in free user getting paid quota through direct JavaScript calls, skipped DOM gates, or stale UI.
- Account switching leaking premium state from one user to another.
- A revoked, canceled, expired, or malformed entitlement remaining premium because the browser cached older state.
- Test helpers or smoke tests training the app to rely on client-side entitlement mutation.

## 3. Firestore Rules Plan

Conceptual rules:

- Users may read their own `users/{uid}` document, including the `entitlement` cache needed by the client UI.
- Users may write allowed user-owned fields such as settings, visits/progress fields, and other existing app data only according to the current app's data model.
- Users must not write `entitlement`.
- Users must not write top-level premium/provider/admin fields such as `premium`, `premiumStatus`, `subscription`, `plan`, `manualOverride`, `providerCustomerId`, `providerSubscriptionId`, `currentPeriodEnd`, `status`, or any future entitlement-granting alias.
- Users must not write provider webhook records, checkout session records, or admin override records.
- Admin/backend code may write entitlement through Admin SDK or trusted server credentials. Firestore security rules do not restrict Admin SDK writes.
- Settings writes should remain possible for normal settings, but settings must not become an entitlement-grant path.
- If `settings.premiumClustering` becomes paid, either reject free-user writes to that setting in rules/backend code or allow the setting to persist harmlessly while runtime entitlement gates it.

Rules test cases to add when a rules file exists:

- Authenticated user can read own entitlement.
- Authenticated user cannot write `users/{uid}.entitlement`.
- Authenticated user cannot write nested entitlement fields through merge/update.
- Authenticated user cannot write top-level `premium`, `premiumStatus`, `manualOverride`, `providerCustomerId`, or `providerSubscriptionId`.
- Authenticated user can still write allowed non-premium settings.
- User A cannot read or write User B entitlement.
- Admin SDK/server path can seed entitlement outside client rules tests.

Current repo gap:

- No `firestore.rules` file is present in this repo, and `firebase.json` does not reference one. Rules must be created, imported, or reviewed before paid launch.
- Do not change Firebase rules in Phase 4C.4. The next rules PR should include emulator/rules tests before any deploy.

## 4. Backend Callable Enforcement Plan

Callables to enforce:

- `getPremiumRoute`
- `getPremiumGeocode`

Current state:

- Both call `requireAuthCallable(context)`.
- Both hold the ORS key server-side.
- Both still allow any signed-in user to consume ORS quota.

Future server-side shape:

1. Get `uid` from `context.auth.uid`; reject unauthenticated requests.
2. Fetch `users/{uid}` with Admin SDK.
3. Read `data.entitlement`.
4. Normalize entitlement server-side using the same semantics as the client:
   - `premium === true`
   - status is `active` or `manual_active`
   - missing/null/malformed/canceled/expired/past_due/free = not premium unless a deliberate server grace status is added.
5. Reject non-premium users with `permission-denied` before calling ORS.
6. Never trust client-provided `isPremium`, `entitlement`, `status`, `plan`, or `source`.
7. Add quota/rate-limit logging for rejected and accepted premium calls.
8. Preserve existing payload validation and ORS error handling.
9. Keep provider secrets server-side only.

Recommended helper inside `functions/index.js` later:

- `normalizeEntitlement(raw)`
- `isEffectivePremium(raw)`
- `requirePremiumCallable(context, action)`

Expected callable tests later:

- Unauthenticated route/geocode request is rejected.
- Signed-in free route/geocode request is rejected before ORS call.
- Signed-in premium/manual override route/geocode request reaches the ORS transport path.
- Malformed entitlement is rejected.
- Expired/canceled/past_due entitlement is rejected.
- Client-supplied `isPremium: true` is ignored.

## 5. Offline Mode Plan

Current risk:

- `modules/dataService.js` uses `localStorage.getItem('premiumLoggedIn') === 'true'` to decide whether a user has Premium Offline Mode.
- localStorage is user-controlled and cannot protect paid access.

Plan options:

| Option | Description | Pros | Cons | Recommendation |
|---|---|---|---|---|
| Remove localStorage premium unlock | Treat offline cached data as available only when already cached, without using `premiumLoggedIn` as an entitlement grant. | Removes the unsafe bypass quickly. | Product may need a defined offline premium behavior. | Best first cleanup. |
| Use `premiumService` cache for UI only | If online/auth snapshot confirms premium, UI can describe offline availability, but localStorage never newly grants premium. | Consistent with Phase 4B/4C. | Does not solve true offline paid access by itself. | Good for UI. |
| Require recent server-confirmed entitlement timestamp | Offline paid access works only if the app has a recent signed/server-derived entitlement cache. | Stronger product experience. | Needs careful cache semantics and revocation tradeoffs. | Consider only after paid launch requirements are explicit. |

Policy:

- Never let localStorage newly grant premium.
- Do not store a raw boolean that means "premium forever".
- If offline premium access is valuable, store a server-confirmed entitlement timestamp and define a max age.
- On account switch/sign-out, clear any user-scoped premium offline cache.
- If no reliable entitlement cache exists, fail closed for paid-only offline mode.

## 6. Global Search Plan

Current risk:

- `modules/searchEngine.js` uses `isPremiumGlobalSearchUnlocked()` to check only Firebase current user.
- Global town/city search can call ORS geocode, so UI gating alone cannot protect quota.

Future model:

- UI prompt:
  - Signed out: show sign-in prompt first.
  - Signed-in free: show upgrade/paywall prompt later.
  - Premium/manual override: show global search affordance.
- Client guard:
  - `isPremiumGlobalSearchUnlocked()` should read `premiumService.isPremium()` after backend enforcement is designed.
- Backend guard:
  - `getPremiumGeocode` must enforce entitlement server-side regardless of UI state.
- Error handling:
  - If a free user calls the backend directly, the callable returns `permission-denied`.
  - The UI converts that error into an upgrade prompt or non-destructive message.

Do not switch global search in the same PR as ORS backend enforcement unless tests cover both the UI and callable behavior.

## 7. Trail Button Plan

Current risk:

- `authPremiumUi` and `expeditionEngine` currently keep trail buttons auth-gated.
- A DOM-only switch could disagree with `expeditionEngine` click guards.

Future model:

- Switch trail DOM gating and click guards in the same PR.
- Signed out users get a sign-in prompt.
- Signed-in free users get an upgrade/paywall prompt.
- Premium/manual override users can toggle virtual/completed trail overlays.
- Keep user-owned expedition history visible if product requires it. Do not accidentally hide completed history or profile progress just because trail overlays are paid.
- Ensure `window.flyToActiveTrail()` cannot bypass the same entitlement guard if virtual trail display becomes paid.

Likely files later:

- `services/authPremiumUi.js`
- `modules/expeditionEngine.js`
- `services/authService.js` only if it needs a clearer prompt/state handoff
- Playwright premium/trail smoke coverage

## 8. Premium Clustering / Bubble Mode Plan

Current ambiguity:

- `premiumClusteringEnabled` appears in `state/settingsStore.js`, `modules/settingsRegistry.js`, `modules/settingsController.js`, `modules/mapEngine.js`, `modules/renderEngine.js`, `modules/MarkerLayerManager.js`, and `modules/markerLayerPolicy.js`.
- It may be a performance/visual mode rather than a paid feature.

Decision required before implementation:

- If paid:
  - Gate the settings control by entitlement.
  - Prevent free users from enabling it through settings hydration or localStorage.
  - Decide whether to reset stored free-user `premiumClustering` values to false.
  - Add tests for free vs premium settings behavior.
- If free:
  - Rename UI/code away from `premium` over time to reduce product/security confusion.
  - Keep it out of payment entitlement scope.
- Do not gate accessibility or performance features by accident. If clustering helps low-end devices or accessibility, it should likely stay free or be renamed.

## 9. Test Plan

Future tests before paid launch:

- Firestore rules: client cannot write `users/{uid}.entitlement`.
- Firestore rules: client cannot write top-level premium/provider/manual override fields.
- Firestore rules: client can still write allowed settings.
- ORS callable: unauthenticated user is rejected.
- ORS callable: signed-in free user is rejected.
- ORS callable: premium/manual override user is allowed.
- ORS callable: client-provided `isPremium: true` is ignored.
- Offline: `localStorage.premiumLoggedIn = "true"` does not unlock premium.
- Offline: account switch/sign-out clears or ignores user-scoped entitlement cache.
- Global search: signed-out sees sign-in prompt, signed-in free sees upgrade prompt, premium can search.
- Trail buttons: signed-out locked, signed-in free locked/paywall, premium unlocked.
- Account switch premium isolation: free/premium state does not leak.
- Entitlement revocation locks UI after snapshot refresh.
- Full smoke bundle still passes.

Suggested command families later:

```sh
npm run test:e2e:entitlement
npm run test:e2e:premium
npm run test:e2e:smoke
```

Add rules/function-specific commands only after those harnesses exist.

## 10. PR Breakdown

### 4C.4 - Plan Only

This document. No runtime code, tests, rules, functions, payment provider, payment buttons, or deployment.

### 4C.5 - Remove LocalStorage Premium Unlock

Goal:

- Audit and remove/neutralize `localStorage.premiumLoggedIn` as a premium grant path.
- Decide a minimal offline fallback behavior that does not claim paid access.
- Add a focused test that setting localStorage cannot unlock premium.

Likely files:

- `modules/dataService.js`
- `tests/playwright/phase4c-premium-entitlement-smoke.spec.js` or a new offline-focused smoke
- Phase 4 docs

Implementation status:

- Phase 4C.5 is implemented.
- `modules/dataService.js` no longer reads `localStorage.premiumLoggedIn` as an offline premium grant.
- Offline premium mode now reads the existing read-only `window.BARK.services.premium.isPremium()` state and fails closed if the service is missing or non-premium.
- `tests/playwright/phase4c-premium-entitlement-smoke.spec.js` includes a focused free-user bypass check that sets `localStorage.premiumLoggedIn = "true"`, reloads the app, and verifies `premiumService.isPremium() === false` plus locked `#premium-filters-wrap`, disabled `#visited-filter`, and disabled `#map-style-select`.
- Verification passed: `node --check modules/dataService.js tests/playwright/phase4c-premium-entitlement-smoke.spec.js`.
- Verification passed: `npm run test:e2e:entitlement`, 2 passed.
- Verification passed: `npm run test:e2e:premium`, 2 passed.
- Verification passed: `npm run test:e2e:smoke`, 9 passed.
- No Firestore entitlement writes, payment provider, payment buttons, Firebase rules, ORS callables, global search, trail gating, premium clustering, or deployment changes were made.

### 4C.6 - Global Search And Trail UI Entitlement Gating

Goal:

- Switch global search UI checks to `premiumService.isPremium()`.
- Switch trail button DOM and `expeditionEngine` click guards together.
- Add free vs premium UI smoke coverage.

Likely files:

- `modules/searchEngine.js`
- `modules/expeditionEngine.js`
- `services/authPremiumUi.js`
- Playwright premium/trail/global-search specs

Planning status:

- Phase 4C.6 planning is complete in `plans/PHASE_4C6_TRAILS_GLOBAL_SEARCH_ENTITLEMENT_PLAN.md`.
- Recommended split: 4C.6A trail button DOM/click-guard entitlement gating first; 4C.6B global search UI/check-guard entitlement gating separately.
- Do not combine global search with trail gating unless tests prove free users cannot reach UI geocode paths and the PR still makes no backend security claim.
- ORS backend callable enforcement remains Phase 4C.8, not 4C.6.

Implementation status:

- Phase 4C.6A trail entitlement gating is complete.
- Phase 4C.6B global search UI entitlement gating is complete.
- `modules/searchEngine.js` now gates global search UI/check guards by `premiumService.isPremium()`.
- Signed-in free users are blocked in the UI and focused Playwright coverage confirms they do not call the stubbed ORS geocode path.
- Premium/manual override users can reach the global search UI path with ORS geocode stubbed in Playwright to avoid quota.
- Backend callable enforcement still has not been implemented. `getPremiumRoute` and `getPremiumGeocode` must still be protected server-side in Phase 4C.8 before this is considered secure.

### 4C.7 - Firestore Rules Draft And Rules Tests

Goal:

- Add or import `firestore.rules`.
- Protect entitlement and provider fields from client writes.
- Add rules emulator tests before deploy.

Likely files:

- `firestore.rules`
- `firebase.json`
- `tests/firestore/*` or equivalent rules test harness
- Possibly `package.json` scripts

### 4C.8 - ORS Callable Entitlement Enforcement

Goal:

- Add server-side `requirePremiumCallable(...)`.
- Enforce premium entitlement in `getPremiumRoute` and `getPremiumGeocode`.
- Add function/unit/emulator tests around free vs premium behavior.

Likely files:

- `functions/index.js`
- `functions/package.json` if adding tests/scripts
- Function test harness files
- `services/orsService.js` only if client error mapping needs a small update

### 4D - Payment Provider Design

Goal:

- Compare provider choice in detail.
- Design checkout creation, webhook verification, customer portal, cancel/refund/revocation handling, and provider test mode.

No payment implementation in 4D design.

### 4E - Payment Implementation Later

Goal:

- Add provider integration only after entitlement/rules/callable tests exist.
- Add checkout UI only after backend verification path exists.

## 11. Stop Lines

- Do not add a payment provider.
- Do not add payment buttons.
- Do not collect money.
- Do not change backend callables without tests.
- Do not change Firebase rules without rules tests.
- Do not trust client, URL params, localStorage, or sessionStorage for premium.
- Do not let the client write entitlement.
- Do not deploy paid features until backend/rules tests pass.
- Do not combine premium enforcement with auth refactors, settings hydration refactors, trip planner refactors, leaderboard work, VaultRepo changes, or RefreshCoordinator changes.

## Final Recommendation

Risk ranking:

| Rank | Surface | Why |
|---|---|---|
| Critical | ORS `getPremiumRoute` / `getPremiumGeocode` | Auth-only callable enforcement can spend paid provider quota for signed-in free users. |
| Critical | Entitlement writes / missing rules file | Paid launch needs proof that clients cannot self-grant entitlement. |
| High | `localStorage.premiumLoggedIn` offline mode | User-controlled storage must not unlock paid access. |
| High | Global search | It can reach ORS geocode quota and currently checks auth only. |
| Medium | Trail buttons / expedition guards | Client-only feature access; less provider-cost risk, but product gating is inconsistent. |
| Medium | Premium clustering / bubble mode | Product decision unclear and settings/localStorage/cloud fields already exist. |
| Low | `#visited-filter`, `#map-style-select`, `#premium-filters-wrap` | Already entitlement-gated UI-only controls. |

Recommended next implementation PR:

- **4C.5: remove or neutralize `localStorage.premiumLoggedIn` as a premium grant path**, with a focused test proving localStorage cannot unlock premium.
- Reason: it is a small, client-contained risk reduction that does not require provider choice, rules deployment, or callable emulation. It also prevents the app from carrying an obviously unsafe premium bypass into later payment work.

Next backend-heavy PR after that:

- **4C.7/4C.8 should be planned as a pair:** Firestore rules tests for entitlement writes and server-side ORS callable entitlement enforcement. ORS should not be treated as protected until `functions/index.js` rejects free users before calling ORS.

Ready to implement next premium enforcement slice?

YES, for Phase 4C.5 localStorage premium unlock removal/audit with focused tests. NO for payment provider work, checkout buttons, money collection, rules deployment without tests, or ORS callable changes without a function/rules test plan.

## Phase 4C.7A Planning Update

Phase 4C.7 Firestore rules entitlement protection planning is complete in `plans/PHASE_4C7_FIRESTORE_RULES_ENTITLEMENT_PLAN.md`.

Current confirmed state:

- No root `firestore.rules` file exists in this repo.
- `firebase.json` still configures Functions and Hosting only; it does not reference Firestore rules or emulator config.
- No repo-local rules test harness exists yet.
- Current client write surfaces still require compatibility for `visitedPlaces`, `settings`, streak/progress fields, expedition fields, saved routes, and leaderboard/profile score fields.
- Rules must protect not only premium entitlement/provider fields, but also `isAdmin` and adjacent admin fields because backend admin callables currently trust `users/{uid}.isAdmin`.

Recommended next implementation PR:

- Phase 4C.7B should add a source-controlled `firestore.rules` baseline, emulator config, and rules-test tooling only.
- Use owner-only reads/writes with explicit forbidden-field checks for entitlement/provider/admin fields as the first beta-compatible baseline.
- Do not deploy rules until Phase 4C.7C/4C.7D emulator tests and app smoke tests pass.
- ORS callable entitlement enforcement remains Phase 4C.8.

## Phase 4C.7B Local Rules Baseline Update

Phase 4C.7B is now implemented and verified locally:

- Added `firestore.rules`.
- Added Firestore rules reference and emulator config to `firebase.json`.
- Added `tests/rules/firestore-entitlement.rules.test.js`.
- Added npm script `test:rules` with repo-local rules test tooling.
- Rules block client writes to entitlement, premium/provider/payment, and admin fields.
- Rules preserve required owner writes for current app data including settings, `visitedPlaces`, own saved routes, and owner leaderboard compatibility.
- Rules deny client deletion of `users/{uid}`.
- `npm run test:rules`: PASS, 10 tests passed.
- `npm run test:e2e:smoke`: PASS, 9 tests passed.
- Rules were not deployed.

Remaining backend/security work:

- Mechanical QC for 4C.7B.
- Reviewed rules deployment gate later, after explicit approval.
- Phase 4C.8 ORS callable entitlement enforcement remains separate and not started here.

## Phase 4C.8 ORS Callable Entitlement Enforcement Update

Phase 4C.8 is now implemented locally and not deployed:

- Added server-side entitlement helpers in `functions/index.js`:
  - `normalizeEntitlement(raw)`
  - `isEffectivePremium(raw)`
  - `requirePremiumCallable(context, action, options)`
- `getPremiumRoute` and `getPremiumGeocode` now verify `users/{uid}.entitlement` through Admin SDK before calling ORS.
- Effective premium requires `entitlement.premium === true` and `status` of `active` or `manual_active`.
- Missing, malformed, free, canceled, expired, and past_due entitlements are rejected with `permission-denied`.
- Client-provided premium claims such as `isPremium: true` are ignored.
- Free users are rejected before the ORS transport path is called, so paid ORS quota is not intentionally consumed for free direct callable calls.
- Added function-level Node tests in `functions/tests/ors-entitlement.test.js`.
- Added `functions/package.json` script `npm test`.
- `npm --prefix functions test`: PASS, 10 tests passed.

What remains:

- Full Firebase callable emulator/integration coverage is still pending; current tests exercise the handler/helper layer with mocked Firestore and ORS transport.
- Firestore rules are still not deployed.
- Functions are still not deployed.
- Payment provider work, checkout buttons, customer portal, webhook verification, and money collection remain stopped.

## Phase 4C.9 Callable Emulator Test Planning Update

Phase 4C.9 planning is captured in `plans/PHASE_4C9_CALLABLE_EMULATOR_TEST_PLAN.md`.

Recommended test strategy:

- Use Auth, Firestore, and Functions emulators together.
- Invoke real Firebase client `httpsCallable(...)` requests for `getPremiumRoute` and `getPremiumGeocode`.
- Seed `users/{uid}.entitlement` in the Firestore emulator through Admin SDK.
- Stub ORS in the Functions emulator process with a test-only `nock` preload and dummy `ORS_API_KEY=emulator-test-key`.
- Block non-local network during the test so real ORS quota cannot be spent.

Phase 4C.9 should remain test infrastructure only:

- No deployment.
- No runtime app code changes.
- No Firestore rules changes.
- No payment provider, checkout, webhook, or payment button work.

## Phase 4C.9 Callable Emulator Test Implementation Update

Phase 4C.9 is now implemented locally and not deployed:

- Added `functions/tests/ors-callable-emulator.test.js`.
- Added `functions/tests/ors-emulator-http-stub.js`.
- Added Auth and Functions emulator ports to `firebase.json`; Firestore remains on `8080`.
- Added root `test:functions:emulator`.
- Added `nock@13.5.6` for test-only ORS HTTP interception.
- Added local `firebase-tools@14.26.0` for `firebase-functions` v7 emulator compatibility.
- The emulator script creates a temporary dummy `functions/.secret.local` with `ORS_API_KEY=emulator-test-key`, then restores/removes it after the run.
- The ORS stub activates only under `BARK_ORS_EMULATOR_STUB=1`, blocks non-local network, allows emulator localhost traffic, intercepts only ORS route/geocode endpoints, and writes ORS call logs under `os.tmpdir()`.

Callable emulator coverage now proves:

- Real Firebase client `httpsCallable(...)` requests reach the Functions emulator.
- Auth emulator signed-in users are recognized by the callable context.
- The function reads `users/{uid}.entitlement` from Firestore emulator through Admin SDK.
- Unauthenticated, free, missing entitlement, malformed entitlement, canceled, expired, and past_due users are rejected.
- Client-provided `isPremium`, `entitlement`, `status`, and `uid` fields are ignored.
- Denied users do not reach the ORS stub log.
- Manual premium users reach the stubbed ORS route/geocode paths.

Verification:

- `node --check functions/tests/ors-emulator-http-stub.js`: PASS.
- `node --check functions/tests/ors-callable-emulator.test.js`: PASS.
- `npm --prefix functions test`: PASS, 10 tests.
- `npm run test:functions:emulator`: PASS, 9 tests.
- `npm run test:rules`: PASS, 12 tests.
- `npm run test:e2e:entitlement`: PASS as configured, skipped because E2E env/storage states were absent.
- `npm run test:e2e:global-search`: PASS as configured, skipped because E2E env/storage states were absent.
- `npm run test:e2e:smoke`: PASS as configured, skipped because E2E env/storage states were absent.

Remaining before deployment:

- Re-run Playwright E2E with configured free and premium storage states so those suites execute instead of skip.
- Re-run the full verification stack immediately before explicit deploy approval.
- Functions and Firestore rules remain undeployed.
- Payment provider, checkout, webhook, and payment button work remains stopped.

## Phase 4C.10 Rules And ORS Functions Deploy Gate Planning Update

Phase 4C.10 planning is captured in `plans/PHASE_4C10_RULES_FUNCTIONS_DEPLOY_GATE.md`.

Phase 4C.10 remains planning only:

- No Firestore rules deploy.
- No Functions deploy.
- No runtime app code changes.
- No Functions code changes.
- No Firestore rules changes.
- No payment provider, checkout, webhook, customer portal, money collection, or payment button work.

Deploy readiness verdict:

- NOT READY to deploy inside Phase 4C.10.
- Ready to enter a reviewed deploy gate only after the required tests, manual target/secret checks, clean working tree review, and explicit user/team approval.

The deploy gate documents:

- The committed backend safety stack through `98f8680`.
- Required pre-deploy commands for rules, handler tests, callable emulator tests, configured Playwright smoke, and git hygiene.
- Manual pre-deploy checks for Firebase project target, production/staging intent, ORS secret/config, storage-state/log hygiene, premium/free validation users, and payment stop lines.
- Candidate deploy commands for a later approved phase:
  - `firebase use <correct-project-alias>`
  - `firebase deploy --only firestore:rules`
  - `firebase deploy --only functions:getPremiumRoute,functions:getPremiumGeocode`
- Post-deploy validation for rules compatibility, free/premium ORS callable behavior, and Functions logs.
- Rollback options through a reviewed revert/redeploy path, available Firebase/GCP function revision controls, and emergency deny-closed posture if backend enforcement breaks.
- GO / NO-GO criteria and remaining paid-launch work after deploy.
