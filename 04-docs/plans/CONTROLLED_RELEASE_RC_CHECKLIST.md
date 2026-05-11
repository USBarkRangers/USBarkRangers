# Controlled Release RC Checklist

Date: 2026-05-09
Scope: 25-50 user controlled release candidate package.
Status: conditional release checklist. Lemon Squeezy remains locked in test mode.

## 1. Release Decision

Current recommendation: **YELLOW / conditional GO for 25-50 controlled users**.

Proceed only if:

- Hosting, Functions, and Firestore rules are deployed from the same tested commit.
- Budget alerts are configured or Carter is actively monitoring Billing Reports during the test window.
- Firebase/Functions/Firestore/Lemon dashboards are open during the first test wave.
- Carter is ready to disable checkout, route/geocode, leaderboard deep browsing, or feedback if needed.
- Lemon Squeezy remains in test mode.

Do not treat this as paid public launch approval.

## 2. Current Branch And Commit

Record before deploying:

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

Latest package preparation observed:

- Branch: `main`
- Commit: `2bbde92982c07e8e03a39fb82469c7ddd5cd8962`
- Workspace: contains uncommitted hardening/docs changes. Commit/push/deploy only after Carter chooses the exact release commit.

## 3. Exact Private/Broader Beta Gate Commands

Run from repo root before deploying:

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git diff --check
rg -n "^(<<<<<<<|=======|>>>>>>>)" --glob "!node_modules/**" --glob "!functions/node_modules/**"
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node --check functions/index.js
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node --check modules/uiController.js
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:functions:emulator
```

If signed-in Playwright storage states exist locally:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx http-server . -p 4173 -c-1
BARK_E2E_BASE_URL=http://localhost:4173/index.html \
BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json" \
BARK_E2E_STORAGE_STATE_B="$PWD/playwright/.auth/free-user-b.json" \
BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json" \
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:e2e:smoke
```

If storage states are missing, regenerate them locally and do not commit them:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run save:e2e:free
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run save:e2e:free-b
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run save:e2e:premium
```

## 4. Exact Deploy Command

Deploy Hosting, Functions, and Firestore rules together:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" firebase deploy --only hosting,functions,firestore:rules
```

Do not deploy only Hosting if the release includes Functions or rules changes. Feedback, route/geocode, checkout, leaderboard sync, saved routes, and the free cap depend on matching backend/rules code.

## 5. Exact Post-Deploy Smoke Steps

Within 15 minutes after deploy:

1. Open the production/test URL in a fresh browser session.
2. Confirm public map loads.
3. Confirm pins load from Google Sheet CSV or fallback.
4. Confirm local search works while signed out.
5. Confirm filters do not crash the map.
6. Confirm signed-out browsing does not force payment/auth.
7. Sign in with a free test account.
8. Confirm email verification messaging is clear if unverified.
9. Mark 5 visited parks.
10. Attempt a 6th free visited mark and confirm a clean Premium prompt.
11. Open Premium/paywall UI.
12. Open Lemon test checkout; do not use real payment.
13. Confirm coupon entry is on Lemon checkout, not in the app.
14. Confirm route planner premium gates work.
15. Confirm saved route save/load is premium-only.
16. Confirm leaderboard initial load works.
17. Confirm leaderboard See More works when enabled.
18. Confirm account/billing page does not show Manage Billing for free users.
19. Sign in with premium/test entitlement account and confirm premium tools work.
20. Submit feedback from a signed-in test account and confirm no permission error.
21. Test mobile-ish viewport for map, search, account, paywall, and route screens.

## 6. Dashboards To Open During Release

- Firebase Console -> Firestore Database -> Usage.
- Firebase Console -> Functions -> metrics/logs.
- Firebase Console -> Authentication -> Users.
- Google Cloud Console -> Billing -> Reports.
- Google Cloud Console -> Billing -> Budgets & alerts.
- Google Cloud Console -> Logs Explorer.
- Lemon Squeezy test-mode dashboard -> Orders, Subscriptions, Discounts, Webhooks.
- Support inbox.

## 7. P0 Stop Conditions

Stop tester invites immediately if:

- app is blank or cannot load,
- auth/sign-in is broken,
- account state leaks between users,
- Lemon checkout is live or real payments are enabled,
- Premium entitlement is wrong,
- free users bypass Premium in normal UI,
- direct security bypass appears for entitlement/leaderboard/free cap,
- route/geocode calls spike or bypass rate limits,
- webhook state corrupts user access,
- Firestore/Functions cost spikes beyond the budget checklist thresholds.

## 8. P1 Fix-Before-Expansion Conditions

Do not expand beyond the current controlled group if:

- checkout/coupon flow confuses testers,
- cancellation/refund/expired test-mode behavior is unclear,
- feedback/support path is broken,
- mobile route/search/account layout blocks normal use,
- signed-in E2E tests are skipped or stale,
- budget alerts/monitoring are not actively watched,
- App Check plan has not been reviewed.

## 9. Paid Public Launch Still Blocked

Paid public launch remains **RED** until:

- Carter explicitly approves Lemon live mode,
- live secrets/config are set intentionally,
- a real low-risk live transaction/refund/cancel smoke passes,
- legal/privacy/terms/refund/support materials are approved,
- budget alerts and monitoring are proven,
- App Check decision is complete,
- public GitHub/legal/data/trademark exposure decisions are handled.
