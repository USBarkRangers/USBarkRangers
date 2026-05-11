# Final RC QC Report

Date: 2026-05-09 local
Repo: `/Users/carterswarm/BarkRangerMap`
Branch checked: `main`
Commit checked: `2bbde92982c07e8e03a39fb82469c7ddd5cd8962`

## Executive Summary

Result: **PASS for final RC QC, with manual release decisions still required.**

No P0 blocker was found. The app is ready to become a controlled release candidate for 25-50 users after Carter commits the current RC changes, deploys Hosting + Functions + Firestore rules together, and completes the manual operations checks.

Lemon Squeezy remains locked in test mode. The app is **not** safe to switch Lemon live mode yet, and paid public launch remains blocked until Carter explicitly approves the live-mode RC switch and completes a real low-risk transaction/refund/cancel smoke.

## Launch Colors

| Release target | Color | Reason |
|---|---|---|
| 25-50 controlled users | **YELLOW** | Code/test gate is clean; manual ops and exact RC commit/deploy still required. |
| Paid public launch | **RED** | Lemon live mode intentionally locked; legal/privacy/brand/payment smoke and public GitHub decisions remain open. |

## Product State Verified

- Lemon-only coupons are the current user-facing model.
- No BARK app-side `Promo / Access Code` box is visible.
- Admin/mod/VIP/support free access is documented as Lemon 100% off coupons.
- Premium is not granted by checkout creation.
- Premium activation remains server-authoritative through Lemon webhook entitlement state.
- Lemon checkout remains `test_mode: true`.
- Live webhook events remain ignored while locked.
- Carter approval lock remains present.
- Internal docs are ignored by Firebase Hosting.
- Debug logs, auth storage states, service-account files, and private-key JSON files are not tracked.

## Tests Run

| Test/check | Result |
|---|---|
| `git diff --check` | PASS |
| Conflict marker scan | PASS |
| Tracked sensitive path scan | PASS, only `.env.example` reported |
| Lemon lock/code search | PASS |
| Hosting ignore review | PASS |
| Required docs/runbooks existence check | PASS |
| `npm --prefix functions test` | PASS: 112/112 |
| `node --test tests/*.test.js` | PASS: 53/53 |
| `npm run test:rules` | PASS: 27/27 |
| `FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run test:functions:emulator` | PASS: 10/10 |
| Focused Playwright RC smoke | PASS: 38/38 |

Playwright coverage included public load, fallback pins, mobile-ish console sweep, auth UI, sign-out, account switching, Lemon-only checkout, unverified-user checkout block, free 5-visit cap, route gating, global search entitlement, and premium/free state isolation.

## Bugs Fixed

None during this QC pass. No P0 blocker required a code fix.

## P0 Blockers Remaining

None found.

## P1 Backlog

1. Commit the exact RC diff before deploy.
2. Use `FUNCTIONS_DISCOVERY_TIMEOUT=60` in the callable emulator release gate.
3. Complete budget alerts, monitoring dashboards/log checks, and rollback/kill-switch readiness before inviting 25-50 users.
4. Decide how to handle public GitHub exposure of internal docs. Firebase Hosting is protected, but public repo visibility is separate.
5. Do not share raw emulator logs externally; the Firebase CLI can echo local environment values during tests.

## P2 Backlog

1. Upgrade local Java to 21 before Firebase tools v15.
2. Clean/archive old internal planning docs after RC commit.
3. Continue legal/trademark/data-source review.
4. Complete public-safe README/LICENSE/NOTICE decisions later.

## Manual Tasks Before 25-50 Users

1. Commit current RC changes.
2. Run final gate:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run test:functions:emulator
```

3. Deploy matched artifacts:

```bash
firebase deploy --only hosting,functions,firestore:rules
```

4. Run the controlled release post-deploy smoke from `plans/CONTROLLED_RELEASE_RC_CHECKLIST.md`.
5. Confirm budget alerts and monitoring checklist items are live.
6. Give testers the script in `plans/CONTROLLED_RELEASE_TESTER_SCRIPT.md`.

## Manual Tasks Before Paid Public Launch

1. Carter explicitly approves the Lemon live-mode RC switch.
2. Apply live Lemon env/secrets per `plans/LEMON_LIVE_MODE_ENV_VARS.md`.
3. Run the real low-risk transaction/refund/cancel plan in `plans/LEMON_LIVE_MODE_TEST_TRANSACTION_PLAN.md`.
4. Confirm live webhook delivery, entitlement activation, cancellation, expiration, refund, and customer portal behavior.
5. Resolve legal/privacy/trademark/data-source questions.
6. Decide public GitHub exposure cleanup or make the repo private/sanitized.
7. Confirm production budget alerts, App Check rollout readiness, rollback playbook, and support/refund process.

## Final Statement

Safe to deploy controlled release candidate: **Yes, after commit and manual ops checks.**

Safe to switch Lemon live mode: **No.** Lemon must remain test-mode locked until Carter explicitly approves and live payment smoke is completed.
