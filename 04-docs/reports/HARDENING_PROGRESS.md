# BARK Ranger Map Hardening Progress

Date: 2026-05-09

Scope: Stage 0 hardening only. Lemon Squeezy remains intentionally locked in test mode until Carter explicitly approves the final RC switch.

## Merge Review

- Branch reviewed: `codex/stage-0-hardening-kill-switches`.
- Stage 0 commit merged into `main`: `1ba1afc stage 0 hardening kill switches`.
- Merge method: fast-forward from `origin/main`; no merge conflicts.
- Review result: no merge blockers found. The branch keeps Lemon Squeezy test mode locked, leaves normal leaderboard pagination unchanged, and adds app/server kill switches for the intended Stage 0 surfaces.
- Local unrelated edits were stashed before the merge so they were not included in the Stage 0 merge.

## Files Changed

- `modules/launchFlags.js`
  - Added app-side launch safety switches.
- `index.html`
  - Loads launch flags before `barkState.js`.
- `modules/barkState.js`
  - Added launch flag defaults, messages, session override helpers, and flag lookup helpers.
- `modules/paywallController.js`
  - Blocks checkout UI when `checkoutEnabled` is false.
- `services/orsService.js`
  - Blocks client route/geocode callable attempts when route/geocode/premium-risk flags are false.
- `engines/tripPlannerCore.js`
  - Shows a friendly paused state for route generation when route flags are false.
- `modules/searchEngine.js`
  - Shows friendly global-search paused copy and blocks premium geocode when flagged off.
- `modules/profileEngine.js`
  - Leaves the main leaderboard unchanged, but hides See More behind `leaderboardDeepBrowsingEnabled`.
- `services/authPremiumUi.js`
  - Locks premium map tools when `premiumRiskyToolsEnabled` is false.
- `modules/uiController.js`
  - Disables in-app feedback by default because Firestore rules likely deny `feedback` writes.
- `functions/index.js`
  - Adds server-side kill switches for `getPremiumRoute`, `getPremiumGeocode`, and `createCheckoutSession`.
- `functions/tests/ors-entitlement.test.js`
  - Adds disabled route/geocode assertions.
- `functions/tests/checkout-session.test.js`
  - Adds disabled checkout assertion.
- `BUDGET_ALERTS_CHECKLIST.md`
  - Adds the pre-expansion budget alert checklist.

## Tests Run

- `PATH="${BARK_NODE20_BIN:-$HOME/.nvm/versions/node/v20.20.2/bin}:$PATH" npm --prefix functions test`
  - Result: PASS, 71/71 against the staged Stage 0 scope.
  - Covered: server kill switches for `createCheckoutSession`, `getPremiumRoute`, and `getPremiumGeocode`; existing Lemon Squeezy test-mode checkout payload tests; webhook tests; ORS entitlement tests.
- `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/bark-app-identity-smoke.spec.js tests/playwright/account-auth-smoke.spec.js tests/playwright/bug016-route-generation-gating-smoke.spec.js tests/playwright/bug021-route-upgrade-prompt-smoke.spec.js --workers=1 --reporter=list`
  - Result: PASS for runnable tests, 4 passed / 4 skipped.
  - Passed: app identity smoke; signed-out account UI; account chooser smoke; profile card order smoke.
  - Skipped: signed-in route gating tests requiring `BARK_E2E_STORAGE_STATE` and `BARK_E2E_PREMIUM_STORAGE_STATE`.
- Browser flag smoke with Playwright against `http://localhost:4173/index.html`
  - Result: PASS.
  - Covered: default feedback paused state, checkout disabled UI via session flag, route generation disabled UI via session flag, no page errors.

## Remaining Stage 0 Risks

- App-side flags are static/browser-side guardrails. Server-side flags protect the expensive callables.
- Budget alerts still need to be configured in Google Cloud before expanding beta beyond the current 10 testers.
- Feedback is paused instead of fixed with a new Firestore rule/callable; this avoids denied writes during Stage 0 without expanding scope.
- Lemon Squeezy live mode was not changed.

## P1 Follow-Up Progress

- Fixed `tests/playwright/bug017-product-rules-audit-smoke.spec.js` by aligning the free-account forced-control assertion with the app's valid `Virtual trail tracking` paywall source.
- This was a test expectation drift, not a product-gating bug: the test clicked trail controls last, and the app correctly showed the trail-specific premium paywall.
- Targeted QC: `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/bug017-product-rules-audit-smoke.spec.js --workers=1 --reporter=list` passed 2/2 with a local static server.

## Signed-In E2E Storage State QC

- Validated ignored local storage states:
  - Free user: `playwright/.auth/free-user.json`
  - Premium/test entitlement user: `playwright/.auth/premium-user.json`
  - Second account for account switching: `playwright/.auth/free-user-b.json`
- Full signed-in smoke command:
  - `BARK_E2E_BASE_URL=http://localhost:4173/index.html BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json" BARK_E2E_STORAGE_STATE_B="$PWD/playwright/.auth/free-user-b.json" BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json" npm run test:e2e:smoke`
- First full run result: 39 passed, 1 failed. The failing premium route-generation smoke hit the app's long-route warning and timed out before reaching the stubbed ORS path.
- Test harness fix: `tests/playwright/bug016-route-generation-gating-smoke.spec.js` now stubs `window.BARK.confirmLongRouteWarning` to return `continue`, keeping product behavior unchanged while making the route gating smoke deterministic.
- Focused route-gating rerun: `bug016-route-generation-gating-smoke.spec.js` passed 2/2.
- Final full signed-in smoke rerun: `npm run test:e2e:smoke` passed 40/40 with `BARK_E2E_BASE_URL`, `BARK_E2E_STORAGE_STATE`, `BARK_E2E_STORAGE_STATE_B`, and `BARK_E2E_PREMIUM_STORAGE_STATE` set to the local ignored `.auth` files.

## Server Rate Limit Progress

- Added server-side per-user rate limits for premium ORS callables in `functions/index.js`.
- Defaults:
  - `getPremiumRoute`: 30 requests per hour.
  - `getPremiumGeocode`: 120 requests per hour.
- Optional env overrides:
  - `BARK_RATE_LIMIT_PREMIUM_ROUTE_MAX`
  - `BARK_RATE_LIMIT_PREMIUM_ROUTE_WINDOW_MS`
  - `BARK_RATE_LIMIT_PREMIUM_GEOCODE_MAX`
  - `BARK_RATE_LIMIT_PREMIUM_GEOCODE_WINDOW_MS`
- Rate limit order: kill switch, auth, rate limit, entitlement, payload validation, ORS. Over-limit calls stop before entitlement reads and ORS network calls.
- QC: `npm --prefix functions test` passed 75/75.

## Free Visit Limit Progress

- Lowered the free tracked-visit cap from 20 to 5 in `services/checkinService.js`.
- Updated user-facing fallback copy in `renderers/panelRenderer.js` and the BUG-015 Playwright smoke limit/test names.
- Added Firestore rules enforcement so non-premium direct writes to `users/{uid}.visitedPlaces` are denied above 5.
- Premium users with active, manual-active, past-due, or cancelled-active entitlement on the same user document can still write more than 5 visits.
- Rules preserve cleanup behavior: legacy or expired over-limit users can update unrelated settings and can remove visits one at a time, but cannot add visits or swap the over-limit list.
- QC: `npm run test:rules` passed 21/21.
- QC: `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/bug015-free-visited-limit-smoke.spec.js --workers=1 --reporter=list` passed 5/5.

## Payment Webhook Hardening Progress

- Lemon Squeezy remains hard-locked in test mode. The checkout payload still sends `attributes.test_mode: true`, and live-mode webhooks are still ignored until Carter explicitly approves the final RC switch.
- Added durable webhook receipt storage at `_lemonSqueezyWebhookEvents/{sha256(providerEventId)}`.
- Webhook processing now runs in a Firestore transaction:
  - reads the processed-event receipt first,
  - ignores exact duplicate deliveries without rereading or rewriting the user doc,
  - reads the user entitlement,
  - writes either the entitlement update plus processed receipt, or an ignored receipt for manual overrides/stale events.
- Added ordering protection with provider event timestamps and status ranks:
  - older events cannot downgrade or reactivate a newer entitlement,
  - same-time lower-priority events cannot override higher-priority states such as `refunded`,
  - newer refunds still remove Premium,
  - newer recovered-payment events can restore `active`.
- Improved Lemon Squeezy entitlement states:
  - `past_due` and `unpaid` keep Premium active during billing retry/grace.
  - cancelled subscriptions with a future `ends_at` become `cancelled_active` and keep Premium until the paid period ends.
  - refund events become `refunded` and remove Premium immediately.
  - `expired` and ended `canceled` remain non-premium.
- Updated app entitlement/UI handling so `past_due` and `cancelled_active` are premium-active states with clear account/paywall copy.
- Fixed a callable-emulator crash found during QC by using `Timestamp`/`FieldValue` from `firebase-admin/firestore` for rate-limit documents.

### Payment QC Run

- `$HOME/.nvm/versions/node/v20.20.2/bin/node --test functions/tests/lemonsqueezy-webhook.test.js`
  - Result: PASS, 47/47.
  - Covered: signature/raw-body verification, test-mode lock, durable duplicate receipts, derived event IDs, stale/out-of-order events, same-time rank ordering, past-due grace, cancelled-but-active, refunds, manual overrides, and recovered payments.
- `PATH=$HOME/.nvm/versions/node/v20.20.2/bin:$PATH npm --prefix functions test`
  - Result: PASS, 81/81.
  - Covered: checkout remains test-mode-only, webhook hardening, ORS entitlement/rate-limit policy, and kill switches.
- `PATH=$HOME/.nvm/versions/node/v20.20.2/bin:$PATH npm run test:functions:emulator`
  - Result: PASS, 9/9.
  - Covered: emulator-backed route/geocode entitlement enforcement after the `past_due` policy change and rate-limit timestamp fix.
  - Note: firebase-tools emitted the existing Java 21 future-requirement warning; current run passed on Java 18.
- `$HOME/.nvm/versions/node/v20.20.2/bin/node --test tests/auth-account-ui.test.js`
  - Result: PASS, 4/4.
  - Covered: billing portal/account UI basics still render after entitlement state copy changes.

### Remaining Payment Risks

- Live Lemon Squeezy mode is intentionally still blocked and remains the absolute final RC switch.
- The processed-event collection is server-only by default because there is no client rule match for `_lemonSqueezyWebhookEvents`; no client path was added.
- Chargeback/dispute-specific provider event handling still needs a confirmed Lemon Squeezy event design before paid/public launch.
- A real Lemon Squeezy test-mode delivery re-skim is still useful after deploy to confirm provider timestamp paths match the fixtures.

## Parts 1-6 QC Audit Progress

- Added `plans/PARTS_1_6_QC_AUDIT.md` as the detailed QC record for Stage 0 through Part 6.
- Confirmed Lemon Squeezy remains hard-locked in test mode:
  - checkout payload still uses `attributes.test_mode: true`,
  - live-mode webhook payloads are still ignored,
  - Carter approval lock remains documented.
- Fixed a QC-discovered helper-name collision in `functions/index.js`: the webhook request header helper no longer shadows the ORS retry-header helper.
- Added a conservative Lemon Squeezy variant-mismatch guard for webhook payloads that include `variant_id` or a variant relationship.
- Added explicit rules tests that deny client reads/writes to `_premiumCallableRateLimits`, `_lemonSqueezyWebhookEvents`, and `feedback`.
- Added `tests/playwright/stage0-launch-flags-smoke.spec.js` to verify risky flags fail closed and can be re-enabled without breaking normal browsing.

### Parts 1-6 QC Test Run

- `git diff --check`
  - Result: PASS after generated emulator logs were cleaned.
- Conflict-marker search with `rg -n "^(<<<<<<<|=======|>>>>>>>)"`
  - Result: PASS, no conflict markers.
- `node --check functions/index.js`
  - Result: PASS.
- `node --check functions/tests/lemonsqueezy-webhook.test.js`
  - Result: PASS.
- `node --check tests/playwright/stage0-launch-flags-smoke.spec.js`
  - Result: PASS.
- `npm ls --depth=0`
  - Result: PASS.
- `npm --prefix functions ls --depth=0`
  - Result: PASS.
- `npm --prefix functions test`
  - Result: PASS, 82/82.
- `npm run test:rules`
  - Result: PASS, 23/23.
- `npm run test:functions:emulator`
  - Result: PASS, 9/9.
- `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/stage0-launch-flags-smoke.spec.js --workers=1 --reporter=list`
  - Result: PASS, 2/2.
- Signed-in focused Playwright group for free limit, route gating, premium-gating, and account matrix:
  - Result: PASS, 13/13.
- Signed-in auth/profile/settings/global-search group:
  - Result: PASS, 23/23.
- Public/mobile regression group:
  - Result: PASS, 16/16.

### Parts 1-6 QC Notes

- Current free tracked-visit policy is 5, not 20, per Carter's later instruction. QC verified 5th-place success and 6th-place denial.
- `playwright/.auth/free-user.json`, `playwright/.auth/premium-user.json`, and `playwright/.auth/free-user-b.json` exist locally and remain ignored.
- Google Sheet polling kill switch was not implemented in Parts 1-6; no Sheet-polling flag was tested.
- Parts 1-6 are safe for 5-10 private testers while Lemon Squeezy remains in test mode. Paid/public launch remains blocked.

## Parts 1-6 Merge Candidate Milestone

- Date: 2026-05-09.
- Merge candidate branch: `codex/payment-webhook-hardening-test-mode`.
- Merge candidate commit before this progress note: `4548a4a`.
- GitHub status: branch pushed to `origin/codex/payment-webhook-hardening-test-mode`.
- Release status: **YELLOW for 5-10 private testers in Lemon Squeezy test mode; RED for paid/public launch**.
- Critical lock: Lemon Squeezy remains test-mode-only. Do not enable live checkout or remove the Carter approval lock until Carter explicitly approves the final RC switch.
- Local work preservation: preexisting unmerged local edits were parked in stash `codex-preserve-local-before-clean-merge-candidate` before this clean merge candidate pass.
- Next action: run a clean post-merge-candidate check, then merge to `main` only if the worktree stays clean and tests pass.

## Parts 1-6 Main Merge And Post-Merge Check

- Date: 2026-05-09.
- Merged branch: `codex/payment-webhook-hardening-test-mode`.
- Merge target: `main`.
- Merge commit: `f225e7f`.
- Merge result: clean merge with no conflicts.
- Lemon Squeezy status: still locked in test mode; live checkout was not enabled and the Carter approval lock remains required.
- Pre-merge candidate check:
  - `git diff --check`: PASS.
  - conflict-marker search: PASS.
  - `node --check functions/index.js`: PASS.
  - `npm ls --depth=0`: PASS.
  - `npm --prefix functions ls --depth=0`: PASS.
  - `npm --prefix functions test`: PASS, 82/82.
  - `npm run test:rules`: PASS, 23/23.

## Email Verification Hardening

- Date: 2026-05-09.
- Branch: `codex/promo-access-code-premium`.
- Lemon Squeezy status: still locked in test mode; checkout payload still uses `attributes.test_mode: true`.
- Added email verification for Firebase email/password accounts:
  - new email/password account creation sends a Firebase verification email,
  - account UI shows `Email verification sent`, `Please verify your email`, `Resend verification email`, and `I verified, refresh status`,
  - resend has a 60-second cooldown,
  - account load/sign-in refreshes `emailVerified` from Firebase Auth,
  - the verified-refresh action forces an ID-token refresh so callables receive the updated `email_verified` claim.
- Added verification gates:
  - unverified password users cannot start Lemon checkout, premium routing/geocode, or the disabled legacy code callable,
  - unverified password users cannot start Lemon checkout,
  - unverified password users cannot call premium route/geocode functions,
  - Google users with verified email are not blocked.
- Client hint fields written to `users/{uid}`:
  - `emailVerified`
  - `emailVerificationUpdatedAt`
  - These are written only after explicit verification actions such as send/resend/refresh, not on every app load.
  - Entitlement fields remain protected and server-authoritative.

### Email Verification QC

- `node --check services/authAccountUi.js`
  - Result: PASS.
- `node --check modules/paywallController.js`
  - Result: PASS.
- `node --check services/orsService.js`
  - Result: PASS.
- `node --check functions/index.js`
  - Result: PASS.
- `node --test tests/auth-account-ui.test.js`
  - Result: PASS, 9/9.
- `npm --prefix functions test`
  - Result: PASS, 106/106.
- `npm run test:rules`
  - Result: PASS, 26/26.
  - Note: firebase-tools emitted the existing Java 21 future-requirement warning; current run passed on Java 18.
- `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/promo-access-code-smoke.spec.js tests/playwright/bark-app-identity-smoke.spec.js --reporter=list`
  - Result: PASS, 8/8.

## Lemon Test-Mode Cancellation QA

- Date: 2026-05-09.
- Lemon Squeezy status: still locked in test mode; checkout payload still uses `attributes.test_mode: true`.
- Added `plans/LEMONSQUEEZY_TEST_MODE_CANCELLATION_QA.md` with exact test-mode cancellation paths:
  - dashboard cancellation,
  - API `DELETE /v1/subscriptions/:id` using the test API key,
  - test-mode webhook simulation for `subscription_expired`,
  - refund simulation,
  - signed customer portal verification.
- Added `getCustomerPortalUrl` callable:
  - reads the signed-in user's Lemon subscription entitlement,
  - rejects access-code/free users because they have no Lemon billing subscription,
  - retrieves `GET /v1/subscriptions/:id`,
  - opens the returned signed `urls.customer_portal` URL when available.
- Account UI now prefers signed customer portal URLs and shows explicit cancelled-active copy:
  - `Premium cancelled`
  - `Access ends: [date]`
  - `Auto-renew: No`
- Expired/refunded Lemon users show inactive/refunded billing states and lose Premium.
- Active access-code/free Premium grants remain protected from Lemon cancellation/expiration/refund events.
  - `npm run test:functions:emulator`: first parallel attempt failed from Firestore emulator port collision; serial rerun PASS, 9/9.
  - focused Playwright sweep with free, premium/test, and second-account storage states: PASS, 54/54.
- Post-merge check on `main`:
  - `git diff --check`: PASS.
  - conflict-marker search: PASS.
  - `node --check functions/index.js`: PASS.
  - `npm ls --depth=0`: PASS.
  - `npm --prefix functions ls --depth=0`: PASS.
  - `npm --prefix functions test`: PASS, 82/82.
  - `npm run test:rules`: PASS, 23/23.
  - `npm run test:functions:emulator`: PASS, 9/9.
  - focused Playwright sweep with free, premium/test, and second-account storage states: PASS, 54/54.
- Notes:
  - firebase-tools still warns that Java 21 will be required in v15; current checks passed on Java 18.
  - Playwright notes that trip-planner stop persistence after reload is not covered because current runtime trip state does not persist across reload; dynamic styling and visit persistence are covered.
  - Generated `firebase-debug.log`, `firestore-debug.log`, `functions/.secret.local`, and `test-results/` artifacts were cleaned before pushing.

## Free Visit Cap Deployment Clarification

- Date: 2026-05-09.
- Current code policy: free tracked visits stop at **5**, not 20.
- Local source check:
  - `services/checkinService.js` has `FREE_VISIT_LIMIT = 5`.
  - `firestore.rules` has `freeVisitedPlaceLimit() { return 5; }`.
  - `tests/playwright/bug015-free-visited-limit-smoke.spec.js` verifies 5th add succeeds and 6th add is blocked.
- Edge-case fix added after post-merge review:
  - Legacy free users or expired premium users already above 5 cannot add more visits.
  - They also cannot swap one over-limit list for another same-sized over-limit list.
  - They can remove visits one at a time, so an account with 20 can go 20 -> 19 -> 18 without being trapped by rules.
  - `past_due` and `cancelled_active` are now premium-active in Firestore rules, matching `premiumService` and payment hardening policy.

## Leaderboard Server-Authoritative Integrity Progress

- Date: 2026-05-09.
- Scope: P1 integrity fix after Parts 1-6 private-beta hardening.
- Lemon Squeezy status: unchanged and still locked in test mode. Checkout live mode was not enabled.
- Old path:
  - `modules/profileEngine.js` calculated score in the browser and wrote directly to `users/{uid}` score mirrors and `leaderboard/{uid}`.
  - `firestore.rules` allowed an owner to create/update `leaderboard/{uid}` with allowed leaderboard keys, so a signed-in client could fake totals.
- New path:
  - `modules/profileEngine.js` calls the `syncLeaderboardScore` callable.
  - `functions/index.js` reads `users/{uid}`, calculates leaderboard totals server-side from `visitedPlaces` and `walkPoints`, writes score mirrors to `users/{uid}`, and writes the public row to `leaderboard/{uid}`.
  - `firestore.rules` now makes `leaderboard/{uid}` public-read and client read-only; direct client create/update/delete is denied.
- Compatibility:
  - Existing leaderboard initial read and See More cursor pagination are unchanged.
  - Profile score display still renders locally; leaderboard sync failure is now a warning so profile rendering can continue.
  - Remaining integrity caveat: direct leaderboard totals are blocked, but some source inputs, especially walk/expedition points, are still client-authored and should be hardened later if leaderboard competition becomes high-stakes.

### Leaderboard Integrity QC Run

- `node --check functions/index.js`
  - Result: PASS.
- `node --check functions/tests/leaderboard-sync.test.js`
  - Result: PASS.
- `node --check tests/playwright/stage0-launch-flags-smoke.spec.js`
  - Result: PASS.
- `node --check tests/profile-leaderboard-rank-achievement.test.js`
  - Result: PASS.
- `node --test tests/profile-leaderboard-rank-achievement.test.js`
  - Result: PASS, 2/2.
  - Covered: cached leaderboard rank still reaches achievements; profile sync uses `syncLeaderboardScore` instead of direct Firestore writes.
- `npm --prefix functions test`
  - Result: PASS, 86/86.
  - Covered: new authenticated leaderboard sync, unauthenticated rejection, fake caller-provided `totalPoints` ignored, existing checkout/webhook/ORS suites.
- `npm run test:rules`
  - Result: PASS, 24/24.
  - Covered: direct owner and other-user writes to `leaderboard/{uid}` are denied.
- `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/stage0-launch-flags-smoke.spec.js --workers=1 --reporter=list`
  - First run: 2/3 passed; new See More regression needed a better render wait.
  - Final rerun: PASS, 3/3.
  - Covered: initial leaderboard `limit(5)` and See More `startAfter(lastDoc).limit(5)` still work.
- Signed-in focused Playwright sweep:
  - Command used local ignored free, premium/test, and second-account storage states.
  - Result: PASS, 11/11.
  - Covered: account UI, free 5-visit cap, premium bypass, and route generation gating after the leaderboard callable change.
- `npm run test:functions:emulator`
  - First run: failed from Functions discovery timeout before definitions fully loaded; warmup calls returned `not-found`.
  - Clean rerun: PASS, 9/9.
  - Covered: existing ORS callable emulator entitlement behavior after adding `syncLeaderboardScore`.
- `npm ls --depth=0`
  - Result: PASS.
- `npm --prefix functions ls --depth=0`
  - Result: PASS.
- QC: `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules` passed 24/24.
- Deployment note: pushing to GitHub updates the repository, but this repo has no checked-in GitHub Actions deploy workflow. Firebase Hosting/Firestore rules/functions must be deployed separately before the public/test website shows the new 5-visit behavior.

## Saved Route Premium Gate Fix

- Date: 2026-05-09.
- Issue: signed-in free accounts could save and load unlimited saved routes because the app and Firestore rules only checked account ownership.
- Policy now implemented:
  - Manual trip planning remains free.
  - Saving saved routes is Premium-only.
  - Listing/loading saved routes is Premium-only.
  - Owner delete remains allowed as cleanup for old saved-route documents.
- Files changed:
  - `engines/tripPlannerCore.js`
  - `renderers/routeRenderer.js`
  - `services/firebaseService.js`
  - `modules/paywallController.js`
  - `services/authAccountUi.js`
  - `firestore.rules`
  - `tests/rules/firestore-entitlement.rules.test.js`
  - `tests/route-renderer-account-gate.test.js`
  - `tests/playwright/bug026-trip-save-custom-stop-smoke.spec.js`
- QC:
  - JS syntax checks passed for touched runtime files.
  - `node --test tests/route-renderer-account-gate.test.js` passed 4/4.
  - `node --test tests/trip-planner-day-pager.test.js` passed 7/7.
  - `npm run test:rules` passed 24/24.
  - `BARK_E2E_BASE_URL=http://localhost:4173/index.html BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json" BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json" npx playwright test tests/playwright/bug026-trip-save-custom-stop-smoke.spec.js --workers=1 --reporter=list` passed 2/2.
- Deployment note: this requires hosting plus Firestore rules deployment before the hosted test app will enforce the new saved-route premium gate.

## Firebase Deployment Milestone

- Date: 2026-05-09.
- Deployed project: `barkrangermap-auth`.
- Deployed URL: `https://barkrangermap-auth.web.app`.
- GitHub commit deployed: `710529e harden Firebase Hosting deploy ignores`.
- Deployment scope:
  - Firebase Hosting.
  - Firestore rules.
  - Cloud Functions.
- Pre-deploy code state:
  - `main` was up to date with `origin/main`.
  - Pre-deploy tests already passed:
    - `npm run test:rules`: PASS, 24/24.
    - `npm --prefix functions test`: PASS, 82/82.
- Important deploy safety correction:
  - First deploy attempt was stopped after Firebase Hosting tried to package repo-root development files because `public` is `.`.
  - `firebase.json` now explicitly excludes `.git/**`, `.firebase/**`, `playwright/**`, tests, logs, Functions source, plans/docs, and other dev-only files from Hosting.
  - `.gitignore` now ignores Firebase deploy/emulator artifacts.
  - Local Hosting package check now reports 55 files and confirms `.git`, Playwright auth storage states, Functions source, plans, tests, and logs are excluded.
- Final deploy result:
  - Firestore rules compiled and released.
  - Functions deployed successfully.
  - Hosting finalized and released successfully.
  - Lemon Squeezy remains locked in test mode; live checkout was not enabled.
- Post-deploy checks:
  - `https://barkrangermap-auth.web.app/`: HTTP 200.
  - Private/dev paths returned HTTP 404:
    - `/.git/config`
    - `/playwright/.auth/free-user.json`
    - `/firebase-debug.log`
    - `/firestore-debug.log`
    - `/functions/index.js`
    - `/plans/LAUNCH_READINESS_FIREBASE_COST_REPORT.md`
- Tooling note:
  - Firebase deploy warns that Node.js 20 Cloud Functions runtime is deprecated as of 2026-04-30 and decommissions 2026-10-30. This is not blocking today, but runtime upgrade should be added before final public launch.

## Free Visit Limit Paywall Polish

- Date: 2026-05-09.
- Issue: the free 5-park cap was enforced, but panel actions still showed a browser alert when a free user tried to add a 6th visited park.
- Fix:
  - Added a dedicated paywall source for the visited-place limit.
  - Changed both Mark as Visited and Verified Check-In limit failures to open the existing Premium modal.
  - Added specific copy: `Adding more than 5 parks is a Premium feature`.
  - Kept a plain alert fallback only for the unlikely case where the paywall controller is unavailable.
  - Bumped `index.html` cache query strings for `paywallController.js` and `panelRenderer.js` so Hosting loads the new behavior immediately.
- QC:
  - `node --check modules/paywallController.js`: PASS.
  - `node --check renderers/panelRenderer.js`: PASS.
  - `node --test tests/render-safety.test.js`: PASS, 6/6.
  - `BARK_E2E_BASE_URL=http://localhost:4173/index.html BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json" BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json" npx playwright test tests/playwright/bug015-free-visited-limit-smoke.spec.js --workers=1 --reporter=list`: PASS, 5/5.

## No Account, Free, And Premium Consistency Sweep

- Date: 2026-05-09.
- Scope: no-account, signed-in free, signed-in Premium/test entitlement, and second-account switch behavior after the free-visit paywall polish.
- Result: no new functional, entitlement, or layout regressions found.
- Coverage run:
  - Full signed-in/signed-out smoke matrix with free, premium/test, and second-account storage states:
    - `npm run test:e2e:smoke`: PASS, 41/41.
  - Mobile-ish layout and console sweep:
    - `tests/playwright/final-mobile-console-beta-sweep.spec.js`: PASS, 3/3.
  - Extra account/auth/entitlement/flag specs outside the main smoke script:
    - `account-auth-smoke.spec.js`
    - `account-switch-premium-matrix.spec.js`
    - `bug001-achievement-permission-smoke.spec.js`
    - `phase4c-premium-entitlement-smoke.spec.js`
    - `phase4c-global-search-entitlement-smoke.spec.js`
    - `stage0-launch-flags-smoke.spec.js`
    - Combined result: PASS, 17/17.
  - Baseline backend/rules/render checks:
    - `npm run test:rules`: PASS, 24/24.
    - `npm --prefix functions test`: PASS, 82/82.
    - `node --test tests/render-safety.test.js`: PASS, 6/6.
- Confirmed behaviors:
  - Signed-out users can browse, search locally, open account prompts, and see readable Premium prompts.
  - Free users stay locked out of premium filters/tools, route generation, global geocode, saved routes, and the 6th visited park.
  - Free 5-park cap opens the Premium modal rather than a browser alert.
  - Premium/test entitlement users can use premium map tools, route/geocode paths, saved-route flows, and over-limit visit tracking.
  - Switching accounts clears stale premium and visited-place state.
  - Mobile paywall/profile/search/settings/planner views remain console-clean and inside viewport.
- Notes:
  - Firebase emulator still warns that Java 21 will be required by firebase-tools v15; current tests pass on Java 18.
  - Functions deploy tooling still warns that Node.js 20 runtime is deprecated and should be upgraded before final public launch.

## Historical Internal Access-Code Experiment (Deprecated / Do Not Use)

- Date: 2026-05-09.
- Status: superseded later the same day by the Lemon-only coupon simplification below. This section is historical evidence only, not current beta/admin guidance.
- Scope at the time: a unified user-facing `Promo / Access Code` field for free BARK Premium grants and Lemon coupon checkout passthrough.
- Lemon Squeezy status: unchanged and still locked in test mode. Checkout live mode was not enabled and the Carter approval lock remains required.
- Historical implementation summary:
  - A Firestore-backed `accessCodes/{codeHash}` / `accessCodeRedemptions/{redemptionId}` model was prototyped and protected from client reads/writes.
  - A `redeemAccessOrPromoCode` callable was prototyped, then disabled before it became the current user-facing flow.
  - The app briefly had a Premium-modal code box; that box has since been removed.
  - Current product/admin guidance is **not** to create Firestore `accessCodes` for testers/admins.
  - Existing `source: access_code` entitlement handling remains only as legacy compatibility in case a record exists.
- QC:
  - `PATH="${BARK_NODE20_BIN:-$HOME/.nvm/versions/node/v20.20.2/bin}:$PATH" npm --prefix functions test`: PASS, 99/99.
  - `PATH="${BARK_NODE20_BIN:-$HOME/.nvm/versions/node/v20.20.2/bin}:$PATH" node --test tests/auth-account-ui.test.js`: PASS, 5/5.
  - `PATH="${BARK_NODE20_BIN:-$HOME/.nvm/versions/node/v20.20.2/bin}:$PATH" npm run test:rules`: PASS, 26/26.
  - `BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/promo-access-code-smoke.spec.js --reporter=list`: PASS, 5/5.
- Current decision:
  - Do not create new Firestore access-code docs.
  - Use Lemon Squeezy discounts for all admin/mod/VIP/support/launch codes.
  - Lemon live mode remains a later final-RC task only after Carter explicitly approves it.

## Lemon-Only Coupon Simplification

- Date: 2026-05-09.
- Product decision: Carter does not want internal BARK access codes. All admin/mod/VIP/support free codes and paid discount codes should be created as Lemon Squeezy discounts.
- Lemon Squeezy status: unchanged and still locked in test mode. Checkout live mode was not enabled and the Carter approval lock remains required.
- Runtime changes:
  - Removed the app-side `Promo / Access Code` field from the Premium modal.
  - Removed the paywall UI path that called `redeemAccessOrPromoCode`.
  - Disabled `redeemAccessOrPromoCode` for new server-side redemptions; it now tells callers to enter coupon codes on the Lemon checkout page.
  - Kept legacy `source: access_code` entitlement evaluation/display compatibility only for any existing records until `expiresAt`.
  - Keeps coupon entry inside Lemon Squeezy checkout only; `createCheckoutSession` does not accept or prefill coupon payloads.
- Lemon discount-field finding:
  - The app does not set `checkout_options.discount: false`.
  - If Lemon's discount field is missing, the likely cause is Lemon dashboard/test-mode discount setup: discount-code toggle off, no active test-mode discount for the product/variant, live/test-mode mismatch, expired/limited discount, or a stale checkout URL.
- Docs:
  - Replaced the old promo/access-code runbook with `plans/LEMON_COUPON_RUNBOOK.md`.
- Tests:
  - Added `tests/playwright/lemon-coupon-checkout-smoke.spec.js`.
  - Updated `functions/tests/lemon-coupon.test.js` to assert old app-side redemption is disabled and app checkouts do not pass coupon payloads.
