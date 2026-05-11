# BARK Ranger Map Codebase Cleanup Roadmap

Date: 2026-05-09
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1c6587a41371fb1b95c48392970189d1ac0782cf`

## Guiding Principle

Do not rewrite the app before private beta. The codebase is tangled but usable. The safest roadmap is controlled cleanup around tested boundaries, not architecture theater.

## Stage A: Before 5-10 Private Testers

Goal: ship the hardened branch safely and prove the real tester paths.

Required:

1. Deploy one matching commit for Hosting, Functions, and Firestore rules.
2. Run the private beta test gate:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:functions:emulator
BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/bark-app-identity-smoke.spec.js tests/playwright/bug004-static-fallback-data-smoke.spec.js tests/playwright/lemon-coupon-checkout-smoke.spec.js tests/playwright/stage0-launch-flags-smoke.spec.js --workers=1 --reporter=list
```

3. Verify on the deployed URL:
   - public map loads,
   - local search works,
   - Premium modal has no app-side code box and sends users to Lemon checkout for coupons,
   - free account stops at 5 visits,
   - Premium/legacy access-code account can exceed 5,
   - saved routes are Premium-only,
   - checkout still uses Lemon test mode,
   - feature flags can disable route/geocode/checkout.

4. Create a short tester support checklist:
   - device/browser,
   - signed-in email,
   - UID if available,
   - action attempted,
   - screenshot,
   - entitlement status,
   - visit count.

Do not do before Stage A:

- Do not split `functions/index.js`.
- Do not migrate `visitedPlaces`.
- Do not replace `window.BARK`.
- Do not redesign map/trip/profile UI.

## Stage B: Before 25-50 Testers

Goal: make support and beta operations less fragile.

Recommended work:

1. Write an operator runbook for launch flags and backend env flags.
   - Files involved: `modules/barkState.js`, `modules/launchFlags.js`, `functions/index.js`.
   - Output: exact flag names, default behavior, disabled messages, redeploy/reload notes.

2. Make signed-in Playwright state generation part of release prep.
   - Files involved: `scripts/save-playwright-storage-state.js`, `tests/playwright/*`.
   - Output: one checklist with free, premium/test, and second-account states.

3. Decide feedback/support behavior.
   - Option A: keep feedback disabled and put support email in beta instructions.
   - Option B: add a callable-backed feedback path with rate limit.

4. Add a production debug checklist.
   - Include Firebase Auth UID, `users/{uid}.entitlement`, `visitedPlaces.length`, saved routes, function logs, flags, and webhook events.

5. Document Firestore query/index assumptions.
   - Leaderboard: `orderBy(totalPoints desc).limit(n).startAfter(...)`.
   - Saved routes: `users/{uid}/savedRoutes.orderBy(createdAt desc)`.
   - Access codes/rate limits/webhook events: server-only.

## Stage C: Before Paid Launch

Goal: reduce the risk of paid-user bugs and future payment changes.

Recommended work:

1. Split `functions/index.js` after tests are green.
   - First split should be mechanical, not behavioral.
   - Suggested modules:
     - `payments/checkout`
     - `payments/webhook`
     - `legacyAccessCodes`
     - `entitlement`
     - `ors`
     - `leaderboard`
     - `adminData`

2. Add an entitlement matrix fixture.
   - One table of states: free, active Lemon, past_due, cancelled_active, expired, refunded, access_code_active, access_code_expired.
   - Use it in Functions tests and client UI tests.

3. Reduce `authService.js` blast radius.
   - Extract named helpers for user-doc snapshot hydration: entitlement, settings, admin, walk/expedition, leaderboard boot.
   - Keep the listener behavior unchanged during the first pass.

4. Decide leaderboard trust policy.
   - If cosmetic: say so in product copy/docs.
   - If competitive: server-derive/cap walk and achievement inputs.

5. Add monitoring/budget/incident runbooks.
   - Budget alerts.
   - Function error alerts.
   - Webhook failure/ignored-event alerts.
   - ORS rate-limit/kill-switch response.

6. Complete legal/data/brand diligence.
   - Do not move to paid public launch while trademark/data-source/payment ownership questions are unresolved.

7. Lemon live-mode RC switch remains last.
   - Keep `attributes.test_mode: true`.
   - Do not remove the Carter approval lock until Carter explicitly approves final RC.

## Stage D: Post-Launch Refactor

Goal: make the codebase easier to grow after the first real learning cycle.

Recommended work:

1. Consider ES modules or a lightweight build step.
   - Keep `window.BARK` compatibility until migrated.
   - Add a boot contract before changing script order.

2. Split `styles.css`.
   - Suggested files: `base`, `map`, `account`, `paywall`, `profile`, `trip`, `mobile`.

3. Move premium-heavy `visitedPlaces` to a subcollection only if usage proves it.
   - Keep current embedded array for beta because it is simple and tested.

4. Replace inline HTML templates gradually.
   - Start with user-controlled strings in saved routes, trip stops, profile/achievements, and share cards.

5. Consolidate duplicate listeners.
   - Either one `users/{uid}` listener fans out to services or visits move to `users/{uid}/visitedPlaces/{placeId}`.

6. Create a small internal dev guide.
   - Where to add UI.
   - Where to add Functions.
   - How Premium entitlement works.
   - How to run tests.
   - What not to touch casually.

## Roadmap Summary

| Stage | Color | Main Theme |
|---|---|---|
| Stage A | Do now | Deploy/test the hardened branch without changing architecture. |
| Stage B | Soon | Make beta operations and support repeatable. |
| Stage C | Before paid launch | Isolate payment/backend complexity and add monitoring/legal readiness. |
| Stage D | After launch | Gradual code health cleanup, no big-bang rewrite. |

Final recommendation: **ship small, test hard, refactor after evidence.**
