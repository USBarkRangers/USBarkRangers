# BARK Ranger Map Release Freeze Status

Date: 2026-05-09 local
Scope: release-freeze check only; no new features, no refactors, only P0 blocker identification.
Branch checked: `main`
Commit checked: `2bbde92982c07e8e03a39fb82469c7ddd5cd8962`

## Executive Result

Status: **PASS / conditional deploy candidate**

No P0 release-freeze blocker was found in this pass.

The workspace is **not clean**, but the dirty state is documented and consists of the current intentional hardening/docs/test changes. Carter should commit the intended release-candidate changes before deploying so the deployed artifact maps to an exact commit.

Lemon Squeezy remains locked in test mode. Checkout payloads still use `test_mode: true`, live-mode webhooks are still ignored, and the Carter approval lock remains documented.

## P0 Blocker Checklist

| Check | Result | Evidence |
|---|---|---|
| App/load smoke | PASS | Focused Playwright identity and static fallback smokes passed. |
| Auth/sign-out/account switch smoke | PASS | Premium gating Playwright covered signed-out, signed-in free, premium/free storage-state isolation, and account-change cleanup. |
| Premium entitlement smoke | PASS | Functions tests, rules tests, emulator callable tests, and Playwright premium gating passed. |
| Lemon accidentally live | PASS | `functions/index.js` has `checkoutTestMode: true` and `acceptLiveWebhooks: false`. |
| Carter approval lock | PASS | `CARTER_APPROVED_LIVE_RC` lock and launch-report lock text remain present. |
| Firestore rules/security | PASS | Rules suite passed 27/27. |
| Coupon/checkout UX | PASS | Lemon-only coupon Playwright smoke passed; no app-side Promo / Access Code field is visible. |
| Debug logs tracked | PASS | Tracked sensitive-path scan returned only `.env.example`, which is intentionally tracked. |
| Auth storage states tracked | PASS | No tracked `playwright/.auth/**` or storage-state files found. Local storage states exist but are ignored. |
| Secrets tracked | PASS with caveat | Path scan found no tracked secret/auth/debug files. Keyword scan finds expected docs/config references and public Firebase config; no private-key/service-account file was tracked. |
| Internal legal docs hosted | PASS | `firebase.json` Hosting ignores `plans/**`, `docs/**`, `**/*.md`, logs, tests, Playwright files, and functions. |
| Deploy mismatch risk documented | PASS | This file documents dirty workspace and exact commit checked. |
| Lemon-only coupon model | PASS | Main runbook says codes are entered on Lemon checkout; Playwright confirms no app-side code box. |
| Policy/support drafts | PASS | `plans/legal-public-drafts/` drafts exist. |
| Ops runbook | PASS | `plans/PRODUCTION_OPS_RUNBOOK.md` exists. |
| Live-mode checklist | PASS | `plans/LEMON_LIVE_MODE_RC_CHECKLIST.md` exists. |
| Controlled release checklist | PASS | `plans/CONTROLLED_RELEASE_RC_CHECKLIST.md` and `plans/CONTROLLED_RELEASE_GO_NO_GO.md` exist. |

## Commands Run

| Command | Result |
|---|---|
| `git status --short` | PASS documented dirty workspace; not clean. |
| `git rev-parse --abbrev-ref HEAD` | `main` |
| `git rev-parse HEAD` | `2bbde92982c07e8e03a39fb82469c7ddd5cd8962` |
| `git diff --check` | PASS, no whitespace/conflict problems reported. |
| `rg -n "^(<<<<<<<\|=======\|>>>>>>>)" --glob "!node_modules/**" --glob "!functions/node_modules/**"` | PASS, no conflict markers found. |
| `git ls-files \| rg "(^|/)(firebase-debug\|firestore-debug\|.*\\.log$\|\\.env$\|\\.env\\.\|playwright/\\.auth\|storageState\|serviceAccount\|service-account\|service_account\|.*private.*key\|.*key.*\\.json$\|test-results\|playwright-report)"` | PASS, only `.env.example` reported. |
| `rg -l "BEGIN PRIVATE KEY\|PRIVATE KEY\|client_email\|serviceAccount\|service-account\|LEMONSQUEEZY_API_KEY\\s*=\|LEMONSQUEEZY_WEBHOOK_SECRET\\s*=\|ORS_API_KEY\\s*=\|GEMINI_API_KEY\\s*=\|AIza[0-9A-Za-z_-]{20,}" ...` | PASS with caveat: expected public config/docs references only; no tracked private-key/service-account/auth-state file. |
| `npm --prefix functions test` | PASS: 112/112 tests. |
| `npm run test:rules` | PASS: 27/27 tests. Java 18 deprecation warning from Firebase tools remains non-blocking. |
| `npm run test:functions:emulator` | First run FAIL: Functions discovery timed out after 10s and callable endpoint returned `not-found`. |
| `FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run test:functions:emulator` | PASS: 10/10 tests. Use this env var for the freeze gate until the emulator script is made less flaky. |
| Focused Playwright public/premium/checkout smoke | PASS: 18/18 tests. |

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
  tests/playwright/lemon-coupon-checkout-smoke.spec.js \
  tests/playwright/phase3a-premium-gating-smoke.spec.js \
  --workers=1 --reporter=list
```

## P0 Blockers Found

None.

## P1 / P2 Backlog

P1:

- Commit the intended release-candidate diff before deploying. Current workspace is not clean.
- Use `FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run test:functions:emulator` or bake that timeout into the gate, because the default emulator discovery timed out once.
- Complete manual GCP budget alerts and post-deploy monitoring setup before sustained 25-50 user usage.
- Keep public GitHub/internal docs cleanup on the near-term list; Firebase Hosting is protected, but GitHub public exposure is a separate issue.

P2:

- Upgrade local Java to 21 before Firebase tools v15 makes Java 18 unsupported.
- Clean older internal planning docs after the release candidate is committed.
- Continue legal/trademark/data-source review before paid public launch.

## Deploy Recommendation

Carter can deploy a **controlled release candidate** after committing the intended release-freeze changes and deploying Hosting, Functions, and Firestore rules together.

Recommended pre-deploy gate:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run test:functions:emulator
```

Recommended deploy command remains:

```bash
firebase deploy --only hosting,functions,firestore:rules
```

## Final Confirmations

- Lemon Squeezy remains `test_mode: true`.
- Live webhooks remain ignored while locked.
- Carter approval lock remains present.
- Coupon model is Lemon-only for users.
- No app-side `Promo / Access Code` box remains in the Premium modal.
- No debug logs, auth storage states, or service-account/private-key JSON files are tracked.
- Internal legal/QC/planning docs are ignored by Firebase Hosting.
