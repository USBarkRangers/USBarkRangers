# Fast Fix Plan Toward Release Candidate

Date: 2026-05-09
Goal: fix the highest-risk launch issues quickly without rewriting the app.
Important sequencing: **keep Lemon Squeezy in test mode until the final release-candidate switch. DO NOT TAKE OUT UNTIL CARTER APPROVES.**

## Guiding Strategy

Move in small, verifiable slices:

1. Protect cost and abuse first.
2. Fix product integrity next.
3. Harden entitlement logic while still in Lemon Squeezy test mode.
4. Run full QA with free/premium storage states.
5. Set final budget alerts and monitoring destinations.
6. Switch Lemon Squeezy live mode last, test one real transaction, then tag the release candidate.

## Day 1: Launch Safety and Cheap Wins

### 1. Add feature flags / kill switches

- Files: `modules/barkState.js`, `modules/profileEngine.js`, `services/orsService.js`, `modules/paywallController.js`
- Change:
  - Add a small static config object for launch flags:
    - `leaderboardEnabled`
    - `leaderboardLoadMoreEnabled`
    - `routeGenerationEnabled`
    - `globalGeocodeEnabled`
    - `checkoutEnabled`
  - Default all existing behavior to enabled in dev/test.
  - Make disabled UI fail closed with clear copy.
- Test:
  - Toggle each flag locally and verify the feature disables without throwing.
  - Run targeted Playwright smoke for leaderboard, route gating, paywall.
- Done when:
  - A launch issue can be stopped without code surgery.

### 2. Fix the known product-rules E2E failure

- Files: `tests/playwright/bug017-product-rules-audit-smoke.spec.js`, likely `modules/paywallController.js` or feature-source copy
- Change:
  - Determine whether the failure is just copy drift or wrong paywall source.
  - If copy drift, update the test to accept the intended Premium trail copy.
  - If source bug, make global/map filter/trail controls report the right paywall source.
- Test:
  - `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/bug017-product-rules-audit-smoke.spec.js --workers=1 --reporter=list`
- Done when:
  - Free cannot bypass premium controls and the test passes.

## Day 2: Product Integrity

### 3. Enforce the free 5 visited-place limit

- Completed 2026-05-09:
  - Lowered the free tracked-visit cap to 5.
  - Added Firestore rules constraints that deny non-premium direct `visitedPlaces` writes above 5 without adding rules reads.
  - Kept premium users with active, manual-active, past-due, or cancelled-active entitlement able to exceed 5.
  - Preserved cleanup behavior for legacy/expired over-limit users: unrelated settings updates still work, add/swap writes are denied, and one-at-a-time removals are allowed.
- Files:
  - `services/checkinService.js`
  - `renderers/panelRenderer.js`
  - `firestore.rules`
  - `tests/rules/firestore-entitlement.rules.test.js`
  - `tests/playwright/bug015-free-visited-limit-smoke.spec.js`
- Test:
  - Free user can add 5.
  - Free user cannot add 6.
  - Free user can unmark/delete at limit.
  - Premium user can exceed 5.
  - Fake local premium/localStorage does not bypass.
  - `npm run test:rules` passed 21/21.
  - Follow-up QC passed 24/24 after adding legacy 20 -> 19 removal, over-limit swap denial, expired-user lock, and past-due/cancelled-active rules coverage.
- Done when:
  - Direct client Firestore write cannot bypass the free tier. Completed for the 5-visit free cap.

### 4. Stop leaderboard score spoofing

- Fast path:
  - Make `leaderboard/{uid}` server-written only.
  - Add callable or function path to derive `totalPoints` and `totalVisited` from trusted user data.
- Files:
  - `modules/profileEngine.js`
  - `functions/index.js`
  - `firestore.rules`
  - `tests/rules/firestore-entitlement.rules.test.js`
- Test:
  - Direct write to own leaderboard doc with fake score is denied.
  - Legitimate score sync still updates through server path.
- Done when:
  - A user cannot set themselves to #1 from DevTools.

## Day 3: Payment Logic While Still in Test Mode

### 5. Harden webhook idempotency and ordering

- Files:
  - `functions/index.js`
  - `functions/tests/lemonsqueezy-webhook.test.js`
  - `firestore.rules`
- Change:
  - Add server-only `paymentEvents/{eventId}` or `users/{uid}/paymentEvents/{eventId}`.
  - Process webhook in a transaction where possible.
  - Store provider event id, event name, provider status, event time, received time, and applied entitlement state.
  - Ignore duplicate events.
  - Reject older events that would regress a newer known state, except explicit refund/chargeback policy events.
- Test:
  - Duplicate active event writes once.
  - Old cancelled after newer active renewal does not downgrade.
  - Refund after active removes access.
  - Manual override is preserved.
- Done when:
  - Webhook order can be reasoned about from persisted event records.

### 6. Align subscription states

- Files:
  - `functions/index.js`
  - `services/premiumService.js`
  - `services/authAccountUi.js`
  - `modules/paywallController.js`
- Change:
  - Use explicit statuses:
    - `active`
    - `on_trial`
    - `past_due`
    - `unpaid`
    - `cancelled_active`
    - `expired`
    - `refunded`
    - `manual_active`
  - Preserve Premium for Lemon Squeezy statuses apart from expired/refunded/chargeback policy decisions.
  - Show billing UI text that matches the state.
- Test:
  - Unit fixtures for every webhook state.
  - UI smoke for active, expired, past due, cancelled active, refunded.
- Done when:
  - A cancelled user keeps access until `ends_at`; a refunded user loses access immediately; a past-due user is not surprised during retry grace.

## Day 4: QA Closure

### 7. Create and run full E2E storage states - complete

- Files:
  - Playwright auth storage files under `playwright/.auth/` or `node_modules/.cache/bark-e2e/`
- Change:
  - Create free user storage state.
  - Create premium/manual-override user storage state.
  - Create second free user for account switch tests.
- Test:
  - `npm run test:e2e:smoke`
  - `npm run test:e2e:premium`
  - `npm run test:e2e:account-switch`
  - `npm run test:e2e:profile-manage`
  - targeted mobile viewport smoke if available.
- Done when:
  - No launch-critical tests are skipped.
  - Completed 2026-05-09: local ignored storage states exist for free, premium/test entitlement, and second free account; full signed-in smoke passed 40/40 against `http://localhost:4173/index.html`.

### Completed: Server-side route/geocode rate limits

- Files:
  - `functions/index.js`
  - `functions/tests/ors-entitlement.test.js`
- Change:
  - Added per-user Firestore transaction counters for `getPremiumRoute` and `getPremiumGeocode`.
  - Defaults are 30 route generations/hour and 120 geocode searches/hour, with env overrides.
- Test:
  - `npm --prefix functions test` passed 75/75.
  - Over-limit tests prove calls stop before entitlement reads and ORS network calls.

### 8. Final pre-RC budget alerts and monitoring checklist

- Google Cloud/Firebase console:
  - Budget alerts at $1, $5, $10, $25, $50/day projected burn and $50/$100 monthly actual.
  - Firestore reads/writes/deletes dashboard.
  - Function error alerts for checkout, webhook, route, geocode.
  - Log alerts for webhook failure and entitlement downgrade.
- Done when:
  - There is a named person and alert destination for cost/payment incidents.
  - This is treated as a final pre-RC guardrail, not the next code task.

## Final RC Step: Lemon Squeezy Live Switch

Only do this after Days 1-4 are done.

Owner approval lock: **DO NOT TAKE OUT UNTIL CARTER APPROVES.** Keep Lemon Squeezy in test mode as long as possible. When Carter approves the live-mode switch, beta testers should be routed through real paid Lemon Squeezy checkout.

- Files:
  - `functions/index.js`
  - `functions/tests/checkout-session.test.js`
  - `functions/tests/lemonsqueezy-webhook.test.js`
  - deploy config/secrets
- Change:
  - Make live/test mode configurable.
  - Keep dev/beta on test mode.
  - Use live API key/store/variant only for release candidate.
  - Ensure live webhook accepts `test_mode:false` only in live mode.
- Test:
  - Unit tests for both modes.
  - One real low-price or refunded transaction.
  - Confirm entitlement appears on the same Firebase account.
  - Cancel and confirm access remains until period end.
  - Refund and confirm Premium is removed.
- Done when:
  - Paid live checkout, webhook, entitlement, portal, cancellation, and refund are verified end to end.

## Recommended Fix Order

1. Kill switches / feature flags. This is next.
2. Product-rules E2E failure.
3. Free 5-visit server enforcement.
4. Server-derived leaderboard scoring.
5. Webhook idempotency/ordering while still in Lemon Squeezy test mode.
6. Subscription state alignment while still in Lemon Squeezy test mode.
7. Full free/premium/account-switch E2E.
8. Final pre-RC budget alerts and monitoring destinations.
9. Final owner-approved Lemon Squeezy live-mode RC switch.

## Watchlist, Not Next

- Leaderboard exact-rank cache: the main leaderboard pagination is already good. Only add this if monitoring shows repeated rank lookup cost or latency; keep the current user-visible See More behavior.

## Do Not Spend Time On Yet

- Rewriting the whole app state system.
- Moving public park data into Firestore.
- Perfecting deep analytics before the first small beta.
- Over-optimizing Firestore storage cost.
- Live Lemon Squeezy mode before the rest of the RC checklist is green.
