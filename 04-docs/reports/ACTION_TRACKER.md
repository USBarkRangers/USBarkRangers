# BARK Ranger Map Launch Action Tracker

Date: 2026-05-15
Scope: launch-readiness blockers and follow-up tasks from `plans/LAUNCH_READINESS_FIREBASE_COST_REPORT.md`.
Status note: updated after Carter confirmed budget/monitoring is done, legal/business review is still pending, and no current red flags were seen for app integrity items.

## P0 - Must Fix Before Paid/Public Launch

- [x] **NEXT: add emergency kill switches / feature flags**
  - Files: `modules/launchFlags.js`, `modules/barkState.js`, `modules/profileEngine.js`, `services/orsService.js`, `modules/paywallController.js`, `engines/tripPlannerCore.js`, `modules/searchEngine.js`, `services/authPremiumUi.js`, `modules/uiController.js`, `functions/index.js`, `functions/tests/ors-entitlement.test.js`, `functions/tests/checkout-session.test.js`
  - Exact change: add launch flags for leaderboard load-more, route planner/generation, global geocode, checkout, feedback, and premium risky tools; add server-side function flags for `getPremiumRoute`, `getPremiumGeocode`, and `createCheckoutSession`; disabled features fail closed with clear copy.
  - Why it matters: this gives you fast control if a beta feature misbehaves, without needing the Lemon Squeezy live switch or a large refactor first.
  - How to test: flip each switch locally and verify the affected feature is unavailable while the rest of the app still works. Completed: staged function tests passed 71/71; focused Playwright passed 4 runnable tests with 4 expected storage-state skips; browser flag smoke passed.
  - Expected cost/risk reduction: caps route/geocode/leaderboard/checkout incidents quickly; turns launch surprises into reversible settings.

- [x] **Fix the known product-rules E2E failure**
  - Files: `tests/playwright/bug017-product-rules-audit-smoke.spec.js`, likely `modules/paywallController.js` or feature-source copy
  - Exact change: confirmed the failure was intended copy drift after the test clicked trail controls last; updated the assertion to accept the valid `Virtual trail tracking` premium paywall source.
  - Why it matters: this is the one confirmed smoke failure touching premium gating behavior.
  - How to test: run `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/bug017-product-rules-audit-smoke.spec.js --workers=1 --reporter=list`. Completed: targeted smoke passed 2/2 against a local static server with free/premium storage states available.
  - Expected cost/risk reduction: reduces paid-beta UX/regression risk; no direct Firestore cost impact.

- [x] **Set up full signed-in E2E storage states and run skipped smoke**
  - Files: ignored local storage states at `playwright/.auth/free-user.json`, `playwright/.auth/premium-user.json`, `playwright/.auth/free-user-b.json`; `tests/playwright/bug016-route-generation-gating-smoke.spec.js`; `HARDENING_PROGRESS.md`
  - Exact change: validated the three ignored storage-state files and made the premium route-generation smoke explicitly continue past the long-route warning so it reaches the stubbed ORS path deterministically.
  - Why it matters: auth, account switching, route gating, settings, profile/manage, and premium/free flows now run instead of skipping.
  - How to test: run the full smoke with `BARK_E2E_BASE_URL`, `BARK_E2E_STORAGE_STATE`, `BARK_E2E_STORAGE_STATE_B`, and `BARK_E2E_PREMIUM_STORAGE_STATE` pointing at the local `.auth` files. Completed: focused route-gating rerun passed 2/2; full signed-in smoke passed 40/40.
  - Expected cost/risk reduction: no Firestore cost reduction; materially lowers paid-beta regression risk by proving signed-in flows against real Firebase Auth storage states.

- [x] **Enforce free 5 visited-place limit outside the client**
  - Files: `services/checkinService.js`, `renderers/panelRenderer.js`, `firestore.rules`, `tests/rules/firestore-entitlement.rules.test.js`, `tests/playwright/bug015-free-visited-limit-smoke.spec.js`
  - Exact change: lowered the free tracked-visit cap to 5 and added Firestore rules constraints that reject non-premium direct `visitedPlaces` writes above 5.
  - Why it matters: the free limit can no longer be bypassed by direct Firestore writes with a user auth token.
  - How to test: free user can create 5, cannot create 6, can delete/unmark, premium can exceed 5, spoofed local premium fails. Completed: rules tests passed 21/21.
  - Expected cost/risk reduction: limits worst-case free-user write/storage growth; prevents product-tier bypass.

- [x] **Stop client-authoritative leaderboard scoring**
  - Files: `modules/profileEngine.js`, `functions/index.js`, `firestore.rules`, `tests/rules/firestore-entitlement.rules.test.js`
  - Exact change: `leaderboard/{uid}` is server-written only in Firestore rules, and the app syncs scores through the `syncLeaderboardScore` callable, which derives totals from trusted user data before writing the leaderboard document.
  - Why it matters: users should not be able to write fake `totalPoints` and `totalVisited` directly to their own leaderboard doc.
  - How to test: malicious client write of `totalPoints: 999999` is denied; legitimate score sync still updates via server. Final RC should rerun rules/functions tests before deploy.
  - Expected cost/risk reduction: abuse/integrity risk reduced; minor function/read cost added for trusted score updates.

- [x] **Add durable Lemon Squeezy webhook idempotency and ordering**
  - Files: `functions/index.js`, `functions/tests/lemonsqueezy-webhook.test.js`, `HARDENING_PROGRESS.md`
  - Exact change: process entitlement webhooks in a transaction, write provider receipts to `_lemonSqueezyWebhookEvents/{sha256(providerEventId)}`, and ignore exact duplicates plus stale/out-of-order events.
  - Why it matters: `lastProviderEventId` alone did not block replay/out-of-order different events.
  - How tested: `node --test functions/tests/lemonsqueezy-webhook.test.js` passed 47/47; `npm --prefix functions test` passed 81/81.
  - Expected cost/risk reduction: tiny extra read/write per webhook; major reduction in entitlement corruption and support incidents.

- [x] **Final pre-RC: set launch budget alerts and monitoring destinations**
  - Files: Firebase/Google Cloud console, launch dashboard notes
  - Exact change: configure billing alerts and named notification destinations after the app-side safety switches are in place and before the final paid release candidate.
  - Why it matters: budget alerts are a final launch guardrail, not the next code task. They should be live before a paid/public push, especially before asking admins to promote.
  - How tested: Carter confirmed this is done on 2026-05-15. Keep the alert recipients and response path documented outside the public app bundle.
  - Expected cost/risk reduction: early warning for unusual spend; no app UX impact.

- [ ] **ABSOLUTE FINAL RC SWITCH: make Lemon Squeezy live/test mode configurable**
  - Files: `functions/index.js`, `functions/tests/checkout-session.test.js`, `functions/tests/lemonsqueezy-webhook.test.js`
  - Exact change: replace hard-coded `test_mode: true` and hard-coded webhook rejection of live-mode events with an environment/config switch; use live API key/store/variant only in live mode.
  - Why it matters: current code is intentionally test-mode-only and should stay that way during fast pre-RC fixes. This is the last controlled release-candidate switch before paid/public launch.
  - Owner approval note: **DO NOT TAKE OUT UNTIL CARTER APPROVES.** Keep Lemon Squeezy test mode on as long as possible. When Carter approves removing test mode for the release candidate, beta testers will go through real paid Lemon Squeezy checkout.
  - How to test: unit tests for test mode and live mode checkout payloads; live-mode webhook fixture should update entitlement when configured live; test-mode fixture should be ignored when configured live; run one real low-price or refunded transaction.
  - Expected cost/risk reduction: payment launch-blocker removed; prevents users paying but not receiving Premium.
  - Sequencing note: do after visit-limit enforcement, leaderboard integrity, webhook ordering, kill switches, final budget alerts, legal/business review, and full QA storage-state runs.

## P1 - Must Fix Before Broader Paid Beta

- [x] **Align `past_due`, `cancelled`, `expired`, and `refunded` entitlement states with provider lifecycle**
  - Files: `functions/index.js`, `services/premiumService.js`, `services/authAccountUi.js`, `modules/paywallController.js`, webhook tests
  - Exact change: represent cancelled-but-active, past_due grace, expired, refunded, and manual states explicitly; preserve Premium for `active`, `manual_active`, `past_due`, and `cancelled_active`.
  - Why it matters: Lemon Squeezy docs recommend access in all statuses apart from expired; current payment-failed mapping removes Premium immediately.
  - How tested: webhook fixtures for active, cancelled future `ends_at`, expired, payment failed/past_due/unpaid, recovered, refunded, duplicate, stale, and manual override all passed.
  - Expected cost/risk reduction: major support/user-anger reduction; no material Firestore cost change.

- [ ] **Consolidate duplicate user document listeners or split visited data**
  - Files: `services/authService.js`, `repos/VaultRepo.js`, `services/firebaseService.js`
  - Exact change: use one user-doc listener for both entitlement/settings and visited data, or move `visitedPlaces` to `users/{uid}/visitedPlaces/{parkId}` with scoped listeners/queries.
  - Why it matters: two listeners on `users/{uid}` double initial and update listener reads.
  - How to test: auth sign-in creates one active user-doc subscription; mark visited causes one listener update path.
  - Expected cost/risk reduction: signed-in user-doc listener reads reduced up to ~50% for user-doc updates.

- [x] **Fix feedback submission rules or route through a callable**
  - Files: `modules/uiController.js`, `firestore.rules`, rules tests, optional `functions/index.js`
  - Exact change: feedback is routed through the authenticated `submitFeedback` callable with server-side cleanup and rate limiting; direct client writes to `feedback` remain denied by Firestore rules.
  - Why it matters: feedback can succeed through the intended server path without opening a broad client-write collection.
  - How to test: signed-in feedback succeeds through callable; direct Firestore writes, malicious extra fields, and huge text are denied/rejected. Final RC should rerun rules/functions tests before deploy.
  - Expected cost/risk reduction: support channel works; low cost, prevents noisy client errors.

- [x] **Add route/geocode per-user rate limits**
  - Files: `functions/index.js`, `functions/tests/ors-entitlement.test.js`
  - Exact change: added per-user Firestore transaction counters for `getPremiumRoute` and `getPremiumGeocode`; defaults are 30 route generations/hour and 120 geocode searches/hour, configurable through environment variables; over-limit calls return `resource-exhausted` with retry guidance.
  - Why it matters: premium route generation can be spammed and each callable performs entitlement read plus external ORS calls.
  - How to test: within limit succeeds; over limit fails before entitlement reads or ORS calls; counters reset by window. Completed: function tests passed 75/75.
  - Expected cost/risk reduction: caps Firestore entitlement reads and outbound/API usage under abuse after the first limit-window counter read.

## P2 - Can Fix During/After Private Beta

- [ ] **Watchlist only: cache leaderboard exact-rank aggregation without changing normal UX**
  - Files: `modules/profileEngine.js`, optional `functions/index.js`
  - Exact change: only if monitoring shows repeated rank lookup cost/latency, cache exact rank per user/session with TTL; do not change the existing cursor-based See More behavior.
  - Why it matters: the main leaderboard is already good and cursor-paginated. This is a hidden-cost polish task, not a launch blocker.
  - How to test: instrument calls; repeated See More should fetch only 5 docs and not repeat exact rank until TTL expires.
  - Expected cost/risk reduction: repeated exact-rank aggregation reduced under stress clicking; normal users should see no negative UX change.

- [ ] **Use scheduled `system/leaderboardData` top-100 cache in frontend**
  - Files: `functions/index.js`, `modules/profileEngine.js`, `firestore.rules`
  - Exact change: load public top 50/100 from `system/leaderboardData` first; only query live leaderboard on manual refresh or premium deep browse.
  - Why it matters: a single cached doc is cheaper than repeated public leaderboard queries at group scale.
  - How to test: signed-out boot reads one system doc; manual refresh uses live query.
  - Expected cost/risk reduction: signed-out initial leaderboard read drops from 5 docs/user to 1 doc/user.

- [ ] **Add Firestore rules tests for leaderboard abuse, achievements abuse, visit limit, and feedback**
  - Files: `tests/rules/firestore-entitlement.rules.test.js`, `firestore.rules`
  - Exact change: add malicious test cases that currently expose gaps, then make them pass with rule/server changes.
  - Why it matters: current tests protect entitlement well but do not prove product integrity.
  - How to test: `npm run test:rules`.
  - Expected cost/risk reduction: prevents regressions; no direct cost reduction.

- [ ] **Add launch analytics counters**
  - Files: app analytics setup files if present, `modules/paywallController.js`, `modules/profileEngine.js`, `services/checkinService.js`, `services/orsService.js`
  - Exact change: track checkout starts/completes, leaderboard loads, See More clicks, visited writes, route generations, premium state changes, and feature errors.
  - Why it matters: without telemetry, launch issues will be anecdotal.
  - How to test: debug analytics stream shows expected events for key flows.
  - Expected cost/risk reduction: faster incident diagnosis; indirect cost reduction.
