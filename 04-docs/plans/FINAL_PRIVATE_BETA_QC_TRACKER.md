# Final Private Beta QC Tracker

Date started: 2026-05-09

## 1. Current Branch and Commit

- Branch: `codex/promo-access-code-premium`
- Starting commit: `fe99f4bc662ba9da181b604592961f97f74e1052`
- Current audit status: In progress

## 2. Scope

Critical final private-beta QC audit using these source-of-truth docs:

- `plans/LAUNCH_READINESS_FIREBASE_COST_REPORT.md`
- `HARDENING_PROGRESS.md`
- `PARTS_1_6_QC_AUDIT.md`
- recent hardening docs in `plans/`

The audit covers public app basics, auth/account flows, email verification, Lemon Squeezy coupon checkout, Lemon Squeezy test-mode lifecycle handling, cancellation, free visit cap, premium tools, kill switches, route/geocode rate limits, leaderboard integrity, achievements, feedback, Firebase security rules, cost/abuse safety, and regression checks.

Hard locks:

- Do not switch Lemon Squeezy to live mode.
- Keep `attributes.test_mode: true`.
- Keep the Carter approval lock.
- Do not commit secrets, Playwright storage states, API keys, Firebase debug logs, or local auth files.
- Do not refactor unrelated systems.

## 3. Area Checklist

- [ ] A. Public app basics
- [ ] B. Auth and account creation
- [ ] C. Lemon coupon checkout system
- [ ] D. Admin/mod/VIP/support Lemon discounts
- [ ] E. Lemon Squeezy paid checkout
- [ ] F. Lemon subscription lifecycle
- [ ] G. Test-mode cancellation
- [ ] H. Free visit limit
- [ ] I. Premium tools and kill switches
- [ ] J. Route/geocode rate limits
- [ ] K. Leaderboard integrity
- [ ] L. Achievements and cosmetic systems
- [ ] M. Feedback/support
- [ ] N. Firebase security rules
- [ ] O. Cost and abuse safety
- [ ] P. Regression checks

## 4. Commands Run

| Command | Result | Notes |
|---|---|---|
| `git status -sb` | Pass | Worktree only had this new QC tracker at audit start. |
| `git rev-parse --abbrev-ref HEAD` | Pass | `codex/promo-access-code-premium` |
| `git rev-parse HEAD` | Pass | `fe99f4bc662ba9da181b604592961f97f74e1052` |
| `sed -n '1,220p' package.json` | Pass | Scripts inspected; repo has targeted E2E, rules, and emulator scripts. |
| `sed -n '1,220p' functions/package.json` | Pass | Functions unit suite is `NODE_ENV=test node --test ...`. |
| `rg --files tests \| sort` | Pass | Existing unit, rules, and Playwright suites mapped. |
| `rg --files functions/tests \| sort` | Pass | Functions tests mapped. |
| `ls -la playwright/.auth` | Pass | Free, premium, and second-account storage states exist locally; they must not be committed. |
| `git diff --check` | Pass | No whitespace errors in current QC diff. |
| Conflict marker search | Pass | No conflict markers found. |
| `npm ls --depth=0` | Pass | Root dependencies installed. |
| `npm --prefix functions ls --depth=0` | Pass | Functions dependencies installed. |
| `node --check` on launch/auth/payment/visit/leaderboard JS files | Pass | Syntax OK for audited high-risk JS files. |
| `npm --prefix functions test` | Pass | 107/107 passed before this cleanup. Covers checkout test mode, webhooks, legacy access-code compatibility, leaderboard sync, route/geocode limits. |
| `npm run test:rules` | Pass | 26/26 passed. Expected emulator permission-denied noise appears for denial assertions. Java 18 warning remains; Firebase Tools v15 will require Java 21. |
| `npm run test:functions:emulator` | Fail | 1/9 passed, 8 failed. Cause: emulator fixtures created unverified password users after email verification enforcement; product correctly returned `failed-precondition` before entitlement assertions. |
| `node --check functions/tests/ors-callable-emulator.test.js` | Pass | Syntax OK after emulator fixture update. |
| `npm run test:functions:emulator` rerun | Pass | 10/10 passed after verified-user fixture update and explicit unverified rejection test. |
| `node --test tests/*.test.js` | Pass | 53/53 passed. Covers account UI, email verification UI, data integrity, profile/leaderboard callable path, render safety, route account gate, search gating, and trip planner logic. |
| `BARK_E2E_BASE_URL=http://127.0.0.1:4173/index.html ... npm run test:e2e:smoke` | Invalid run | Interrupted after repeated signed-in timeouts. Root cause was test setup: saved Playwright auth states are origin-bound to `http://localhost:4173`, so `127.0.0.1` loaded the public app but no signed-in Firebase auth state. Rerun uses `localhost`. |
| `BARK_E2E_BASE_URL=http://localhost:4173/index.html ... npm run test:e2e:smoke` | Pass | 41/41 passed with free, premium/test-entitlement, and second-account storage states. Covers public load, fallback pins, free cap at 5, route gating, saved-route premium gate, premium product rules, settings, account switching, profile/manage, trip visited styling, and related regressions. |
| `npx playwright test account-auth + promo-access-code + stage0-launch-flags + final-mobile-console + phase4c global/premium entitlement` | Historical pass | 22/22 passed before the Lemon-only coupon simplification. The app-side promo/access-code UI was later removed and replaced by `tests/playwright/lemon-coupon-checkout-smoke.spec.js`. |
| `git diff --check` final rerun | Pass | No whitespace errors after QC edits. |
| Conflict marker search final rerun | Pass | No conflict markers found. |
| `git ls-files playwright/.auth node_modules/.cache/bark-e2e functions/.secret.local test-results` | Pass | No auth storage states, local secret files, or test-results are tracked. |

## 5. Bugs Found

- P1 test coverage drift: `functions/tests/ors-callable-emulator.test.js` expected free/premium entitlement errors for password users that were unverified. The product behavior is correct, but the emulator tests no longer represented verified users for entitlement/rate-limit paths.
- Setup-only Playwright false alarm: signed-in smoke timed out when run against `127.0.0.1` because local storage states are bound to `localhost`. Correct-origin rerun passed.

## 6. Fixes Made

- Updated `functions/tests/ors-callable-emulator.test.js` so entitlement/routing tests use verified email/password users by default, while adding an explicit unverified-user rejection test.
- Documented in this tracker that signed-in Playwright storage states must use the same origin they were generated for: `http://localhost:4173`.

## 7. Tests Added

- Added emulator coverage for unverified email/password premium callable rejection before entitlement/ORS work.

## 8. Remaining Risks

- `firebase-debug.log` is tracked in the repository even though `.gitignore` excludes it. The emulator-modified copy was restored before commit so this QC does not commit debug-log changes. Historical cleanup/removal should be handled separately if Carter wants a clean repository history.
- Real Lemon test-mode dashboard/API cancellation was not executed locally; webhook fixtures cover cancellation, expiration, refund, duplicate, out-of-order, and access-code preservation behavior.
- Broader-beta operational work remains: budget alerts, monitoring dashboard, App Check, and deployed Lemon test-mode re-skim.

## 9. Final Launch Recommendation

- Private beta for 5-10 named testers: GREEN after deploying this branch's Hosting, Functions, and Firestore rules together.
- Broader Facebook/admin beta: YELLOW until budget alerts, monitoring, App Check, and deployed Lemon test-mode cancellation/expiration re-skim are done.
- Paid public launch: RED until Carter explicitly approves the final Lemon live-mode RC switch and live low-risk payment/refund validation passes.
