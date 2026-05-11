# BARK Ranger Map Production Ops Runbook

Date: 2026-05-09
Status: operational readiness draft for broader controlled release and paid-public readiness.
Scope: docs only. Do not switch Lemon Squeezy live mode from this runbook.

## 1. Release Status

Current readiness from the QC reports:

- 5-10 private testers: **GREEN** if Hosting, Functions, and Firestore rules are deployed from the same tested commit.
- 25-50 broader controlled testers: **YELLOW** until budget alerts, monitoring, App Check preparation, and support/rollback runbooks are complete.
- Paid public launch: **RED** until Carter explicitly approves the final Lemon Squeezy live-mode RC switch and a real low-risk live transaction/refund smoke passes.

Critical lock:

- Lemon checkout must remain `attributes.test_mode: true`.
- Live-mode webhook events remain ignored while the lock is active.
- The Carter approval lock must not be removed during private beta operations.

## 2. Operator Roles

| Role | Owner | Responsibility |
|---|---|---|
| Release owner | Carter | Decides when to deploy, pause features, invite testers, and approve broader rollout. |
| Firebase operator | Carter or trusted helper | Runs deploys, watches Firestore/Functions/Auth/Hosting metrics, and handles kill switches. |
| Payments operator | Carter | Checks Lemon test-mode checkouts, coupons, webhook success, refunds, cancellations, and support messages. |
| Support contact | Carter | Receives tester reports and tracks device/browser/account/action details. |

## 3. Pre-Deploy Gate

Run from repo root:

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git diff --check
rg -n "<<<<<<<|=======|>>>>>>>" --glob "!node_modules/**" --glob "!functions/node_modules/**"
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:functions:emulator
```

Recommended local smoke before deploy:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx http-server . -p 4173 -c-1
BARK_E2E_BASE_URL=http://localhost:4173/index.html PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:e2e:smoke
```

If signed-in storage states are required, use the ignored local files:

```bash
BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json"
BARK_E2E_STORAGE_STATE_B="$PWD/playwright/.auth/free-user-b.json"
BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json"
```

Do not commit Playwright storage states.

## 4. Deploy Command

Deploy Hosting, Functions, and Firestore rules together from the same tested commit:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" firebase deploy --only hosting,functions,firestore:rules
```

If an emergency partial deploy is needed:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" firebase deploy --only hosting
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" firebase deploy --only functions
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" firebase deploy --only firestore:rules
```

Partial deploys should be followed by a full matching deploy when the incident is over.

## 5. Post-Deploy Smoke

Within 15 minutes of deploy:

1. Open the production Hosting URL in a normal browser session.
2. Confirm the public map loads and pins appear from Google Sheets CSV or fallback data.
3. Confirm local search works signed out.
4. Confirm filters do not crash the map.
5. Confirm signed-out users can browse without auth/payment prompts.
6. Sign in with a free test account and confirm profile/account loads.
7. Confirm the free visited-place cap is 5, with 6th add blocked cleanly.
8. Sign in with a premium/test entitlement account and confirm premium tools are visible.
9. Confirm saved route save/load is premium-gated.
10. Start a Lemon checkout in test mode and verify the URL is a Lemon test checkout.
11. Confirm Lemon coupons are entered on Lemon checkout, not in an app-side code box.
12. Confirm Manage Billing appears only for Lemon subscription users with billing data.
13. Confirm leaderboard initial load and See More when enabled.
14. Test mobile-ish viewport for public map, account, paywall, and route screens.

## 6. Dashboards To Keep Open During Release

- Firebase Console -> Firestore Database -> Usage.
- Firebase Console -> Functions -> each function metrics and logs.
- Firebase Console -> Authentication -> Users.
- Firebase Console -> App Check, if monitoring is configured.
- Google Cloud Console -> Billing -> Reports.
- Google Cloud Console -> Billing -> Budgets & alerts.
- Google Cloud Console -> Logging -> Logs Explorer.
- Lemon Squeezy -> Store -> Orders, Subscriptions, Discounts, Webhooks.
- Support inbox or support form destination.

## 7. Function Watchlist

Watch invocations, errors, latency, and logs for:

- `createCheckoutSession`
- `lemonSqueezyWebhook`
- `getPremiumRoute`
- `getPremiumGeocode`
- `syncLeaderboardScore`

Watch for:

- high error rate,
- repeated `failed-precondition`,
- rate-limit denials,
- missing UID,
- invalid Lemon signature,
- ignored non-test-mode Lemon events,
- entitlement downgrades,
- ORS errors,
- checkout starts with no matching webhook completion.

## 8. Launch-Day Cadence

For 5-10 testers:

- Check dashboards immediately after deploy, then at 15 minutes, 1 hour, 4 hours, and end of day.
- Review every payment, cancellation, coupon, route, and entitlement issue manually.
- Keep route/geocode and checkout kill-switch commands handy.

For 25-50 testers:

- Check dashboards at least morning, midday, evening, and after any admin/community post.
- Review Firestore reads/writes/deletes by hour.
- Review function errors and rate-limit logs daily.
- Review support inbox daily.

For paid public readiness:

- Do not proceed until the live-mode RC plan, legal/privacy/terms, App Check rollout, budget alerts, monitoring, and live payment/refund smoke are complete.

## 9. Incident Severity

| Severity | Examples | First action |
|---|---|---|
| P0 | App blank, auth broken, Lemon accidentally live, entitlement wrong, security bypass, runaway ORS calls | Disable affected feature, stop promotion, inspect logs, patch/deploy smallest fix. |
| P1 | Checkout confusion, coupon failures, high function errors, feedback broken, mobile blocker | Pause feature if needed, message testers, fix before expanding beta. |
| P2 | Cosmetic copy/layout issue, achievement spoofing, minor docs confusion | Track and fix in normal queue. |

## 10. Source Of Truth Files

- `plans/FINAL_PRIVATE_BETA_QC_REPORT.md`
- `plans/CODEBASE_LAUNCH_RISK_REGISTER.md`
- `plans/CODEBASE_CLEANUP_ROADMAP.md`
- `plans/LEMON_COUPON_RUNBOOK.md`
- `plans/ROLLBACK_AND_KILL_SWITCH_PLAYBOOK.md`
- `plans/POST_DEPLOY_MONITORING_CHECKLIST.md`
- `plans/BUDGET_ALERTS_SETUP_CHECKLIST.md`
- `plans/APP_CHECK_ROLLOUT_PLAN.md`
