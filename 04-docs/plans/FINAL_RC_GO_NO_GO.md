# Final RC Go / No-Go

Date: 2026-05-15 local
Branch: `main`
Last code commit checked before this doc update: `d9e3441f4d55f6b05e8097c363761d822115da92`

## Decision

Controlled 25-50 user beta: **GO / YELLOW**

Paid public launch: **NO / RED**

Technical app integrity: **NO CURRENT RED FLAGS SEEN**

## Why Controlled Beta Is GO / YELLOW

- No controlled-beta P0 blocker found.
- Public load, mobile-ish smoke, auth, account switching, free cap, route/geocode gating, checkout gating, premium state, functions, rules, and emulator tests passed.
- Lemon remains test-mode locked.
- Coupon model is Lemon-only and no app-side code box remains.
- Firebase Hosting does not serve internal docs/plans/legal reports.
- No tracked debug logs, auth storage states, service-account JSON, or private-key JSON files were found.
- Carter confirmed budget alerts/manual monitoring are done.
- Current code blocks direct client leaderboard writes and routes score sync through the server callable.
- Current code routes normal feedback through the server callable and denies direct client feedback writes.

Yellow conditions:

- Current workspace should be clean and committed before deploy.
- Public GitHub exposure remains a documented Carter decision.
- Legal/business review remains pending before paid public launch.

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
- [x] Confirm budget/monitoring checklist. Carter confirmed done on 2026-05-15.
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
