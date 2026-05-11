# Phase 4C.6 Trails / Global Search Entitlement Gating Plan

Date: 2026-05-01

Status: planning only. Do not implement runtime code, tests, backend callables, Firebase rules, payment provider work, payment buttons, checkout, webhooks, premium clustering changes, offline-mode changes, or deployment in this planning slice.

## Evidence

Inventory commands run:

```sh
rg -n "toggle-virtual-trail|toggle-completed-trails|isExpeditionPremiumUnlocked|premium-trail-login-notice|flyToActiveTrail|renderVirtualTrailOverlay|renderCompletedTrailsOverlay" modules services renderers state engines core index.html -g '*.js' -g '*.html'

rg -n "isPremiumGlobalSearchUnlocked|global search|globalSearch|premium global|premium routing|town|city|getPremiumGeocode|getPremiumRoute|ORS|ors" modules services renderers state engines core index.html -g '*.js' -g '*.html'
```

Key findings:

- `services/authPremiumUi.js` still controls `#toggle-virtual-trail` and `#toggle-completed-trails` through the `trailsUnlocked` option.
- `services/authService.js` currently passes `trailsUnlocked` from signed-in auth state, so signed-in free users can still have trail buttons enabled.
- `modules/expeditionEngine.js` uses `isExpeditionPremiumUnlocked()` to check Firebase current user, not premium entitlement.
- `window.flyToActiveTrail()` can trigger the virtual trail toggle by clicking `#toggle-virtual-trail`.
- `modules/searchEngine.js` uses `isPremiumGlobalSearchUnlocked()` to check Firebase current user, not premium entitlement.
- Global search UI paths call `executeGeocode(...)`, which uses `window.BARK.services.ors.geocode(...)`.
- `services/orsService.js` calls Firebase Functions `getPremiumGeocode` and `getPremiumRoute`.
- `engines/tripPlannerCore.js` calls `window.BARK.services.ors.directions(...)` for trip route generation.
- ORS backend enforcement is not part of this phase.

## 1. Current Behavior Inventory

### Trail Buttons

| Surface | Current behavior | Current risk |
|---|---|---|
| DOM lock/unlock | `authPremiumUi.applyPremiumGating(isPremium, { trailsUnlocked })` sets `disabled` and `aria-disabled` for `#toggle-virtual-trail` and `#toggle-completed-trails`. Current `authService` passes `trailsUnlocked` from auth state. | Signed-in free users can see enabled trail buttons. |
| Click guard | `expeditionEngine.isExpeditionPremiumUnlocked()` returns true for any Firebase current user. | Signed-in free users can toggle trail overlays even though they lack entitlement. |
| Signed-out prompt/behavior | Buttons start disabled. If a click path reaches the guard, `blockLoggedOutTrailToggle(...)` removes active state and trail layers. The visible notice says trail tracking is premium and has a `Log in` button. | Copy only covers signed-out/login, not signed-in free upgrade. |
| Signed-in free behavior | Buttons can be enabled by auth state and click guards allow overlays. | Incorrect after entitlement model. |
| Premium/manual override behavior | Should be enabled; current auth-only behavior also enables them. | Premium path works, but not because of entitlement. |
| User-owned expedition/profile data | Auth hydration can render active/completed trail overlays via `renderVirtualTrailOverlay` and `renderCompletedTrailsOverlay`. | Plan must avoid hiding profile/history data unless product explicitly decides trail history itself is paid. |
| `flyToActiveTrail()` | Navigates to map and clicks `#toggle-virtual-trail` if inactive. | Must respect the same entitlement guard or it can become a bypass. |

### Global Search

| Surface | Current behavior | Current risk |
|---|---|---|
| Unlock check | `searchEngine.isPremiumGlobalSearchUnlocked()` returns true for any Firebase current user. | Signed-in free users can reach global search UI and geocode path. |
| Inline planner global search | `appendInlineGlobalSearchButton(...)` labels signed-in users as able to search towns/cities and calls `executeGeocode(...)`. | Can reach ORS geocode callable. |
| Main search federated/global option | The main search path uses the same auth-only premium check and calls `executeGeocode(...)`. | Can reach ORS geocode callable. |
| Prompt copy | Non-unlocked state says "Sign in to unlock global routing" and alert says to log in via Profile. | Signed-in free users need upgrade/paywall copy, not a login prompt. |
| ORS/geocode backend | Client calls `window.BARK.services.ors.geocode(...)`, which calls `getPremiumGeocode`. | Backend currently remains the real security gap; UI gating is not enough. |
| Route backend | `tripPlannerCore` calls `window.BARK.services.ors.directions(...)`, which calls `getPremiumRoute`. | This is route-generation/backend enforcement, not global-search UI. Defer from 4C.6. |

Backend protection status:

- Backend callables are not entitlement-enforced yet.
- 4C.6 must not claim global search is secure. It can only improve UI and reduce accidental free-user use.

## 2. Recommended 4C.6 Scope

Recommended split:

- **4C.6A: trail button DOM and expedition click guards only.**
- **4C.6B: global search UI/check guard only, as a separate PR.**

Do not combine both in one PR.

Why:

- Trails touch `authPremiumUi`, `authService`, and `expeditionEngine`. They are client/UI behavior and do not directly spend third-party ORS quota.
- Global search touches `searchEngine` and the ORS geocode path. It is still only UI/client gating unless `getPremiumGeocode` is enforced server-side.
- Splitting makes tests sharper: one trail test suite can prove DOM/click-guard agreement; one global-search test can prove signed-in free users do not intentionally reach UI geocode paths.

Recommended 4C.6A include:

- `#toggle-virtual-trail`
- `#toggle-completed-trails`
- `expeditionEngine.isExpeditionPremiumUnlocked()`
- click guards in `initTrailToggles()`
- `window.flyToActiveTrail()` bypass check if needed
- signed-out vs signed-in free vs premium prompt behavior

Recommended 4C.6A defer:

- global search
- ORS callables
- Firebase rules
- offline mode
- premium clustering
- payment provider/buttons

Recommended 4C.6B include later:

- `searchEngine.isPremiumGlobalSearchUnlocked()`
- inline planner global search button state/copy
- main search global/federated button state/copy
- direct UI guard before `executeGeocode(...)`
- tests that signed-in free users do not reach the UI geocode path

Recommended 4C.6B defer:

- `functions/index.js`
- `services/orsService.js` unless a tiny error-message mapping is required
- `engines/tripPlannerCore.js` route generation
- actual backend security claims

## 3. Required Behavior

### Trail Buttons

Required 4C.6A behavior:

- Signed out:
  - trail buttons disabled or click-blocked.
  - sign-in prompt remains appropriate.
  - active trail layers are removed if a blocked click path is reached.
- Signed-in free:
  - trail buttons disabled or click-blocked.
  - copy should indicate upgrade/premium requirement, not "log in" as if auth is missing.
  - click guards must block direct/manual clicks even if the DOM gets out of sync.
- Premium/manual override:
  - trail buttons enabled.
  - virtual trail and completed trail overlays can be toggled.
- DOM state and click guards must agree.
- `window.flyToActiveTrail()` must not bypass entitlement by clicking an otherwise blocked virtual trail button.
- User-owned expedition/profile progress should remain visible unless product explicitly decides to hide it. The first PR should gate overlay controls, not erase history.

### Global Search

Required 4C.6B behavior:

- Signed out:
  - sign-in prompt.
  - global search/geocode not executed through UI.
- Signed-in free:
  - upgrade/paywall prompt.
  - global search/geocode not executed through UI.
- Premium/manual override:
  - global search UI allowed.
  - `executeGeocode(...)` may be reached.
- UI must clearly state that backend ORS callables still need server-side entitlement enforcement later.
- Client must not treat `premiumService.isPremium()` as a security boundary.
- Direct calls to ORS callables remain a backend risk until 4C.8.

## 4. Implementation Shape

### 4C.6A Trail Buttons

Likely runtime files:

- `services/authPremiumUi.js`
- `services/authService.js`
- `modules/expeditionEngine.js`

Likely test/docs files:

- `tests/playwright/phase3a-premium-gating-smoke.spec.js`
- `tests/playwright/phase4c-premium-entitlement-smoke.spec.js` or a new trail-focused smoke
- Phase 4 docs

Suggested implementation shape:

- Stop passing auth-derived `trailsUnlocked` from `authService`; use effective premium state for trail buttons.
- Add a tiny helper in `expeditionEngine`, for example `isPremiumEntitlementActive()`, that reads `window.BARK.services.premium.isPremium()` and defaults false.
- Update `isExpeditionPremiumUnlocked()` to use entitlement, not Firebase current user.
- Split prompt handling if needed:
  - signed out: sign-in prompt.
  - signed-in free: upgrade/paywall prompt or premium notice.
- Ensure `flyToActiveTrail()` checks entitlement before clicking `#toggle-virtual-trail`, or relies on a click guard that reliably blocks and surfaces the right prompt.
- Keep trail history/profile rendering untouched unless there is a separate product decision.

### 4C.6B Global Search UI

Likely runtime files:

- `modules/searchEngine.js`

Likely test/docs files:

- New or expanded Playwright global-search smoke.
- Phase 4 docs.

Suggested implementation shape:

- Change `isPremiumGlobalSearchUnlocked()` to read `premiumService.isPremium()` and default false.
- Add a helper that distinguishes signed-out vs signed-in free for copy:
  - auth missing -> sign-in copy.
  - auth present but premium false -> upgrade/premium copy.
- Update inline planner global search UI copy and alert.
- Update main search global/federated UI copy and alert.
- Ensure every UI path that calls `executeGeocode(...)` checks entitlement first.
- Do not touch `services/orsService.js` or `functions/index.js` in this UI-only slice.

## 5. Tests Needed

### 4C.6A Trail Tests

Future tests should cover:

- Signed-out trail buttons remain disabled/locked and do not activate overlays.
- Signed-in free trail buttons remain disabled or click-blocked.
- Signed-in free forced click/manual DOM enable still does not activate overlays.
- Premium/manual override trail buttons are enabled.
- Premium/manual override can toggle active/completed trail controls when trail layers are available.
- `window.flyToActiveTrail()` cannot bypass entitlement for signed-in free users.
- User-owned profile/expedition data still renders.
- Account switch from premium to free resets trail control state.
- Existing `npm run test:e2e:premium`, `npm run test:e2e:entitlement`, and `npm run test:e2e:smoke` still pass.

### 4C.6B Global Search Tests

Future tests should cover:

- Signed-out user sees sign-in prompt/copy for global search.
- Signed-in free user sees upgrade/paywall prompt/copy for global search.
- Signed-in free user does not reach `executeGeocode(...)` through UI global search.
- Premium/manual override user can reach the intended global search UI path.
- Test should stub/spy the ORS client if needed to avoid spending real ORS quota.
- No test should claim backend enforcement exists until `functions/index.js` rejects free users server-side.
- Full smoke bundle still passes.

## 6. Risks

- DOM enabled but click guard blocks, producing confusing UI.
- DOM locked but a direct click/function path still activates trail overlays.
- `flyToActiveTrail()` bypassing the visible trail button state.
- Signed-in free users still reaching `getPremiumGeocode` through a global search path.
- UI global search tests accidentally spending ORS quota.
- Sign-in prompt shown to signed-in free users instead of upgrade prompt.
- Accidentally paywalling expedition history/profile progress instead of only overlay controls.
- Account-switch stale premium state leaving trail/global-search UI temporarily enabled.
- Backend ORS callables remaining auth-only after UI gating creates a false sense of protection.

## 7. Stop Lines

- Do not touch ORS backend callables in 4C.6.
- Do not change Firebase rules in 4C.6.
- Do not add payment provider work.
- Do not add payment buttons.
- Do not collect money.
- Do not gate premium clustering.
- Do not change offline mode.
- Do not change entitlement writes.
- Do not hide user-owned expedition/profile data without explicit product approval.
- Do not deploy.
- Do not claim ORS/geocode is secure until backend entitlement enforcement exists.

## 8. PR Breakdown

### 4C.6A - Trail Button Entitlement Gating

Scope:

- `#toggle-virtual-trail`
- `#toggle-completed-trails`
- `expeditionEngine` click guards
- `flyToActiveTrail()` bypass guard if needed
- trail-specific Playwright coverage

Expected files:

- `services/authPremiumUi.js`
- `services/authService.js`
- `modules/expeditionEngine.js`
- premium/entitlement/trail smoke tests
- docs

Implementation status:

- Phase 4C.6A is implemented.
- `services/authService.js` now passes effective premium entitlement state to `authPremiumUi` for trail controls instead of signed-in auth state.
- `services/authPremiumUi.js` keeps trail button DOM state tied to the premium gating state: signed-out/free users are disabled with `aria-disabled="true"` and active state removed; premium/manual override users are enabled with `aria-disabled="false"`.
- `modules/expeditionEngine.js` now uses `premiumService.isPremium()` for `isExpeditionPremiumUnlocked()` instead of merely checking `firebase.auth().currentUser`.
- Trail click guards for active/completed trail overlays now block signed-in free users.
- `window.flyToActiveTrail()` now checks premium entitlement before trying to click `#toggle-virtual-trail`, so it cannot bypass the same gate.
- `tests/playwright/phase3a-premium-gating-smoke.spec.js` now expects signed-in free users to keep trail buttons locked.
- `tests/playwright/phase4c-premium-entitlement-smoke.spec.js` now verifies free trail buttons are locked, a forced free-user virtual-trail click does not activate the button, premium/manual override trail buttons are enabled, and premium virtual-trail toggling is covered when map/Leaflet are ready.
- Verification passed: `node --check services/authPremiumUi.js services/authService.js modules/expeditionEngine.js`.
- Verification passed: `node --check tests/playwright/phase4c-premium-entitlement-smoke.spec.js tests/playwright/phase3a-premium-gating-smoke.spec.js`.
- Verification passed: `npm run test:e2e:entitlement`, 2 passed.
- Verification passed: `npm run test:e2e:premium`, 2 passed.
- Verification passed: `npm run test:e2e:smoke`, 9 passed.
- No global search, ORS callable, Firebase rules, offline mode, premium clustering, payment provider, payment button, entitlement write, user-owned expedition history hiding, or deployment changes were made.

### 4C.6B - Global Search UI Entitlement Gating

Scope:

- `isPremiumGlobalSearchUnlocked()`
- inline planner global-search button/copy
- main search global/federated button/copy
- UI guard before `executeGeocode(...)`
- global-search UI tests with ORS stubbing/spying as needed

Expected files:

- `modules/searchEngine.js`
- global-search Playwright smoke tests
- docs

Implementation status:

- Phase 4C.6B is implemented.
- `modules/searchEngine.js` now uses `premiumService.isPremium()` for `isPremiumGlobalSearchUnlocked()` instead of Firebase current user.
- Signed-out users see sign-in-oriented global search copy/prompt.
- Signed-in free users see upgrade/premium global search copy/prompt and do not intentionally reach the UI geocode path.
- Premium/manual override users can use the global search UI path.
- Main search federated/global search and inline planner global search now re-check entitlement before calling `executeGeocode(...)`.
- `executeGeocode(...)` now fail-closes before ORS geocode for non-premium users, while leaving the local GPS "my location/current location" path alone.
- `tests/playwright/phase4c-global-search-entitlement-smoke.spec.js` covers signed-out locked, signed-in free locked/no ORS call, and premium/manual override allowed with a stubbed `window.BARK.services.ors.geocode`.
- Added npm script `test:e2e:global-search`.
- Verification passed: `node --check modules/searchEngine.js`.
- Verification passed: `node --check tests/playwright/phase4c-global-search-entitlement-smoke.spec.js`.
- Verification passed: `npm run test:e2e:global-search`, 3 passed.
- Verification passed: `npm run test:e2e:entitlement`, 2 passed.
- Verification passed: `npm run test:e2e:premium`, 2 passed.
- Verification passed: `npm run test:e2e:smoke`, 9 passed.
- No ORS backend callable, `services/orsService.js`, `functions/index.js`, Firebase rules, trip route generation, payment provider, payment button, offline mode, premium clustering, entitlement write, or deployment changes were made.

### 4C.7 - Firestore Rules Tests

Scope:

- protect entitlement/provider/admin fields from client writes.
- add rules emulator tests.

### 4C.8 - ORS Backend Callable Enforcement

Scope:

- server-side entitlement enforcement for `getPremiumRoute` and `getPremiumGeocode`.
- callable/function tests for free vs premium users.

## Final Recommendation

Recommended scope:

- Implement **4C.6A trail button entitlement gating first**.
- Defer global search UI to **4C.6B** because it is adjacent to ORS geocode quota and should have isolated tests that prove free users do not reach the UI geocode path.

Surfaces to include in 4C.6A:

- `#toggle-virtual-trail`
- `#toggle-completed-trails`
- `expeditionEngine.isExpeditionPremiumUnlocked()`
- trail click guards
- `flyToActiveTrail()` bypass behavior if needed

Surfaces to defer:

- global search UI/check guard
- ORS `getPremiumRoute` / `getPremiumGeocode`
- Firebase rules
- premium clustering/bubble mode
- offline mode
- payment provider/buttons

Phase 4C.6A status:

Complete. The trail button DOM state, expedition click guards, and `flyToActiveTrail()` bypass guard now use premium entitlement state, and focused Playwright coverage passed.

Phase 4C.6B status:

Complete. Global search UI and client check guards now use premium entitlement state, and focused Playwright coverage passed with ORS/geocode stubbed.

Ready for 4C.7 / 4C.8?

YES, after this slice is reviewed, for Firestore rules tests and ORS backend callable entitlement enforcement planning/implementation. Do not add payment provider work, payment buttons, premium clustering, offline mode, or deployment yet.
