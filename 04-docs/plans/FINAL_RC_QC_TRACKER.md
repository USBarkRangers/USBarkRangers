# Final RC QC Tracker

Date: 2026-05-09 local
Scope: final release-candidate QC for 25-50 controlled users and paid-public readiness, with Lemon Squeezy still locked in test mode.
Branch checked: `main`
Commit checked: `2bbde92982c07e8e03a39fb82469c7ddd5cd8962`

## Guardrails

- Do not switch Lemon live mode.
- Do not remove Carter approval lock.
- Do not add features or refactor.
- Fix P0 blockers only.
- Document P1/P2 backlog without chasing it during this QC.

## RC State Checklist

| Area | Result | Notes |
|---|---|---|
| Git state | PASS with caveat | Workspace is intentionally dirty with current RC hardening/docs/test changes. Commit before deploy. |
| Lemon-only coupons | PASS | No user-facing app code box. Coupons belong on Lemon checkout. |
| App-side Promo / Access Code removed | PASS | Playwright verifies no modal field/input/button exists. |
| Admin/mod free access model | PASS | Documented as 100% off Lemon discounts, not app-side grants. |
| Premium activation source | PASS | Checkout creation does not grant entitlement; webhook does. |
| Lemon test-mode lock | PASS | `checkoutTestMode: true`; `acceptLiveWebhooks: false`. |
| Carter approval lock | PASS | Present in code/docs. |
| Public app basics | PASS | Public load/static fallback/mobile-ish smoke passed. |
| Auth/account switching | PASS | Auth UI, sign-out, premium/free state isolation, and account switch tests passed. |
| Email verification gates | PASS | Unit and Playwright coverage passed. |
| Free 5-visit cap | PASS | Playwright confirms 5th allowed, 6th denied, unmark allowed, premium can exceed. |
| Route/geocode premium gates | PASS | Unit, emulator, and Playwright coverage passed. |
| Firestore rules/security | PASS | Rules suite passed 27/27. |
| Leaderboard integrity | PASS | Unit tests confirm server-authoritative sync and fake client totals ignored. |
| Feedback path | PASS | Callable tests passed; direct client feedback writes remain denied. |
| Internal docs Firebase Hosting exposure | PASS | Hosting ignores `plans/**`, `docs/**`, `**/*.md`, tests, functions, Playwright, logs. |
| Tracked sensitive files | PASS | Tracked path scan reported only `.env.example`. |
| Ops runbooks | PASS | Budget, App Check, rollback/kill-switch, monitoring, and production ops docs exist. |
| Public legal drafts | PASS | Privacy, terms, refund/cancellation, support, attribution drafts exist and remain under `plans/`. |
| Live-mode plan | PASS | Checklist, env vars, rollback, and test transaction docs exist. |

## Commands And Results

| Command | Result |
|---|---|
| `git status --short` | PASS documented dirty workspace. |
| `git rev-parse --abbrev-ref HEAD` | `main` |
| `git rev-parse HEAD` | `2bbde92982c07e8e03a39fb82469c7ddd5cd8962` |
| `git diff --check` | PASS |
| `rg -n "^(<<<<<<<\|=======\|>>>>>>>)" --glob "!node_modules/**" --glob "!functions/node_modules/**"` | PASS, no conflict markers. |
| Tracked sensitive path scan | PASS, only `.env.example`. |
| Secret keyword scan | PASS with caveat: expected config/docs references only; no tracked private-key/service-account/auth-state file. |
| `npm --prefix functions test` | PASS: 112/112. |
| `node --test tests/*.test.js` | PASS: 53/53. |
| `npm run test:rules` | PASS: 27/27. |
| `FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run test:functions:emulator` | PASS: 10/10. |
| Focused Playwright RC smoke | PASS: 38/38. |

Focused Playwright command:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" \
BARK_E2E_BASE_URL="http://localhost:4173/index.html" \
BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json" \
BARK_E2E_STORAGE_STATE_B="$PWD/playwright/.auth/free-user-b.json" \
BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json" \
npx playwright test \
  tests/playwright/bark-app-identity-smoke.spec.js \
  tests/playwright/bug004-static-fallback-data-smoke.spec.js \
  tests/playwright/final-mobile-console-beta-sweep.spec.js \
  tests/playwright/account-auth-smoke.spec.js \
  tests/playwright/lemon-coupon-checkout-smoke.spec.js \
  tests/playwright/phase3a-premium-gating-smoke.spec.js \
  tests/playwright/phase3a-account-switch-smoke.spec.js \
  tests/playwright/bug015-free-visited-limit-smoke.spec.js \
  tests/playwright/bug016-route-generation-gating-smoke.spec.js \
  tests/playwright/phase4c-premium-entitlement-smoke.spec.js \
  tests/playwright/phase4c-global-search-entitlement-smoke.spec.js \
  --workers=1 --reporter=list
```

## P0 Blockers

None found.

## Bugs Fixed During This QC

None. No P0 fix was needed.

## P1 Backlog

- Commit the exact RC changes before deploy so the release maps to a clean commit.
- Use `FUNCTIONS_DISCOVERY_TIMEOUT=60` for the callable emulator gate; default discovery has timed out previously.
- Complete manual budget alerts, post-deploy monitoring, and rollback/kill-switch readiness before inviting 25-50 users.
- Keep public GitHub exposure cleanup as a Carter decision. Firebase Hosting is protected, but public GitHub visibility is separate.
- Avoid sharing raw Firebase emulator logs externally; the CLI can echo local environment values while tests run.

## P2 Backlog

- Upgrade local Java to 21 before Firebase tools v15 requires it.
- Clean older internal planning docs after the RC is committed.
- Continue legal/trademark/data-source review before paid public launch.

## Current Recommendation

- 25-50 controlled users: **YELLOW / GO after commit + manual ops checks**.
- Paid public launch: **RED / NO** until Carter approves live mode, live Lemon smoke/refund/cancel testing is complete, legal/brand/privacy work is cleared, and public GitHub/doc exposure decisions are made.
