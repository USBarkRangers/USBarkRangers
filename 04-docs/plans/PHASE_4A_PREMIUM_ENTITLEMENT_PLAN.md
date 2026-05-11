# Phase 4A Premium Entitlement Plan

Date: 2026-05-01

Status: plan only. Do not implement payments, payment buttons, payment provider SDKs, Firebase rule changes, runtime entitlement code, tests, or deployment in Phase 4A.

## Evidence

Inventory commands run:

```sh
rg -n "premium|Premium|premium-locked|premium-unlocked|authPremiumUi|visited-filter|map-style-select|toggle-virtual-trail|toggle-completed-trails" services modules renderers repos state engines core index.html -g '*.js' -g '*.html'

rg -n "collection\\('users'\\)|collection\\(\"users\"\\)|doc\\(user\\.uid\\)|doc\\(uid\\)|premium|entitlement|subscription|plan" services modules renderers repos state engines core -g '*.js'
```

## 1. Current Premium Behavior

Current premium behavior is mostly sign-in gated, not entitlement gated.

| Surface | Current file | Current behavior | Entitlement concern |
|---|---|---|---|
| Premium filters wrapper | `index.html`, `services/authPremiumUi.js` | `#premium-filters-wrap` starts `premium-locked`; auth toggles `premium-locked` / `premium-unlocked` based on `isLoggedIn`. | Signed-in user equals premium today. Needs entitlement state. |
| Visited filter | `#visited-filter`, `authPremiumUi`, `uiController`, `authService` | Disabled signed out, enabled signed in. Signed-out reset to `all`. | Should unlock for premium entitlement, not merely login. |
| Map style select | `#map-style-select`, `authPremiumUi`, `mapEngine`, `authService` | Disabled signed out, enabled signed in. Signed-out reset to `default`. | Should unlock for premium entitlement, not merely login. |
| Virtual trail button | `#toggle-virtual-trail`, `authPremiumUi`, `expeditionEngine` | Disabled signed out, enabled signed in; click guard checks Firebase current user. | Should check entitlement, not auth only. |
| Completed trails button | `#toggle-completed-trails`, `authPremiumUi`, `expeditionEngine` | Disabled signed out, enabled signed in; click guard checks Firebase current user. | Should check entitlement, not auth only. |
| Premium trail notice/login jump | `#premium-trail-login-notice`, `modules/uiController.js` | Copy says trail tracking is premium; jump button opens Profile/login. | Future paywall entry point candidate. |
| Premium bubble mode setting | `#premium-cluster-toggle`, settings registry/controller/store, render/map/marker policy | Cloud setting exists as `premiumClustering`; currently a settings/performance option, not entitlement enforced. | Name is premium-looking. Need decide whether it is actually paid or just advanced settings. |
| Global town/city search | `modules/searchEngine.js` | `isPremiumGlobalSearchUnlocked()` returns true when signed in. Locked UI says sign in to unlock global routing. | Should be entitlement gated. |
| Premium offline mode | `modules/dataService.js` | Offline path checks `localStorage.getItem('premiumLoggedIn') === 'true'`. | Highest concern: localStorage must not control paid access. |
| ORS callables | `services/orsService.js`, `modules/barkConfig.js` | Names are `getPremiumRoute` and `getPremiumGeocode`; client calls Firebase callables. | Backend callable should eventually verify entitlement server-side before spending paid route/geocode quota. |
| Profile details sections | `index.html` `.premium-details` | UI styling names for details panels, not necessarily paid features. | Treat as visual naming unless product decides otherwise. |
| Manage portals | `#manage-places-portal`, `#manage-walks-portal` with `.premium-details` | Profile/manage UI. Current smoke covers manage portal. | Do not accidentally paywall user-owned data management. |

Current gating helper:

- `services/authPremiumUi.js` exposes `window.BARK.authPremiumUi.applyPremiumGating(isLoggedIn)`.
- `services/authService.js` calls it with `true` on sign-in and `false` on sign-out.
- The helper mutates only DOM lock/unlock state and reset values.

Current signed-in premium smoke:

- `tests/playwright/phase3a-premium-gating-smoke.spec.js` verifies current signed-in behavior. This is not payment entitlement coverage.

## 2. Current Auth/User Data Model

Current `users/{uid}` data fields found or implied by runtime code:

| Field / area | Current users | Notes |
|---|---|---|
| `visitedPlaces` | `VaultRepo`, `firebaseService`, legacy user doc paths | Visit state now owned locally by `VaultRepo`; Firestore field remains under `users/{uid}`. |
| `settings` | `authService.handleCloudSettingsHydration`, `firebaseService.saveUserSettings` | Includes map style, visited filter, performance settings, clustering flags, and `settingsUpdatedAt`. |
| `walkPoints` | `authService`, `firebaseService`, `expeditionEngine`, `profileEngine` | User score/progress state. |
| `lifetime_miles` | `authService`, `expeditionEngine` | Backfills `walkPoints` if larger. |
| `streakCount` | `authService`, `firebaseService` | Daily streak display and update. |
| `lastStreakDate` | `firebaseService` | Daily streak state. |
| Expedition fields | `expeditionEngine` | Active trail / completion data; multiple `users/{uid}` reads/writes. |
| `totalPoints` | `profileEngine.syncScoreToLeaderboard` | Written to `users/{uid}` and `leaderboard/{uid}`. |
| `totalVisited` | `profileEngine.syncScoreToLeaderboard` | Written to `users/{uid}` and `leaderboard/{uid}`. |
| `displayName` | `profileEngine.syncScoreToLeaderboard` | Written to leaderboard/user score payloads. |
| `hasVerified` | `profileEngine.syncScoreToLeaderboard` | Written to leaderboard/user score payloads. |
| `savedRoutes` subcollection | `tripPlannerCore`, `firebaseService`, `routeRenderer` | `users/{uid}/savedRoutes`. |
| Existing premium entitlement fields | None found | No durable premium/plan/subscription/entitlement field currently exists. |
| Existing premium settings fields | `settings.premiumClustering` | A settings value, not a payment entitlement. |

Important current write surfaces:

- `authService` broad `users/{uid}` listener reads user document data.
- `VaultRepo` owns `visitedPlaces` snapshot subscription.
- `firebaseService` writes visits, settings, streak, progress, expedition-adjacent data.
- `profileEngine` writes score/leaderboard fields.
- `tripPlannerCore` writes saved routes under `users/{uid}/savedRoutes`.

No client-side code should ever be allowed to write an entitlement-granting field.

## 3. Entitlement Model Options

### Option A - Store Premium Flag On `users/{uid}`

Shape example:

```js
users/{uid}: {
  premium: true,
  premiumStatus: "active",
  premiumUpdatedAt: ...
}
```

Pros:

- Simple client read path.
- Fits current broad auth user doc listener.
- Easy to support reload/login restore.

Cons:

- Easy to over-trust if rules allow client writes.
- A single boolean does not model trials, cancel-at-period-end, provider IDs, or expiration.
- Harder to audit subscription history.

Security risks:

- Critical if users can write `premium` or `premiumStatus`.
- Client-side local mutation must not unlock paid features.

Complexity:

- Low.

Launch suitability:

- Good for beta only if server/admin writes are locked down.

### Option B - Store Subscription Records Under `users/{uid}/subscriptions`

Shape example:

```js
users/{uid}/subscriptions/{subscriptionId}: {
  provider: "stripe",
  status: "active",
  currentPeriodEnd: ...
}
```

Pros:

- Better audit trail.
- Handles multiple provider events and historical state.
- Natural place for provider subscription IDs.

Cons:

- More complex client listener/read logic.
- Requires aggregation into "is premium now?" state.
- Client should not scan raw subscription docs for product logic without a cache.

Security risks:

- Client write protection is still mandatory.
- Rules and backend event handling are more complex.

Complexity:

- Medium.

Launch suitability:

- Better long-term, but heavier for first beta.

### Option C - External Provider Source Of Truth + Cached Entitlement In Firestore

Shape example:

```js
users/{uid}: {
  entitlement: {
    premium: true,
    status: "active",
    source: "stripe",
    providerCustomerId: "...",
    providerSubscriptionId: "...",
    currentPeriodEnd: ...
  }
}
```

Pros:

- Payment provider remains authoritative.
- Client gets a fast Firestore cache.
- Backend/webhook controls unlocks, revokes, refunds, and renewals.
- Works across devices and reloads.

Cons:

- Requires webhook/backend implementation before real payments.
- Cache consistency and delayed updates need UI states.
- Provider migrations need care.

Security risks:

- Firestore cache must be server/admin-written only.
- Backend must verify provider signatures and event authenticity.

Complexity:

- Medium.

Launch suitability:

- Best real launch model. Can be introduced in beta without choosing provider yet by using admin/manual source.

### Option D - Manual Admin Override Field For Beta

Shape example:

```js
users/{uid}: {
  entitlement: {
    premium: true,
    status: "manual_active",
    source: "admin_override",
    manualOverride: true
  }
}
```

Pros:

- Useful for testers, founders, comps, and QA.
- No payment provider required.
- Lets tests exercise premium/free differences before money is involved.

Cons:

- Needs admin tooling/process.
- Can become messy if manual fields compete with provider state.
- Must be auditable.

Security risks:

- Must be admin/server-written only.
- Client cannot grant/revoke itself.

Complexity:

- Low-medium.

Launch suitability:

- Excellent for beta and test harness, as long as provider source of truth is planned.

## 4. Recommended Entitlement Model

Recommended model: **Option C plus Option D**.

Use an entitlement cache on `users/{uid}` for client UI, with eventual external provider source of truth and a manual admin override path for beta.

Proposed beta-safe shape:

```js
users/{uid}: {
  entitlement: {
    premium: false,
    status: "free" | "active" | "manual_active" | "past_due" | "canceled" | "expired",
    source: "none" | "admin_override" | "stripe" | "lemon_squeezy",
    manualOverride: false,
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodEnd: null,
    updatedAt: serverTimestamp,
    reason: null
  }
}
```

Rules:

- Signed-out users are non-premium.
- Signed-in users are not automatically premium.
- The app reads entitlement from Firebase, not localStorage.
- Entitlement survives reload/login through Firestore.
- Failed payment must not unlock premium.
- Payment success must unlock only after a verified backend update.
- Refund/cancel/past-due provider events update entitlement via backend.
- Manual admin override can grant/revoke for beta/testers.
- Local UI can show "checking entitlement" or "payment processing", but it cannot unlock paid features by itself.

Client helper should compute:

```js
isPremium = entitlement.premium === true &&
  ["active", "manual_active"].includes(entitlement.status)
```

`currentPeriodEnd` handling should be server-owned. The client may display it but should not decide paid access solely from client time.

## 5. Premium State Owner

Recommended future owner: `services/premiumService.js`.

Why service over repo for first slice:

- Entitlement is not a large mutable client collection like visits.
- It coordinates auth/user-doc snapshot data, UI state, and later checkout initiation.
- It should be small and mostly read-only on the client.

Future responsibilities:

- Hold current entitlement snapshot for the active UID.
- Expose `isPremium()`, `getEntitlement()`, `subscribe(listener)`, and `reset()`.
- Normalize missing/old fields to free.
- Accept entitlement data from auth user-doc snapshot or its own listener.
- Notify `authPremiumUi` and other consumers when entitlement changes.
- Provide a single read API for search, expedition, offline, map tools, and paywall UI.

What it does not own:

- Payment provider secrets.
- Webhook verification.
- Firestore security rules.
- Checkout session creation internals.
- Premium DOM rendering details.
- Visit data, settings, trips, leaderboard, achievements, or auth session ownership.

Future authService relationship:

- `authService` remains auth session owner.
- On sign-in, `authService` passes user doc entitlement data to `premiumService`, or starts a narrow premium listener if chosen later.
- On sign-out, `authService` calls `premiumService.reset()`.
- `authService` should stop passing raw `isLoggedIn` to premium gating after 4C.

Future authPremiumUi relationship:

- `authPremiumUi.applyPremiumGating(isPremium)` consumes entitlement state, not login state.
- It remains DOM-only.
- It should not read Firebase or payment provider data directly.

## 6. Paywall Flow

Future user flow:

1. Free or signed-out user clicks a premium feature.
2. If signed out, paywall prompts sign-in first.
3. If signed in but free, paywall modal opens.
4. User chooses plan and starts checkout.
5. Client calls backend to create checkout session.
6. Payment provider checkout starts.
7. User completes or cancels checkout.
8. Success return shows "verifying payment" state, not unlocked state.
9. Backend verifies provider event or checkout session.
10. Backend writes `users/{uid}.entitlement`.
11. Client Firestore snapshot receives entitlement update.
12. `premiumService` updates.
13. `authPremiumUi` unlocks premium controls.
14. Reload/login restores premium from Firestore.

Do not unlock on:

- Checkout redirect alone.
- Client query string success param alone.
- localStorage flag.
- User manually clicking "I paid".

## 7. Failure And Recovery Flows

| Scenario | Expected behavior |
|---|---|
| Payment canceled | User remains free. Paywall can show canceled/no charge message. |
| Payment succeeds but entitlement update delayed | UI shows pending/verifying state. Premium stays locked until Firestore entitlement changes. |
| Payment succeeds but app reloads before update | On reload, app reads Firestore. If entitlement not updated yet, show free/pending; unlock when backend writes. |
| User changes browser/device | Entitlement restores from Firestore after login. No localStorage dependency. |
| Refund/cancel | Provider webhook/backend updates entitlement to canceled/expired; UI locks on next snapshot/reload. |
| Past due payment | Backend maps provider status to `past_due`; product decides grace or locked behavior server-side. |
| Admin manually grants premium | Admin/server writes `manual_active`; client unlocks on snapshot. |
| Admin manually revokes premium | Admin/server writes `free`/`expired`; client locks on snapshot. |
| Network offline | Use last known Firestore cached entitlement cautiously for UI display, but server-side paid callables must still enforce entitlement. Never use localStorage to newly grant premium. |
| Account switch | `premiumService.reset()` on sign-out/user switch; new UID entitlement snapshot determines access. |

## 8. Test Plan Before Implementation

Future tests before collecting money:

- Signed-out premium locked.
- Signed-in free locked.
- Signed-in premium unlocked.
- Premium persists after reload.
- Premium restores after fresh storage-state sign-in.
- Premium revokes after entitlement field changes.
- Payment success redirect does not unlock unless backend entitlement changes.
- Account switch premium isolation.
- Manual admin override grants and revokes premium if implemented.
- LocalStorage `premiumLoggedIn=true` does not unlock premium.
- Backend premium callables deny free users, if callable rules are in scope.

Existing tests to keep:

- `npm run test:e2e:premium`
- `npm run test:e2e:account-switch`
- `npm run test:e2e:settings`
- `npm run test:e2e:smoke`

Likely new tests:

- `tests/playwright/phase4-premium-entitlement-smoke.spec.js`
- Optional emulator/unit test for `premiumService` normalization.

## 9. Payment Provider Boundary

Do not choose a final provider in 4A.

High-level comparison:

| Provider | Pros | Cons |
|---|---|---|
| Stripe | Mature subscriptions, strong webhooks, Checkout, Customer Portal, tax tooling, broad docs, common Firebase integration patterns. | More setup complexity; tax/business configuration can take time. |
| Lemon Squeezy | Merchant-of-record model can reduce tax/payment ops, simpler product setup for small apps. | Less flexible than Stripe for custom subscription workflows; integration ecosystem may be narrower. |

Provider-independent boundary:

- Client never receives secrets.
- Client asks backend to start checkout.
- Backend creates checkout/session with provider.
- Provider webhooks update Firestore entitlement.
- App unlocks only from Firestore entitlement.

## 10. Data And Security Rules

Required rules:

- Client must not be able to grant itself premium.
- Premium entitlement fields should be server/admin-written only.
- Firestore rules must reject client writes to `entitlement`, `premium`, `premiumStatus`, subscription provider IDs, or override fields.
- If user settings remain client-writable, isolate them from entitlement fields.
- Test mode accounts should be separate from real users.
- No provider secrets in client code.
- Backend callables for paid resources should verify entitlement server-side.
- Do not rely on UI gating alone for paid API spend.

Suggested Firestore rule direction:

- Allow users to read their own entitlement.
- Deny users direct writes to entitlement fields.
- Allow backend Admin SDK writes.
- For manual override, use admin-only tooling or direct console/admin process with audit notes.

## 11. Phase 4 PR Breakdown

### 4A - Plan Only

This document.

No runtime code, tests, provider integration, rules, or deployment.

### 4B - Entitlement Read Model / Premium Service Skeleton

Goal:

- Add `services/premiumService.js`.
- Normalize missing entitlement to free.
- Expose `isPremium()`, `getEntitlement()`, `subscribe()`, `reset()`.
- Wire to auth user-doc data or a narrow read path without changing feature behavior yet.

Verification:

- Unit/smoke for signed-out free normalization.
- `npm run test:e2e:premium`
- `npm run test:e2e:smoke`

Implementation status:

- Phase 4B is implemented as a read-only skeleton.
- Added `services/premiumService.js`.
- Exposes `reset()`, `normalizeEntitlement(raw)`, `setEntitlement(raw, options)`, `getEntitlement()`, `isPremium()`, `subscribe(listener)`, and `getDebugState()`.
- Also exposes the service at `window.BARK.services.premium` and `window.BARK.premiumService`.
- Missing/null entitlement normalizes to free.
- Effective premium is true only when normalized entitlement has `premium === true` and status is `active` or `manual_active`.
- `authService` resets premium state on account change/sign-out and feeds `data.entitlement` from the existing broad user snapshot.
- This is read-only client state only: no Firestore writes, payment provider, checkout, payment buttons, Firebase rules, localStorage premium trust, or UI gating switch.
- Existing `authPremiumUi` sign-in-only gating remains unchanged until Phase 4C.
- Verification passed: `node --check services/premiumService.js services/authService.js`, entitlement reference grep, `npm run test:e2e:premium`, focused `npm run test:e2e:settings`, rerun `npm run test:e2e:smoke` with 9 tests, browser smoke for signed-out locked/signed-in unlocked controls, auth snapshot entitlement feed check, and `git diff --check`.

### 4C - UI Consumes Entitlement Instead Of Sign-In-Only Gating

Planning status:

- Phase 4C.1 is captured in `plans/PHASE_4C_ENTITLEMENT_UI_GATING_PLAN.md`.
- Phase 4C.3 implemented the first runtime scope for low-risk UI controls only: premium wrapper, visited filter, and map style select.
- Trail buttons remain auth-gated for this slice and are not entitlement-gated yet.
- Defer global search, offline mode, ORS callables, and premium clustering until test data, product decisions, and backend enforcement plans are ready.

Goal:

- `authPremiumUi.applyPremiumGating(isPremium)` uses entitlement state.
- Search/trail/offline checks use `premiumService.isPremium()`.
- Signed-in free users stay locked.

Verification:

- Signed-out locked.
- Signed-in free locked.
- Signed-in premium/manual override unlocked.
- Account switch isolation.

### 4D - Tests For Free Vs Premium State

Goal:

- Add automated entitlement smoke coverage before payment provider work.

Phase 4C.2 status:

- Added `tests/playwright/phase4c-premium-entitlement-smoke.spec.js`.
- Added npm script `test:e2e:entitlement`.
- The test verifies `premiumService` free vs premium/manual override state directly and intentionally does not assert different UI gating yet.
- It requires `BARK_E2E_BASE_URL`, `BARK_E2E_STORAGE_STATE`, and `BARK_E2E_PREMIUM_STORAGE_STATE`.
- Premium storage state was generated locally at `node_modules/.cache/bark-e2e/storage-state-premium.json`; it is local-only and must not be committed.
- Premium test user entitlement exists at `users/F8hS3KCvBBX4giarDtnJHDQSMmz2.entitlement` as a Firestore map, not a string.
- `npm run test:e2e:entitlement`: PASS, 1 passed.
- `npm run test:e2e:phase1b`: PASS, 3 passed.
- Free signed-in user: `premiumService.isPremium() === false`.
- Premium/manual override signed-in user: `premiumService.isPremium() === true`.
- UI gating has not been switched yet; that remains Phase 4C.3.
- No payment provider, payment buttons, Firebase rules, Firestore writes, deployment, or email/password UI were added.
- Google OAuth remains blocked in Playwright; E2E uses Firebase Email/Password storage state while real users still use Google sign-in.

Required cases:

- Free signed-in locked.
- Premium signed-in unlocked.
- Revocation locks.
- Reload/login restore.
- localStorage cannot unlock.

### 4E - Payment Provider Integration Design

Goal:

- Choose provider.
- Design checkout creation callable.
- Design webhook handling.
- Design entitlement update mapping.
- Design customer portal/cancel/refund handling.

No money collection until reviewed.

### 4F - Payment Implementation Later

Goal:

- Add provider SDK/backend.
- Add checkout UI.
- Add webhooks.
- Add Firestore rules.
- Add provider test mode validation.

Do not deploy paid features until entitlement tests, rules tests, and manual payment smoke pass.

## 12. Stop Lines

- Do not add payment provider yet.
- Do not collect money yet.
- Do not add payment buttons yet.
- Do not trust localStorage for premium.
- Do not let client write `premium=true`.
- Do not let client write entitlement status.
- Do not change Firebase rules without a dedicated rules/test task.
- Do not unlock premium on checkout redirect alone.
- Do not deploy paid features until entitlement tests pass.
- Do not combine entitlement work with authService splitting, settings hydration, trip planner, leaderboard, or VaultRepo work.

## Final Recommendation

Recommended entitlement model:

- External provider is eventual source of truth.
- Firestore `users/{uid}.entitlement` is the client-readable cache.
- Manual admin override supports beta/testers.
- App reads entitlement from Firebase via a small premium owner, never localStorage.
- Signed-out users and signed-in free users are non-premium.
- Payment success unlocks only after verified backend update.

Premium owner recommendation:

- Add `services/premiumService.js` in Phase 4B.
- Keep it read-only from the client perspective.
- Let `authService` feed/reset it.
- Let `authPremiumUi` consume it for DOM gating.

Current premium UI inventory:

- Premium map tools wrapper.
- Visited filter.
- Map style select.
- Virtual trail and completed trail buttons.
- Global town/city search.
- Premium offline mode.
- Premium bubble mode setting.
- ORS route/geocode callables with premium naming.

Data model proposal:

- `users/{uid}.entitlement` object with `premium`, `status`, `source`, optional provider IDs, optional period end, manual override flag, and server timestamp.
- Client-readable, server/admin-written.

Primary risks:

- Current sign-in-only premium behavior over-unlocks.
- `localStorage.premiumLoggedIn` is not acceptable for paid access.
- Backend callables can spend paid quota unless entitlement is enforced server-side.
- Firestore rules must prevent client self-grant.
- Payment success redirect can be spoofed unless backend verifies provider state.

Ready to implement Phase 4B?

Phase 4B is now implemented as a read-only `premiumService` skeleton and entitlement normalization slice. Ready to implement Phase 4C: YES only for making UI consumers read entitlement state behind tests. NO for payment provider integration, payment buttons, money collection, Firebase rule changes, or paid-feature deployment.

Phase 4C.2 entitlement smoke is now complete and passing.

Phase 4C.3 low-risk UI entitlement gating is now complete:

- `#premium-filters-wrap`, `#visited-filter`, and `#map-style-select` now use premium entitlement state.
- Signed-in free users stay locked for these controls.
- Premium/manual override users unlock these controls.
- Existing lock reset behavior is preserved for visited filter and map style.
- Trail buttons, global search, offline mode, premium clustering, ORS callables, backend/server behavior, payment provider work, payment buttons, Firebase rules, Firestore writes, and deployment remain deferred.
- `npm run test:e2e:entitlement`: PASS, 1 passed.
- `npm run test:e2e:premium`: PASS, 2 passed.
- `npm run test:e2e:smoke`: PASS, 9 passed.
- No client entitlement writes, payment provider, payment buttons, email/password UI, or deployment were added.

Phase 4C.4 backend/rules enforcement planning is now complete:

- Plan file: `plans/PHASE_4C4_BACKEND_RULES_PREMIUM_ENFORCEMENT_PLAN.md`.
- Deferred surfaces inventoried: trail buttons, expedition click guards, global search, offline mode / `localStorage.premiumLoggedIn`, premium clustering/bubble mode, ORS `getPremiumRoute` / `getPremiumGeocode`, entitlement writes, Firestore rules, and payment provider boundaries.
- `functions/index.js` exists and currently protects ORS callables with auth only, not premium entitlement.
- No root `firestore.rules` file exists in this repo at this time, and `firebase.json` does not reference one.
- Recommended next slice is Phase 4C.5: remove or neutralize `localStorage.premiumLoggedIn` as a premium grant path with focused tests.
- Payment provider work, checkout buttons, callable enforcement, rules changes, and deployment remain stopped until their own tested phases.

Phase 4C.5 localStorage premium bypass cleanup is now implemented:

- `modules/dataService.js` no longer uses `localStorage.premiumLoggedIn` as a premium unlock/grant source.
- Offline premium checks now use the read-only entitlement service, `premiumService.isPremium()`, and fail closed when the service is missing or non-premium.
- `tests/playwright/phase4c-premium-entitlement-smoke.spec.js` now includes a focused signed-in free-user bypass check that sets `localStorage.premiumLoggedIn = "true"` and confirms premium controls remain locked.
- Residual runtime references to `premiumLoggedIn`, `localStorage.*premium`, or `sessionStorage.*premium`: none found in `services modules renderers repos state engines core`.
- `npm run test:e2e:entitlement`: PASS, 2 passed.
- `npm run test:e2e:premium`: PASS, 2 passed.
- `npm run test:e2e:smoke`: PASS, 9 passed.
- Payment provider work, payment buttons, Firebase rules, ORS callables, global search, trail button gating, premium clustering, entitlement writes, and deployment remain deferred.

Phase 4C.6 trail/global-search entitlement planning is now complete:

- Plan file: `plans/PHASE_4C6_TRAILS_GLOBAL_SEARCH_ENTITLEMENT_PLAN.md`.
- Recommended split: 4C.6A trail button DOM/click-guard entitlement gating first; 4C.6B global search UI/check-guard entitlement gating separately.
- 4C.6A should include `#toggle-virtual-trail`, `#toggle-completed-trails`, `expeditionEngine.isExpeditionPremiumUnlocked()`, trail click guards, and `flyToActiveTrail()` bypass behavior if needed.
- 4C.6B should include `searchEngine.isPremiumGlobalSearchUnlocked()`, global search UI copy, and UI guards before `executeGeocode(...)`.
- ORS backend callable enforcement, Firebase rules, payment provider/buttons, premium clustering, offline mode, entitlement writes, and deployment remain deferred.

Phase 4C.6A trail entitlement gating is now implemented:

- Trail button DOM state now follows premium entitlement instead of login state.
- `expeditionEngine.isExpeditionPremiumUnlocked()` now uses `premiumService.isPremium()`.
- Signed-in free users are blocked by both disabled trail buttons and expedition click guards.
- Premium/manual override users can enable trail controls.
- `flyToActiveTrail()` now checks entitlement before clicking `#toggle-virtual-trail`.
- User-owned expedition/profile history was not hidden.
- `npm run test:e2e:entitlement`: PASS, 2 passed.
- `npm run test:e2e:premium`: PASS, 2 passed.
- `npm run test:e2e:smoke`: PASS, 9 passed.
- Global search remains deferred to 4C.6B; ORS backend callables, Firebase rules, payment provider/buttons, offline mode, premium clustering, entitlement writes, and deployment remain deferred.

Phase 4C.6B global search UI entitlement gating is now implemented:

- `modules/searchEngine.js` now gates global search UI/check guards with `premiumService.isPremium()` instead of Firebase current user.
- Signed-out users get sign-in copy/prompt for global search.
- Signed-in free users get upgrade/premium copy/prompt and do not intentionally reach UI geocode.
- Premium/manual override users can reach the global search UI path.
- Focused Playwright coverage stubs `window.BARK.services.ors.geocode` to avoid real ORS quota.
- Added npm script `test:e2e:global-search`.
- `npm run test:e2e:global-search`: PASS, 3 passed.
- `npm run test:e2e:entitlement`: PASS, 2 passed.
- `npm run test:e2e:premium`: PASS, 2 passed.
- `npm run test:e2e:smoke`: PASS, 9 passed.
- ORS backend callables, `services/orsService.js`, `functions/index.js`, Firebase rules, trip route generation, payment provider/buttons, offline mode, premium clustering, entitlement writes, and deployment remain deferred.

Phase 4C.7 Firestore rules entitlement protection planning is now complete:

- Plan file: `plans/PHASE_4C7_FIRESTORE_RULES_ENTITLEMENT_PLAN.md`.
- Inventory confirmed no root `firestore.rules` file exists and `firebase.json` does not reference Firestore rules or emulator config.
- No repo-local Firestore rules test harness currently exists.
- Recommended first rules approach is a beta-compatible owner-write baseline with explicit forbidden-field checks for entitlement, provider/payment, and admin fields.
- The plan also calls out `users/{uid}.isAdmin` as an adjacent protected field because `functions/index.js` reads it for admin callable authorization.
- Recommended test harness is `@firebase/rules-unit-testing` with Node 20 `node:test` and Firebase emulator execution.
- Do not deploy rules until emulator tests, E2E smoke, and manual release smoke pass.
- ORS backend callable enforcement remains deferred to Phase 4C.8; payment provider/buttons and deployment remain stopped.

Phase 4C.7B local Firestore rules baseline is now implemented:

- Added source-controlled `firestore.rules`.
- Added Firestore rules and emulator config to `firebase.json`.
- Added `tests/rules/firestore-entitlement.rules.test.js`.
- Added npm script `test:rules` and repo-local rules tooling dependencies.
- Rules protect entitlement, premium/provider/payment, and admin fields from client self-writes.
- Current app-owned user writes remain compatible for settings, visited places, saved routes, and owner leaderboard writes.
- `npm run test:rules`: PASS, 10 tests passed.
- `npm run test:e2e:smoke`: PASS, 9 tests passed.
- Rules were not deployed.
- ORS callable entitlement enforcement remains deferred to Phase 4C.8.

Phase 4C.8 ORS callable entitlement enforcement is now implemented locally:

- `functions/index.js` now checks `users/{uid}.entitlement` server-side before ORS route/geocode calls.
- `getPremiumRoute` and `getPremiumGeocode` require effective premium: `premium === true` with status `active` or `manual_active`.
- Signed-in free users, malformed entitlements, canceled, expired, and past_due statuses are rejected before ORS transport is called.
- Client-supplied premium flags are ignored.
- Added focused function tests in `functions/tests/ors-entitlement.test.js`.
- Added `functions/package.json` script `npm test`.
- `npm --prefix functions test`: PASS, 10 tests passed.
- Firestore rules and functions were not deployed.
- No payment provider, payment buttons, checkout, webhooks, Firebase rules changes, client entitlement writes, or runtime UI changes were added in this slice.

Remaining before paid launch:

- Reviewed rules deploy gate after explicit approval.
- Reviewed functions deploy gate after explicit approval.
- Provider design, checkout creation, webhook verification, customer portal, refunds/cancelation, and payment-state reconciliation remain future work.

Phase 4D payment provider and paywall UX planning is now complete:

- Plan file: `plans/PHASE_4D_PAYMENT_PROVIDER_PAYWALL_PLAN.md`.
- Firestore rules and ORS premium callables are now treated as deployed backend safety infrastructure for the payment-design phase.
- Post-deploy smoke is recorded as passed in the Phase 4D context.
- Payment provider work has still not started; no SDK, checkout buttons, webhooks, payment runtime code, or money collection were added in Phase 4D.
- The ORS key exposure from prior terminal/chat output remains a paid/public launch blocker; rotate it before any public paid beta.
- Recommended beta provider: Lemon Squeezy because Merchant-of-Record handling reduces tax/payment operations for a small niche app.
- Recommended scalable long-term provider: Stripe Billing, with Stripe Tax or Stripe Managed Payments evaluated if/when more control or scale is needed.
- Recommended beta price: `$15/year`, annual only, with 2-year/3-year plans deferred.
- Required payment invariant remains unchanged: checkout success URLs and client payment state must not unlock premium; only verified backend webhook/provider state may write `users/{uid}.entitlement`.
- Recommended next slice is Phase 4E: provider setup plus backend `createCheckoutSession` in test mode only, after ORS key rotation ownership is confirmed.

Phase 4E Lemon Squeezy checkout planning is now complete:

- Plan file: `plans/PHASE_4E_LEMONSQUEEZY_CHECKOUT_PLAN.md`.
- 4E remains backend-only and test-mode-only.
- Future `createCheckoutSession` callable should require `context.auth.uid`, use backend-owned Lemon Squeezy store/variant config, include Firebase `uid` in checkout custom data, and return only a hosted checkout URL.
- 4E must not write entitlement, add checkout buttons, add webhook handling, deploy, use live mode, or collect money.
- Required setup before implementation: Lemon Squeezy test-mode store, `$15/year` annual subscription variant, test API key, store ID, variant ID, success URL, cancel/abandon URL for later UX, and `APP_BASE_URL`.
- Ready to implement 4E: NO until those provider setup values are available to the implementation task.
