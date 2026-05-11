# Final RC Go / No-Go

Date: 2026-05-09 local
Branch: `main`
Commit checked: `2bbde92982c07e8e03a39fb82469c7ddd5cd8962`

## Decision

Controlled 25-50 user beta: **GO / YELLOW**

Paid public launch: **NO / RED**

## Why Controlled Beta Is GO / YELLOW

- No P0 blocker found.
- Public load, mobile-ish smoke, auth, account switching, free cap, route/geocode gating, checkout gating, premium state, functions, rules, and emulator tests passed.
- Lemon remains test-mode locked.
- Coupon model is Lemon-only and no app-side code box remains.
- Firebase Hosting does not serve internal docs/plans/legal reports.
- No tracked debug logs, auth storage states, service-account JSON, or private-key JSON files were found.

Yellow conditions:

- Current workspace is dirty and must be committed before deploy.
- Manual budget alerts, monitoring checks, and rollback readiness still need Carter confirmation.
- Public GitHub exposure remains a documented Carter decision.

## Why Paid Public Launch Is NO / RED

- Lemon live mode is intentionally not enabled.
- A real live test transaction/refund/cancel smoke has not been run.
- Legal/privacy/trademark/data-source questions remain pending lawyer review.
- Public GitHub exposure cleanup/private-repo decision remains open.

## Go Criteria For Controlled RC Deploy

- [ ] Commit the current intended RC changes.
- [ ] Run and pass:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run test:functions:emulator
```

- [ ] Deploy:

```bash
firebase deploy --only hosting,functions,firestore:rules
```

- [ ] Run post-deploy smoke.
- [ ] Confirm budget/monitoring checklist.
- [ ] Keep Lemon in test mode.

## Stop Conditions

Stop the release if any of these happen:

- App does not load.
- Auth/sign-out/account switching breaks.
- Premium entitlement is wrong.
- Lemon live mode is accidentally enabled.
- Checkout no longer opens Lemon test checkout.
- Free users bypass Premium gates or the 5-visit cap.
- Direct entitlement/leaderboard/server-only writes are allowed by rules.
- Debug logs/secrets/auth states become tracked.
- Internal docs become Firebase-hosted.

## Final Confirmation

Lemon remains `test_mode: true`.

Carter approval lock remains required.

Safe to switch Lemon live mode: **No**.
