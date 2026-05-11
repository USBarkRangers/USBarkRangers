# Controlled Release Final Status

Date: 2026-05-09
Branch: `main`
Commit before final RC commit: `2bbde92982c07e8e03a39fb82469c7ddd5cd8962`
Scope: final controlled beta release-candidate packaging for 25-50 users.

## Executive Result

Status: **GO for controlled beta deploy candidate after Carter deploys and runs post-deploy smoke.**

Controlled 25-50 user beta color: **YELLOW / GO**

Paid public launch color: **RED**

No deploy was run during this pass.

## Intended RC State Confirmed

- Lemon coupons are the only user-facing coupon/access-code path.
- The BARK app no longer shows a `Promo / Access Code` field.
- Admin/mod/support free access should be handled with Lemon Squeezy 100% off coupons.
- Premium activates only after Lemon webhook-confirmed entitlement.
- Lemon Squeezy checkout remains locked to `test_mode: true`.
- Live-mode webhooks remain ignored while the Carter approval lock is not active.
- Feedback uses the `submitFeedback` callable instead of direct client writes to `feedback`.
- Firebase Hosting ignores internal docs, plans, tests, functions, logs, and local artifacts.
- Internal policy/legal drafts remain in `plans/` and are marked draft/pending legal review.

## Test Commands And Results

```bash
git diff --check
```

Result: PASS

```bash
rg -n "^(<<<<<<<|=======|>>>>>>>)" --glob "!node_modules/**" --glob "!functions/node_modules/**" --glob "!test-results/**" --glob "!playwright-report/**"
```

Result: PASS, no conflict markers found.

```bash
git ls-files | rg '(^|/)(firebase-debug|firestore-debug|.*\.log$|\.env$|\.env\.|playwright/\.auth|storageState|serviceAccount|service-account|service_account|private.*key|.*key.*\.json$|test-results|playwright-report)'
git status --short --untracked-files=all | rg '(^|/)(firebase-debug|firestore-debug|.*\.log$|\.env$|\.env\.|playwright/\.auth|storageState|serviceAccount|service-account|service_account|private.*key|.*key.*\.json$|test-results|playwright-report)'
```

Result: PASS. Only tracked env-pattern file is `.env.example`; no auth states, debug logs, service-account files, private-key JSON, `test-results`, or `playwright-report` files are tracked.

```bash
node --check functions/index.js
node --check modules/uiController.js
```

Result: PASS

```bash
npm --prefix functions test
```

Result: PASS, 112/112 function tests passed.

```bash
npm run test:rules
```

Result: PASS, 27/27 Firestore rules tests passed.

```bash
FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run test:functions:emulator
```

Result: PASS, 10/10 callable emulator tests passed.

```bash
node --test tests/*.test.js
```

Result: PASS, 53/53 Node tests passed.

```bash
BARK_E2E_BASE_URL="http://localhost:4173/index.html" \
BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json" \
BARK_E2E_STORAGE_STATE_B="$PWD/playwright/.auth/free-user-b.json" \
BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json" \
npx playwright test \
  tests/playwright/bark-app-identity-smoke.spec.js \
  tests/playwright/bug004-static-fallback-data-smoke.spec.js \
  tests/playwright/lemon-coupon-checkout-smoke.spec.js \
  tests/playwright/phase3a-premium-gating-smoke.spec.js \
  tests/playwright/bug015-free-visited-limit-smoke.spec.js \
  tests/playwright/bug016-route-generation-gating-smoke.spec.js \
  --workers=1 --reporter=list
```

Result: PASS, 24/24 focused Playwright smoke tests passed.

Note: one stale Playwright assertion that expected the old internal `access_code` profile display was removed from the Lemon-only checkout smoke. This did not change app behavior; it aligns the smoke gate with Carter's final Lemon-only coupon decision. Existing Node/function tests still cover legacy `access_code` compatibility where it remains intentionally supported.

## P0 Bugs Fixed In This RC Work

- Feedback no longer writes directly to Firestore from the client. It now calls `submitFeedback`, which validates input, requires auth, rate-limits, and writes server-side.
- Direct client access to `feedback` and `_feedbackRateLimits` remains denied by Firestore rules.

No new P0 blockers were found during the final packaging pass.

## Remaining Paid Public Launch Blockers

- Carter has not approved Lemon live mode. Do not switch live until the live-mode RC checklist and real transaction/refund/cancel smoke are complete.
- Legal/privacy/trademark/data-source review is still pending.
- Public GitHub exposure decision is still pending; risky internal docs are ignored by Hosting but may remain visible on GitHub if the repo stays public.
- Budget alerts, App Check rollout, and production monitoring require Carter console setup before broader/paid launch.
- Lemon Squeezy coupon behavior must be validated in the Lemon test dashboard with a real test discount before inviting broader testers to use coupon codes.

## Carter Manual Steps Next

1. Deploy the controlled beta RC when ready:

```bash
firebase deploy --only hosting,functions,firestore:rules --project barkrangermap-auth
```

2. Run the post-deploy smoke checklist in `plans/POST_DEPLOY_MONITORING_CHECKLIST.md`.
3. Confirm budget alerts from `plans/BUDGET_ALERTS_SETUP_CHECKLIST.md`.
4. Confirm kill-switch/admin readiness from `plans/ROLLBACK_AND_KILL_SWITCH_PLAYBOOK.md`.
5. Create Lemon test-mode coupons in the Lemon dashboard and test checkout with them before sending instructions to testers.
6. Invite 25-50 controlled testers only after the deployed smoke passes.

## Final Lock Confirmation

- Lemon remains `test_mode: true`.
- Carter approval lock remains required.
- No app-side `Promo / Access Code` box remains.
- No deploy was run.
