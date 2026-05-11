# Phase 4C Entitlement UI Gating Plan

Date: 2026-05-01

Status: planning only. Do not implement runtime changes, test changes, auth changes, Firestore writes, Firebase rules, payment provider integration, payment buttons, checkout, or deployment in Phase 4C.1.

## Evidence

Inventory command run:

```sh
rg -n "applyPremiumGating|handlePremiumGating|isPremium|premiumService|premium-locked|premium-unlocked|visited-filter|map-style-select|toggle-virtual-trail|toggle-completed-trails|isPremiumGlobalSearchUnlocked|premiumLoggedIn|premiumClustering|getPremiumRoute|getPremiumGeocode" services modules renderers repos state engines core index.html -g '*.js' -g '*.html'
```

Key inventory findings:

- `services/premiumService.js` exists and exposes the read-only Phase 4B entitlement API.
- `services/authService.js` feeds `data.entitlement` from the existing `users/{uid}` snapshot and resets premium state on account change/sign-out.
- `services/authPremiumUi.js` still receives a boolean named `isLoggedIn` and toggles premium DOM controls from auth state, not entitlement state.
- `modules/searchEngine.js` uses `isPremiumGlobalSearchUnlocked()` to check `firebase.auth().currentUser`.
- `modules/expeditionEngine.js` uses `isExpeditionPremiumUnlocked()` to check `firebase.auth().currentUser`.
- `modules/dataService.js` still checks `localStorage.getItem('premiumLoggedIn') === 'true'` for offline mode.
- `services/orsService.js` calls Firebase Functions named `getPremiumRoute` and `getPremiumGeocode`; the client currently only knows about the callable boundary.
- `settingsStore`, `settingsRegistry`, `settingsController`, `mapEngine`, `renderEngine`, `MarkerLayerManager`, and `markerLayerPolicy` use `premiumClusteringEnabled` / `premiumClustering` as a settings/performance option.

## 1. Current Gating Model

Current premium behavior is still mostly "signed in means premium" plus one unsafe localStorage check.

| Surface | Current gating | Mentions premium? | Paid-feature candidate? | Notes |
|---|---|---:|---:|---|
| Premium map tools wrapper | `authService.handlePremiumGating(true/false)` calls `authPremiumUi.applyPremiumGating(isLoggedIn)`. | Yes | Yes | Main low-risk 4C candidate. |
| `#visited-filter` | Enabled for signed-in users, disabled/reset for signed-out users. | Inside premium tools | Yes | UI-only control; good first entitlement switch. |
| `#map-style-select` | Enabled for signed-in users, disabled/reset for signed-out users. | Inside premium tools | Yes | UI-only control; good first entitlement switch if product wants map styles paid. |
| `#toggle-virtual-trail` | DOM enabled for signed-in users; click guard checks Firebase current user. | Yes | Yes | Needs both DOM gating and click guard switched together. |
| `#toggle-completed-trails` | DOM enabled for signed-in users; click guard checks Firebase current user. | Yes | Yes | Same as virtual trails. |
| Global town/city search | `isPremiumGlobalSearchUnlocked()` checks Firebase current user. | Yes | Yes, but backend-adjacent | Uses ORS geocode callable, so UI gating alone is not enough. |
| Offline mode | `localStorage.premiumLoggedIn === "true"`. | Yes | Yes, but unsafe today | Must not rely on localStorage for paid access. Needs careful replacement. |
| Premium bubble/clustering mode | Cloud/local settings flag `premiumClustering`. | Yes | Unclear | Looks like an advanced performance setting. Do not paywall until product decision. |
| ORS route/geocode callables | Client calls `getPremiumRoute` / `getPremiumGeocode`. | Yes | Yes, backend-enforced candidate | Server must verify entitlement before quota-protected access. |
| Profile/manage details with `.premium-details` | Styling/class names only. | Yes | No | Do not paywall user-owned data management. |
| Saved routes/trip planner | Sign-in/user data gated, not premium entitlement gated. | Some premium adjacent via ORS | Partly | Saved user data should remain accessible to signed-in owners unless product explicitly changes. |

Surfaces that should not be paywalled in 4C:

- Login/profile basics.
- Manage visited places/walks.
- Viewing/restoring user-owned data.
- Core park browsing and local park search.
- Settings unrelated to paid features.

## 2. Future Entitlement Gating Model

Use `premiumService.isPremium()` as the client-side read model:

- Signed out = not premium.
- Signed in free = not premium.
- Signed in with entitlement `premium: true, status: "active"` = premium.
- Signed in with entitlement `premium: true, status: "manual_active"` = premium.
- `canceled`, `expired`, `past_due`, `free`, missing, null, malformed, or stale-looking client-local values = not premium.
- Grace periods should not be invented client-side. If grace is desired, the backend/admin entitlement cache should expose an explicit premium-active status for that period.
- Checkout success redirects must never unlock premium directly; only the verified entitlement cache can unlock premium.

Phase 4C should make UI behavior consume entitlement state, not payment state and not localStorage.

## 3. UI Behavior Decisions

| Surface | 4C decision | Reason |
|---|---|---|
| Visited filter | Gate now in 4C.3 after tests. | Low-risk DOM/select behavior already covered by premium/settings smokes. |
| Map style select | Gate now in 4C.3 after tests. | Low-risk DOM/select behavior; existing sign-in premium smoke covers enabled/disabled state. |
| Virtual trails | Gate now only if click guard switches with DOM gating in same PR. | Avoid a mismatch where the button is locked but direct click paths still allow signed-in free users. |
| Completed trails | Gate now only if click guard switches with DOM gating in same PR. | Same as virtual trails. |
| Global search | Defer from first 4C implementation. | It spends ORS/geocode quota and needs backend/server entitlement enforcement plan. UI copy can be planned but not trusted. |
| Offline mode | Defer and remove from localStorage trust in a dedicated slice. | Current `premiumLoggedIn` check is unsafe. Replacing it may affect offline startup behavior and needs focused testing. |
| Premium clustering/bubble mode | Defer and product-confirm whether it is paid. | It appears to be a performance/visual setting, not clearly a paid entitlement. Do not accidentally lock accessibility/performance controls. |
| ORS route/geocode callables | Defer until backend/rules plan. | Client gating cannot protect provider quota or secrets. Server-side callable checks must be designed first. |

Recommended 4C runtime scope:

- First switch only `authPremiumUi`-managed low-risk map controls: premium wrapper, visited filter, map style select, virtual trail button, completed trail button.
- Include expedition click guards only if the same PR updates the trail controls; otherwise leave trail buttons deferred.
- Do not change global search, offline mode, ORS callables, or premium clustering in the first entitlement UI switch.

## 4. Proposed Implementation Shape

Expected implementation files for 4C.3:

- `services/authPremiumUi.js`
- `services/authService.js`
- `modules/expeditionEngine.js` only if trails are included.
- `index.html` only if copy needs a tiny sign-in/free distinction.
- `tests/playwright/phase3a-premium-gating-smoke.spec.js` or a new Phase 4C premium entitlement smoke.
- Planning docs.

Implementation design:

- Keep login UI separate from premium UI.
- Rename the semantic input to `authPremiumUi.applyPremiumGating(isPremium)` or add a wrapper like `applyEntitlementGating(isPremium)`.
- Add a small `refreshPremiumUiFromEntitlement(reason)` helper in `authService`.
- On sign-out/account-change, `premiumService.reset()` stays the source of non-premium state.
- Subscribe once to `premiumService.subscribe(...)` during auth initialization or immediately after service load.
- When premium state changes, call the premium UI helper with `premiumService.isPremium()`.
- During signed-in snapshot delay, default to locked/free. Do not temporarily unlock because a user is signed in.
- Keep sign-in/profile prompts in separate code paths; a signed-in free user should see a paywall/upgrade prompt later, not a login prompt.
- Do not unlock any paid UI from checkout redirect, localStorage, URL params, or optimistic client state.

Important sequencing:

1. Land tests that distinguish signed-in free from signed-in premium/manual override.
2. Switch low-risk UI gating to entitlement.
3. Only then update copy and broader feature checks.

## 5. Tests Needed Before/With 4C

Update or add Playwright coverage before the runtime switch:

- Signed-out locked.
- Signed-in free locked.
- Signed-in premium/manual override unlocked.
- Premium state persists after reload.
- Entitlement revocation locks controls after snapshot update.
- Account switch free/premium isolation.
- `localStorage.premiumLoggedIn = "true"` does not unlock entitlement-gated UI.
- Existing visit lifecycle, account-switch, profile/manage, trip planner, and settings smoke still pass.

Recommended commands after 4C.3:

```sh
npm run test:e2e:premium
npm run test:e2e:account-switch
npm run test:e2e:settings
npm run test:e2e:smoke
git diff --check
```

Manual smoke after 4C.3:

- Signed out: premium controls locked.
- Signed-in free: premium controls locked; profile/login UI still works.
- Signed-in premium/manual override: premium controls unlocked.
- Reload keeps correct premium state.
- Switching accounts does not leak premium state.
- No console errors related to `premiumService`, `authPremiumUi`, `authService`, `expeditionEngine`, or `user snapshot`.

## 6. Test Data Setup

Tests must not write entitlement from the client.

Recommended E2E account setup:

- User A: signed-in free account with missing/null/free entitlement.
- User B: signed-in premium account with a manually seeded entitlement:

```js
entitlement: {
  premium: true,
  status: "manual_active",
  source: "admin_override",
  manualOverride: true,
  currentPeriodEnd: null
}
```

Acceptable setup methods:

- Firebase Console manual setup for the premium test account.
- A backend/admin test helper later.
- Pre-seeded E2E users maintained outside the client app.

Not acceptable:

- Client UI writing `entitlement`.
- Browser console/client script updating `users/{uid}.entitlement`.
- localStorage/sessionStorage flags.
- Test code that bypasses the app by mutating client-side premium service state and then claiming end-to-end coverage.

Current readiness:

- User A and User B storage states exist from Phase 3A, but this plan does not assume User B is already premium.
- 4C.2 should not be considered fully verifiable until one E2E account has a server/admin-written manual premium entitlement.

## 7. Risks

- Locking out current beta testers unexpectedly if all signed-in users become free by default and no manual override is seeded.
- Breaking signed-in-only features that were labeled "premium" but were really just account features.
- UI gating without backend enforcement can create a false sense of security.
- Client self-grant risk if tests or runtime accidentally write entitlement from the browser.
- `localStorage.premiumLoggedIn` is a bypass risk and should not survive as paid-access logic.
- ORS callables can still spend provider quota unless Firebase Functions verify entitlement server-side.
- Account switching can briefly show stale premium UI unless reset/subscription ordering is handled carefully.
- Cloud snapshot delay can cause flicker; default should be locked until entitlement is known.
- Existing premium smoke currently expects signed-in controls to unlock; it must be updated before the behavior switch.

## 8. Stop Lines

- Do not add a payment provider.
- Do not add checkout buttons.
- Do not collect money.
- Do not let the client write entitlement.
- Do not change Firebase rules in this PR.
- Do not gate backend callables without a server-side entitlement plan.
- Do not trust localStorage/sessionStorage for premium.
- Do not paywall profile/manage/user-owned data.
- Do not deploy.

## 9. Recommended PR Breakdown

### 4C.1 - Plan Only

This document.

No runtime code, tests, auth changes, Firestore writes, Firebase rules, provider code, payment buttons, or deployment.

### 4C.2 - Premium Entitlement Smoke Prep

Goal:

- Update/add Playwright smoke coverage so it can distinguish signed-out, signed-in free, and signed-in premium/manual override users.
- Use server/admin-preseeded entitlement data.
- Keep current runtime behavior unchanged in this PR unless the test is written as pending/skipped against the future behavior.

Likely files:

- `tests/playwright/phase3a-premium-gating-smoke.spec.js` or `tests/playwright/phase4c-premium-entitlement-smoke.spec.js`
- `package.json` only if adding a focused script.
- Planning docs.

Exit criteria:

- Test data dependency documented.
- Free vs premium assertions are explicit.
- Client does not write entitlement.

Implementation status:

- Added `tests/playwright/phase4c-premium-entitlement-smoke.spec.js`.
- Added npm script `test:e2e:entitlement`.
- The smoke loads a free signed-in user from `BARK_E2E_STORAGE_STATE` and a premium/manual override user from `BARK_E2E_PREMIUM_STORAGE_STATE`.
- It verifies `premiumService` exists, waits for the auth user snapshot to feed entitlement state, asserts the free user has `premiumService.isPremium() === false`, and asserts the premium/manual override user has `premiumService.isPremium() === true`.
- It does not require UI controls to differ yet because current runtime gating is still sign-in-only until 4C.3.
- It keeps direct Firestore/app-state diagnostics in assertion output for future entitlement seeding mistakes.
- It does not write entitlement from the client.
- Premium storage state was generated locally at `node_modules/.cache/bark-e2e/storage-state-premium.json`; it is local-only and must not be committed.
- Premium test user entitlement exists at `users/F8hS3KCvBBX4giarDtnJHDQSMmz2.entitlement` as a Firestore map, not a string.
- Verification: `node --check tests/playwright/phase4c-premium-entitlement-smoke.spec.js` passed and `package.json` parsed.
- `npm run test:e2e:entitlement`: PASS, 1 passed.
- `npm run test:e2e:phase1b`: PASS, 3 passed.
- Free signed-in user: `premiumService.isPremium() === false`.
- Premium/manual override signed-in user: `premiumService.isPremium() === true`.
- Existing UI gating is still sign-in gated, so both signed-in users may show unlocked controls until 4C.3.
- No runtime app code, authPremiumUi behavior, premiumService behavior, Firestore writes, Firebase rules, payment provider, payment buttons, deployment, or email/password UI were added.
- Google OAuth remains blocked in Playwright; E2E uses Firebase Email/Password storage state while real users still use Google sign-in.

### 4C.3 - Switch Low-Risk UI Controls To Entitlement

Goal:

- Make `authPremiumUi` consume entitlement state for the premium wrapper, visited filter, map style select, and selected trail buttons.
- Wire `premiumService.subscribe(...)` or equivalent refresh from `authService`.
- Default locked while entitlement is unknown/free.
- Keep login UI separate from premium UI.

Likely files:

- `services/authPremiumUi.js`
- `services/authService.js`
- `modules/expeditionEngine.js` if trail click guards are included.
- Tests/docs.

Exit criteria:

- Signed-in free stays locked.
- Signed-in premium/manual override unlocks.
- Account switch isolation passes.
- Full smoke bundle passes.

Implementation status:

- Phase 4C.3 is implemented for low-risk controls only.
- `#premium-filters-wrap`, `#visited-filter`, and `#map-style-select` now consume effective premium entitlement state from `premiumService.isPremium()`.
- Signed-out users remain locked.
- Signed-in free users remain locked for the low-risk premium controls.
- Signed-in premium/manual override users unlock the low-risk premium controls.
- Locking preserves the previous reset behavior: `#visited-filter` is disabled and reset to `all`; `#map-style-select` is disabled and reset to `default`.
- Trail buttons remain auth-gated for this slice and are not entitlement-gated yet.
- Global search, offline mode, premium clustering/bubble mode, ORS `getPremiumRoute` / `getPremiumGeocode`, backend/server behavior, Firebase rules, payment provider work, and payment buttons remain deferred.
- `tests/playwright/phase4c-premium-entitlement-smoke.spec.js` now asserts free vs premium UI state for the low-risk controls.
- `tests/playwright/phase3a-premium-gating-smoke.spec.js` now expects signed-in free users to stay locked for entitlement-gated controls while signed-in trail buttons remain auth-enabled.
- `tests/playwright/phase3a-settings-persistence-smoke.spec.js` now uses `BARK_E2E_PREMIUM_STORAGE_STATE` because `#visited-filter` is premium-only after 4C.3.
- Verification passed: `node --check services/authPremiumUi.js services/authService.js services/premiumService.js tests/playwright/phase4c-premium-entitlement-smoke.spec.js tests/playwright/phase3a-premium-gating-smoke.spec.js tests/playwright/phase3a-settings-persistence-smoke.spec.js`.
- `npm run test:e2e:entitlement`: PASS, 1 passed.
- `npm run test:e2e:premium`: PASS, 2 passed.
- `npm run test:e2e:smoke`: PASS, 9 passed.
- No Firestore writes, Firebase rules, payment code, payment provider, payment buttons, VaultRepo, RefreshCoordinator, ORS service, searchEngine global search gating, expeditionEngine trail click guards, dataService offline mode, settings premiumClustering logic, or deployment changes were made.

### 4C.4 - Backend / Rules Plan For ORS, Offline, And Global Search

Goal:

- Design server-side entitlement enforcement for `getPremiumRoute` / `getPremiumGeocode`.
- Plan offline mode replacement for `localStorage.premiumLoggedIn`.
- Decide whether global search is paid and how backend quota enforcement works.
- Decide whether premium clustering is paid or free.

No callable/rules implementation in this planning PR.

Implementation status:

- Phase 4C.4 planning is complete in `plans/PHASE_4C4_BACKEND_RULES_PREMIUM_ENFORCEMENT_PLAN.md`.
- The plan inventories deferred premium surfaces and classifies ORS callables, entitlement writes/rules, `localStorage.premiumLoggedIn`, global search, trail buttons, and premium clustering/bubble mode.
- No runtime code, tests, Firestore rules, backend callables, payment provider work, payment buttons, checkout, webhooks, deployment, or entitlement writes were added.
- Recommended next slice is Phase 4C.5: remove or neutralize `localStorage.premiumLoggedIn` as a premium grant path with focused tests.

### 4C.5 - Remove LocalStorage Premium Unlock

Implementation status:

- Phase 4C.5 is implemented.
- `modules/dataService.js` no longer trusts `localStorage.premiumLoggedIn` for offline premium access.
- Offline premium checks now read `premiumService.isPremium()` and fail closed when entitlement state is missing or non-premium.
- `tests/playwright/phase4c-premium-entitlement-smoke.spec.js` now proves a signed-in free user remains non-premium and low-risk premium controls stay locked even when `localStorage.premiumLoggedIn` is set to `"true"`.
- Residual premium storage references: none found by `rg -n "premiumLoggedIn|localStorage.*premium|sessionStorage.*premium" services modules renderers repos state engines core -g '*.js'`.
- Verification passed: `node --check modules/dataService.js tests/playwright/phase4c-premium-entitlement-smoke.spec.js`.
- Verification passed: `npm run test:e2e:entitlement`, 2 passed.
- Verification passed: `npm run test:e2e:premium`, 2 passed.
- Verification passed: `npm run test:e2e:smoke`, 9 passed.
- Payment provider work, payment buttons, Firebase rules, ORS callable enforcement, global search gating, trail button gating, premium clustering changes, entitlement writes, and deployment remain deferred.

### 4C.6 - Trail Buttons And Global Search UI Entitlement Gating

Planning status:

- Phase 4C.6 planning is complete in `plans/PHASE_4C6_TRAILS_GLOBAL_SEARCH_ENTITLEMENT_PLAN.md`.
- Recommended split: implement 4C.6A trail button DOM/click-guard entitlement gating first, then handle 4C.6B global search UI/check-guard entitlement gating separately.
- 4C.6A should cover `#toggle-virtual-trail`, `#toggle-completed-trails`, `expeditionEngine.isExpeditionPremiumUnlocked()`, trail click guards, and `flyToActiveTrail()` bypass behavior if needed.
- 4C.6B should cover `searchEngine.isPremiumGlobalSearchUnlocked()`, inline/main global search UI copy, and UI guards before `executeGeocode(...)`.
- ORS callable enforcement, Firebase rules, payment provider work, payment buttons, premium clustering, offline mode, and deployment remain deferred.

Implementation status:

- Phase 4C.6A is implemented.
- Trail button DOM state and expedition click guards now use premium entitlement, not signed-in auth state.
- Signed-out and signed-in free users keep `#toggle-virtual-trail` and `#toggle-completed-trails` disabled with `aria-disabled="true"`.
- Premium/manual override users get enabled trail buttons.
- `flyToActiveTrail()` now has an entitlement guard before it can click `#toggle-virtual-trail`.
- User-owned expedition/profile history was not hidden.
- `npm run test:e2e:entitlement`: PASS, 2 passed.
- `npm run test:e2e:premium`: PASS, 2 passed.
- `npm run test:e2e:smoke`: PASS, 9 passed.
- Global search remains deferred to 4C.6B, and ORS/backend/rules/payment work remains deferred.

Implementation status for 4C.6B:

- Phase 4C.6B is implemented.
- `modules/searchEngine.js` now uses premium entitlement for global search UI/check guards.
- Signed-out users get sign-in-oriented global search copy/prompt.
- Signed-in free users get upgrade/premium global search copy/prompt and do not intentionally reach the UI geocode path.
- Premium/manual override users can reach the global search UI path.
- Main search and inline planner global search re-check entitlement before calling `executeGeocode(...)`.
- `executeGeocode(...)` fail-closes before ORS geocode for non-premium users, while leaving the GPS "my location/current location" path alone.
- Added `tests/playwright/phase4c-global-search-entitlement-smoke.spec.js` and npm script `test:e2e:global-search`.
- `npm run test:e2e:global-search`: PASS, 3 passed.
- ORS backend callable enforcement remains deferred to Phase 4C.8; `services/orsService.js`, `functions/index.js`, Firebase rules, trip route generation, payment provider/buttons, offline mode, premium clustering, entitlement writes, and deployment remain untouched/deferred.

### 4D - Payment Provider Design Later

Goal:

- Choose provider.
- Design checkout creation, webhook verification, customer portal, refunds/cancel/revocation mapping.
- Keep payment implementation separate.

## Final Recommendation

Recommended 4C scope:

- Start with tests and test data.
- Gate only low-risk UI controls first: premium wrapper, visited filter, map style select, and trail buttons if their click guards switch in the same PR.
- Defer global search, offline mode, ORS callables, and premium clustering until product/backend decisions are made.

Test data requirements:

- One signed-in free E2E account.
- One signed-in premium/manual override E2E account.
- Entitlement must be written outside the client app through Firebase Console, admin tooling, or a later backend helper.

Expected implementation files:

- `services/authPremiumUi.js`
- `services/authService.js`
- `modules/expeditionEngine.js` if trails are included.
- Premium entitlement Playwright smoke file and optional package script.
- Planning docs.

Ready to implement 4C.2?

4C.2 is complete and verified. Ready to implement 4C.3: YES, for the planned UI entitlement gating switch only. Do not add payment provider work, payment buttons, Firebase rules, Firestore writes, backend callable gating, or deployment in 4C.3.

Phase 4C.3 is now complete. Next recommended step is not payment implementation; it should be either a focused review/QC of 4C.3 or Phase 4C.4 backend/rules planning for ORS, offline mode, and global search.

## Phase 4C.7 Rules Planning Status

Phase 4C.7A is now complete as planning only:

- Plan file: `plans/PHASE_4C7_FIRESTORE_RULES_ENTITLEMENT_PLAN.md`.
- No runtime app code, tests, Firestore rules, Firebase rules config, ORS callables, payment provider work, payment buttons, or deployment were changed in the planning slice.
- Current repo state has no root `firestore.rules` and no `firebase.json` Firestore rules/emulator config.
- The recommended 4C.7B implementation is a source-controlled rules baseline with emulator test tooling, not a deploy.
- The first rules baseline should preserve existing user-owned writes while blocking client writes to entitlement/provider/admin fields.
- Phase 4C.8 remains the planned ORS backend callable entitlement enforcement slice.
