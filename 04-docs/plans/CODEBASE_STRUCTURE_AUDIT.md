# BARK Ranger Map Codebase Structure and Maintainability Audit

Date: 2026-05-09
Scope: structure, maintainability, launch risk, and cleanup sequencing before private beta / public launch.
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1c6587a41371fb1b95c48392970189d1ac0782cf`

This is an engineering audit, not a refactor. No app behavior was changed.

## 1. Executive Summary

The codebase is good enough for a controlled 5-10 tester private beta if the existing hardening branch is deployed with the matching Firestore rules and Functions. It is not yet professional enough for a broad paid public launch without more cleanup, operational testing, and a few structural fixes.

Blunt read: this is a normal fast-moving solo product codebase. It is not a disaster. It is also not a cleanly layered production SaaS app. The app works because a lot of modules cooperate through `window.BARK`, script load order, shared globals, DOM IDs, and Firebase snapshots. Recent hardening made the money/security paths much safer, but the app remains fragile to careless edits.

Overall score: **66 / 100**

Professional enough for 5-10 private testers: **YES, YELLOW/GREEN**
Professional enough for paid public launch: **NO, RED/YELLOW**

Do not rewrite everything before beta. The right move is to keep the hardened safety controls, run the test gates, and clean the highest-risk seams in stages.

## 2. Repo Map

| Area | Main Files | Responsibility | Depends On / Used By | Clean/Mixed/Tangled | Risk |
|---|---|---|---|---|---|
| Frontend entry | `index.html`, `core/app.js` | Static app shell, script loading, boot guard, map startup | Every module loaded by script tags | Mixed | Medium |
| Global state/config | `modules/barkState.js`, `state/appState.js`, `state/settingsStore.js`, `modules/launchFlags.js` | Shared defaults, feature flags, settings mirrors, legacy window state | Nearly all frontend modules | Tangled but improving | High for refactors |
| Data/catalog | `modules/dataService.js`, `repos/ParkRepo.js`, `assets/data/bark-fallback.csv` | Google Sheets CSV/fallback loading and park repository | Map, search, render, profile, trip planner | Mostly clean now | Medium |
| Map/rendering | `modules/mapEngine.js`, `modules/renderEngine.js`, `modules/MarkerLayerManager.js`, `modules/TripLayerManager.js`, `MapMarkerConfig.js`, `renderers/panelRenderer.js` | Leaflet map, marker layers, panel rendering, visited/trip visuals | State, repos, premium gates, search | Mixed | Medium |
| Search/geocode | `modules/searchEngine.js`, `services/orsService.js` | Local search, premium global town geocode, inline trip search | ParkRepo, ORS callable, paywall | Mixed | Medium |
| Auth/account | `services/authService.js`, `services/authAccountUi.js` | Firebase init, auth lifecycle, account UI, email verification, cloud settings hydration | Firebase SDK, user docs, premiumService, VaultRepo | Tangled | High |
| Entitlement/paywall | `services/premiumService.js`, `modules/paywallController.js`, `services/authPremiumUi.js` | Normalize Premium state, paywall UI, Lemon checkout flow, gating UI | Auth, Functions, Firestore entitlement | Mixed, much safer after hardening | High |
| User progress | `repos/VaultRepo.js`, `services/checkinService.js`, `services/firebaseService.js` | Local visit store, 5-free cap UI, Firestore visited writes, route persistence | Auth, rules, profile, map | Mixed | High |
| Profile/leaderboard | `modules/profileEngine.js`, `renderers/leaderboardRenderer.js`, `gamificationLogic.js` | Stats, achievements, rank, leaderboard pagination/sync | Firebase, VaultRepo, scoring utils | Tangled | Medium/High |
| Trip planner | `engines/tripPlannerCore.js`, `renderers/routeRenderer.js` | Manual trip days/stops, route generation, saved route UI | Search, ORS, Firebase, premiumService | Tangled | Medium |
| Backend Functions | `functions/index.js` | ORS callables, Lemon checkout/webhook, disabled legacy access-code callable, leaderboard sync, admin Gemini/Sheets | Firebase Admin, Lemon, ORS, Google APIs | Too large | High |
| Firestore rules | `firestore.rules` | Client access boundaries for user docs, saved routes, leaderboard, legacy access-code collections, system docs | Firebase deployment | Clean/compact | Medium |
| Tests | `functions/tests/*`, `tests/rules/*`, `tests/*.test.js`, `tests/playwright/*` | Unit, rules, emulator, browser smoke and signed-in flows | Node 20, emulators, Playwright auth states | Strong but environment-dependent | Medium |
| Plans/docs | `plans/*`, `HARDENING_PROGRESS.md`, `ACTION_TRACKER.md` | Launch/hardening/legal/QA records | Humans only; ignored by Hosting | Useful but voluminous | Low |
| Assets/data/images | `assets/data/*`, `assets/images/*`, root `data/*` | Fallback data, logos/images, snapshots | Hosted assets and docs | Mixed provenance | Legal/product risk |

## 3. Architecture Quality Scores

| Dimension | Score | Evidence |
|---|---:|---|
| Frontend modularity | 58 | Many modules exist, but `window.BARK`, raw `window.*`, and script order are the integration layer. `index.html:1430-1473` loads 30+ scripts directly. |
| Backend/functions organization | 55 | `functions/index.js` is about 2,060 lines and includes ORS, Lemon, legacy access-code compatibility, leaderboard, Gemini, and Sheets in one file. |
| Firebase/Auth/Firestore separation | 62 | Firestore CRUD is partly in `services/firebaseService.js`, but auth hydration and user-doc listener logic still live in `services/authService.js`. |
| Entitlement/payment separation | 72 | `premiumService.js` is a clear read-side source; Functions write entitlement server-side; UI states are centralized in paywall/account code. |
| Testability | 76 | Strong functions/rules/Playwright coverage exists, with explicit storage-state skips. Still tied to local server/auth state setup. |
| Readability | 62 | File names are understandable, but large files and inline HTML/style strings make local reasoning slow. |
| Launch safety | 74 | Kill switches, rate limits, server-side free cap, server-authoritative leaderboard, and test-mode Lemon lock are strong. |
| Maintainability | 60 | Acceptable if changes stay scoped. Risky if features continue to be added into existing large files. |
| Security/data integrity structure | 72 | Entitlement/legacy access-code/leaderboard/rate-limit paths are server-authoritative/protected. Achievements and walk inputs remain lower-trust/cosmetic. |
| Debug production issues | 64 | Many explicit logs and docs exist, but global state and duplicated listeners make root cause analysis harder. |

Overall: **66 / 100**

## 4. Tangling and Coupling Audit

| Issue | Evidence | Why It Matters | Severity | Private Beta Blocker? | Paid Launch Blocker? | Recommended Fix |
|---|---|---|---|---|---|---|
| Script-tag architecture relies on global load order | `index.html:1430-1473` loads utilities, repos, services, modules, renderers, then `core/app.js` | A missing/reordered script can break runtime in non-obvious ways | P2 | No | No, but document deployment discipline | Keep for beta; after launch consider ES module bundling or a formal boot registry. |
| Heavy `window.BARK` coupling | `modules/*`, `services/*`, `repos/*`, `engines/tripPlannerCore.js`; search found high usage in `tripPlannerCore`, `authService`, `mapEngine`, `searchEngine` | No contract enforcement; changes can create hidden side effects | P1 | No | Yes for long-term maintainability | Do not remove before beta; gradually wrap key services with stable APIs and tests. |
| Raw legacy globals remain | `window.currentWalkPoints`, `window.tripStartNode`, `window.tripEndNode`, `window.isAdmin`, `window._lastSyncedScore` in `modules/barkState.js`, `authService.js`, `profileEngine.js`, `tripPlannerCore.js` | Account switching and premium state can leak if reset paths miss one global | P1 | No, because tests cover current paths | Yes before major scale | Create an account-scoped runtime reset contract and add regression tests before migrating. |
| Duplicate user document listeners | `services/authService.js:821-885` listens to `users/{uid}`; `repos/VaultRepo.js:631` also subscribes for `visitedPlaces` | Duplicates initial and update reads; same doc drives unrelated concerns | P2 | No | No, but cost/noise grows | Later split `visitedPlaces` into subcollection or make one listener fan out. |
| Auth service does too many jobs | `services/authService.js` is 990 lines and handles Firebase init, auth UI visibility, cloud settings, premium entitlement, admin flag, walk points, route list loading, leaderboard boot | Hard to change account behavior safely | P1 | No | Yes for public launch polish | Extract user-doc hydration handlers after beta with tests. |
| Backend index file is too large | `functions/index.js` is about 2,060 lines; exports ORS, checkout, disabled legacy access-code callable, webhook, leaderboard, scheduled leaderboard, Gemini extraction, Sheets sync | New backend features will increase risk of accidental coupling | P1 | No | Yes before continued paid feature work | Split after private beta into `payments`, `legacyAccessCompat`, `ors`, `leaderboard`, `adminData`, `shared/entitlement`. |
| Inline HTML generation is widespread | `profileEngine.js`, `tripPlannerCore.js`, `routeRenderer.js`, `shareEngine.js`, `authService.js` use `innerHTML` for UI | Harder to sanitize and test; user/data-origin strings can slip into templates | P1/P2 | No if no new input paths are added | Yes for trust/privacy polish | For user-generated strings, prefer DOM construction/textContent or small escape helpers. |
| Feature flags exist in multiple layers | `modules/barkState.js`, `modules/launchFlags.js`, `services/orsService.js`, `modules/paywallController.js`, `functions/index.js` | Good defense-in-depth, but behavior must stay consistent | P2 | No | No | Keep; document flag names and add a one-page ops runbook. |
| Achievement writes remain client-owned | `gamificationLogic.js:230-269`, rules allow owner achievement writes with shape validation | Cosmetic spoofing remains possible | P2 | No | No unless achievements become competitive/rewarded | Mark achievements cosmetic until server-derived. |
| Walk/expedition points remain partly client-authored | `services/firebaseService.js:713-727`, `modules/expeditionEngine.js` modifies `window.currentWalkPoints` and user fields | Leaderboard direct writes are fixed, but some source inputs remain less trusted | P1/P2 | No | Yes if leaderboard is high-stakes | Server-derive or cap walk points before public leaderboard prizes/claims. |
| Public catalog data is outside Firestore | `modules/dataService.js`, `assets/data/bark-fallback.csv` | This is a cost win and simpler launch shape | Green | No | No | Keep. |
| Rules add paid saved-route check using `get/exists` | `firestore.rules:112-115` | Adds billed reads when saved route access is attempted | P2 | No | No | Acceptable because saved routes are lower-volume; document it. |

## 5. Payment and Entitlement Architecture Review

Current shape:

- Read-side Premium source: `services/premiumService.js`.
- Write-side Premium sources: Functions only, mainly Lemon webhook. The old `redeemAccessOrPromoCode` callable is now disabled for new redemptions.
- UI state: `modules/paywallController.js` and `services/authAccountUi.js`.
- Server enforcement: `functions/index.js` for checkout/route/geocode; `firestore.rules` for client writes.

Answers:

1. One clear source of truth for Premium? **Mostly yes.** The effective app answer is `premiumService.isPremium()` on the client and `normalizeEntitlement()` on the server.
2. Can Lemon accidentally downgrade legacy access-code Premium? **Tests and code are designed to prevent this.** `functions/index.js` has access-code fallback logic for existing records and webhook ordering/idempotency. Keep regression tests mandatory.
3. Can legacy access-code users accidentally see billing UI? **Current UI intends no.** Account billing logic checks entitlement source/status before showing billing controls.
4. Can unverified users bypass gates? **Server callables require verified email for checkout/premium route/geocode.** Client UI also blocks for password users.
5. Are UI and server entitlement logic consistent? **Mostly.** Both recognize active, manual active, past_due, cancelled_active, and active unexpired access_code. Risk is future drift because logic exists in both JS client and Functions.
6. Are entitlement states too complex? **Acceptable for private beta; complex for a solo project.** Lemon cancellation + refund + past_due + legacy compatibility is necessarily more than one boolean.
7. What should be simplified before public launch? Add an entitlement-state matrix document and one shared test fixture table. Do not invent another entitlement system.

Private beta recommendation: keep as-is, do not refactor payment code before 5-10 testers.

Public launch recommendation: split payment/legacy access-code compatibility logic out of `functions/index.js`, keep state machine tests, and add monitoring for webhook events.

## 6. Firestore and Data Model Review

| Path | Current Purpose | Structure Assessment | Risk |
|---|---|---|---|
| `users/{uid}` | Profile, settings, entitlement, visitedPlaces array, walk/expedition mirrors | Understandable but overloaded | Medium/High |
| `users/{uid}.entitlement` | Premium state from Lemon/manual/legacy access-code compatibility | Good boundary; client protected | Medium |
| `users/{uid}.visitedPlaces` | Embedded array of visits | Good for 5-free cap and beta; document-size risk for premium power users | Medium |
| `users/{uid}/savedRoutes/{routeId}` | Premium saved trips | Owner-scoped and premium-gated | Low/Medium |
| `users/{uid}/achievements/{achievementId}` | Client-generated achievements | Cosmetic trust only | Low/Medium |
| `leaderboard/{uid}` | Public leaderboard row | Now server-written only; reads unchanged | Low |
| `accessCodes/{codeHash}` | Deprecated legacy collection from the superseded internal-code experiment; new user-facing flow does not use it | Good; deny client read/write | Low |
| `accessCodeRedemptions/{redemptionId}` | Redemption receipts | Good; deny client read/write | Low |
| `_lemonSqueezyWebhookEvents/{id}` | Durable webhook idempotency | Good; default-denied by catch-all | Low |
| `_premiumCallableRateLimits/{id}` | Route/geocode rate limits | Good; default-denied by catch-all | Low |
| `feedback/{autoId}` | Former direct feedback path | Disabled/denied unless safely enabled | Low |
| `system/{docId}` | Public read-only docs such as leaderboard cache | Good | Low |

Answers:

1. Data model understandable? **Yes, but `users/{uid}` is overloaded.**
2. Server-only collections protected? **Yes.** Rules deny access codes, redemptions, leaderboard writes, and default unknown paths.
3. Client-write paths minimized? **Much better after hardening.** Client still writes settings, visited places within rules, saved routes for Premium, achievements, and some walk/profile fields.
4. Document-size risks? **Yes for premium `visitedPlaces` if unlimited use grows.** Not a beta blocker.
5. Free cap enforceable? **Yes, rules enforce 5 for non-premium direct writes.**
6. Leaderboard integrity fixed? **Direct fake totals are blocked. Source inputs still need trust hardening later.**
7. Stale collections? `system/leaderboardData` is generated but not fully used by frontend initial leaderboard; this is optimization work, not a blocker.
8. Index/query docs needed? Saved routes and leaderboard cursor queries should have a short Firestore query/index note before public launch.
9. Data-model changes to wait until after beta: moving `visitedPlaces` to subcollection and splitting `users/{uid}`.

## 7. Functions Backend Structure Review

Exported backend functions found in `functions/index.js`:

- `getPremiumRoute`
- `getPremiumGeocode`
- `createCheckoutSession`
- `redeemAccessOrPromoCode` (disabled for new user-facing redemptions)
- `getCustomerPortalUrl`
- `lemonSqueezyWebhook`
- `syncLeaderboardScore`
- `generateHourlyLeaderboard`
- `extractParkData`
- `syncToSpreadsheet`

Assessment:

- `functions/index.js` is too large at about 2,060 lines.
- It is safe enough for private beta because tests cover the high-risk areas.
- It is risky to keep adding payment/admin/data features to this file.
- Must split before paid public launch? **Not strictly before taking first payment, but strongly recommended before adding more paid features.**
- Tests are good enough to support a careful module split later if the split is mechanical and test-first.

Suggested later split:

- `functions/payments/checkout.js`
- `functions/payments/webhook.js`
- `functions/payments/legacyAccessCompat.js`
- `functions/entitlement.js`
- `functions/ors.js`
- `functions/leaderboard.js`
- `functions/adminData.js`
- `functions/testExports.js`

Do not do this before the first 5-10 testers unless a backend bug forces it.

## 8. Frontend UI Structure Review

Largest frontend files:

- `styles.css`: 3,260 lines
- `index.html`: 1,616 lines
- `engines/tripPlannerCore.js`: 1,472 lines
- `modules/searchEngine.js`: 1,095 lines
- `modules/expeditionEngine.js`: 1,068 lines
- `services/authService.js`: 990 lines
- `modules/paywallController.js`: 940 lines
- `services/authAccountUi.js`: 908 lines
- `modules/profileEngine.js`: 858 lines
- `services/firebaseService.js`: 773 lines
- `repos/VaultRepo.js`: 674 lines

UI code is professional enough for **5-10 testers** because the critical states now have tests and graceful failure paths. It is not polished enough for **paid public launch** because many UI states are embedded in large files with inline strings, inline styles, and direct DOM selectors.

Specific risks:

- `index.html` is both layout and modal inventory.
- `styles.css` is large enough that styling regressions are hard to localize.
- `paywallController.js` is central but large; keep it stable.
- `authAccountUi.js` handles auth forms, email verification, billing display, and subscription management.
- `profileEngine.js` mixes profile, achievements, leaderboard, rank celebration, and manage portal.
- `tripPlannerCore.js` has many inline DOM templates and raw global functions.

Good news:

- There is no app-side coupon box; users enter Lemon coupons on Lemon checkout.
- Premium route/geocode never sends ORS secrets to the browser.
- Saved routes are now Premium-gated in UI and rules.
- Public map/search is not forced into auth/payment.

## 9. Test Quality Review

Test inventory:

- Functions unit tests: `functions/tests/ors-entitlement.test.js`, `checkout-session.test.js`, `lemonsqueezy-webhook.test.js`, `leaderboard-sync.test.js`, `lemon-coupon.test.js`.
- Functions emulator: `functions/tests/ors-callable-emulator.test.js`.
- Firestore rules: `tests/rules/firestore-entitlement.rules.test.js`.
- Node/browserless unit-ish tests: scoring, data integrity, auth account UI, route renderer, VaultRepo, trip planner, gamification.
- Playwright public smoke: identity, fallback data, settings nav, static UI, Lemon coupon checkout.
- Playwright signed-in smoke: free cap, route gating, premium gating, account switching, settings persistence, profile/manage, trip planner visited styling, Lemon/legacy entitlement.

Strengths:

- The riskiest launch work has tests: payment state machine, checkout test mode, Lemon coupon checkout, leaderboard sync, rules, free cap, route/geocode entitlement/rate limits, kill switches.
- Signed-in Playwright tests document how to skip when storage states are missing.
- Rules tests are now much stronger than the original launch audit state.

Weaknesses:

- Signed-in Playwright depends on ignored local storage states under `playwright/.auth`.
- Full Playwright matrix is slow and environment-dependent.
- Mobile coverage exists but is smoke-level, not full device QA.
- No single `npm test` root command runs all non-Playwright tests.

Recommended test gates:

Private beta gate:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:functions:emulator
BARK_E2E_BASE_URL=http://localhost:4173/index.html npx playwright test tests/playwright/bark-app-identity-smoke.spec.js tests/playwright/bug004-static-fallback-data-smoke.spec.js tests/playwright/lemon-coupon-checkout-smoke.spec.js tests/playwright/stage0-launch-flags-smoke.spec.js --workers=1 --reporter=list
```

Pre-expansion gate:

```bash
BARK_E2E_BASE_URL=http://localhost:4173/index.html \
BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json" \
BARK_E2E_STORAGE_STATE_B="$PWD/playwright/.auth/free-user-b.json" \
BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json" \
npm run test:e2e:smoke
```

Paid launch gate:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:rules
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm run test:functions:emulator
BARK_E2E_BASE_URL=https://YOUR-STAGING-URL/index.html \
BARK_E2E_STORAGE_STATE="$PWD/playwright/.auth/free-user.json" \
BARK_E2E_STORAGE_STATE_B="$PWD/playwright/.auth/free-user-b.json" \
BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/playwright/.auth/premium-user.json" \
npm run test:e2e:smoke
```

Paid launch also needs live-mode Lemon RC tests only after Carter explicitly approves.

## 10. Professionalism / Launch Readiness

GREEN:

- Public catalog browsing is cheap and simple because park data is CSV/static, not Firestore.
- Firestore rules are compact and deny server-only collections.
- Premium route/geocode secrets stay server-side.
- Lemon remains hard-locked in test mode.
- Access-code and payment lifecycle tests are strong.
- Leaderboard direct fake writes are blocked.
- Feature flags and kill switches exist.

YELLOW:

- `window.BARK` global topology is acceptable for beta but fragile.
- `users/{uid}` is overloaded.
- Saved route and visited-place flows work but are cross-module.
- Signed-in Playwright storage states are necessary and easy to forget.
- Inline HTML/style strings increase UI regression risk.
- `functions/index.js` can stay for beta but should not keep growing.

RED:

- Not ready for broad paid public launch until legal/trademark/data rights, budget alerts/ops, live Lemon RC switch, support/refund docs, and full signed-in staging tests are complete.
- Do not add more payment/entitlement logic without splitting or at least isolating tests.
- Do not market leaderboard as high-trust competition while walk/achievement source inputs remain client-authored.

## 11. Required Fixes by Launch Phase

See `plans/CODEBASE_LAUNCH_RISK_REGISTER.md` for the table version.

P0 before 5-10 private testers:

- No code-structure P0 found in this audit. Deploy only the current hardened branch with matching Functions and Firestore rules, and run the private beta gate.

P1 before 25-50 broader beta:

- Write a short feature-flag/rollback runbook.
- Make signed-in Playwright storage-state generation part of release prep.
- Document Firestore query/index assumptions.
- Decide whether feedback stays disabled or gets a safe callable.
- Add one production-debug checklist for account/premium/visit state.

P2 before paid public launch:

- Split `functions/index.js` into payment/legacy-access-compat/ORS/leaderboard/admin modules.
- Reduce `authService.js` responsibility or at least isolate user-doc snapshot hydration.
- Add entitlement-state matrix docs/tests that cover UI + server together.
- Add budget/monitoring/runbook work.
- Decide how serious leaderboard/walk/achievement trust needs to be.

P3 after launch:

- Move toward ES modules or a typed app-service registry.
- Split `styles.css`.
- Migrate `visitedPlaces` to a subcollection if premium users create very large arrays.
- Replace inline HTML in trip/profile/share code with safer render helpers.

## 12. Do-Not-Touch Before Beta

| Area | Why Not Touch Now | Tests Needed Before Later Refactor |
|---|---|---|
| Map rendering and marker layers | Complex Leaflet state; currently works and is performance-sensitive | Public map smoke, mobile viewport, cluster/zoom tests, visited styling |
| VaultRepo visited reconciliation | Account switching and pending mutation rollback are subtle | VaultRepo unit tests, free cap Playwright, account-switch tests |
| Auth switch handling | Risk of leaking premium/visited state between accounts | Account-switch matrix, premium/free storage-state tests |
| Paywall/checkout controller | Payment UX is sensitive and recently tested | Lemon coupon checkout Playwright, checkout unit tests, account UI billing states |
| Route planner core | Large and global-heavy, but user-facing and working | Route bookends, saved routes, trip visited styling, mobile smoke |
| Leaderboard UX | Pagination is already good and recently hardened server-side | Leaderboard initial/See More Playwright and leaderboard sync unit tests |

## 13. Commands Run

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
find . -name "*.js" -not -path "./node_modules/*" -not -path "./functions/node_modules/*" -print
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node -e "...package/config summary..."
find assets -maxdepth 3 -type f | sort
(find . -name "*.js" ...; find . -name "*.css" -o -name "*.html" -o -name "*.rules" ...) | wc -l/sort
rg -n "window\\.|window\\.BARK|globalThis|localStorage|sessionStorage|TODO|FIXME|HACK|legacy|deprecated|onSnapshot|addEventListener|setInterval|setTimeout|innerHTML|eval|Function\\("
rg -n "premium|entitlement|access_code|lemon|checkout|billing|customer_portal|test_mode"
rg -n "leaderboard|visitedPlaces|savedRoutes|achievements|rateLimit|accessCodes"
rg -n "exports\\.[A-Za-z0-9_]+|functions\\.https|onRequest|onCall|pubsub|scheduler|runWith" functions/index.js
rg -n "<script|<link|paywall|coupon|account-verification|profile-premium|leaderboard|saved-routes|map" index.html
rg -n "match /|function |allow |get\\(|exists\\(" firestore.rules
find tests functions/tests -maxdepth 3 -type f | sort
rg -n "BARK_E2E|storage state|storageState|\\.auth|skip|test\\.skip|process\\.env" tests/playwright scripts/save-playwright-storage-state.js playwright.config.js
git diff --check
rg -n '^(<<<<<<<|=======|>>>>>>>)' plans/CODEBASE_STRUCTURE_AUDIT.md plans/CODEBASE_LAUNCH_RISK_REGISTER.md plans/CODEBASE_CLEANUP_ROADMAP.md
git ls-files | grep -E '(^|/)(firebase-debug\\.log|firestore-debug\\.log|.*\\.log$|\\.env$|\\.env\\.|.*serviceAccount.*|.*service-account.*|.*private.*key.*|playwright/\\.auth|tests/\\.auth|storageState)'
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
```

Validation result for this report-only change:

- `git diff --check`: passed.
- Conflict-marker search in the new docs: passed.
- Tracked sensitive-file pattern check: only `.env.example` matched.
- `npm --prefix functions test`: passed, 111/111 tests.

## 14. Final Recommendation

Use the current codebase for 5-10 private testers after running the private beta gate and deploying matching Hosting, Functions, and Firestore rules. Do not rewrite before that.

Do not treat this as paid-public ready. The launch blockers are not "the map code is too ugly"; they are operational/legal/payment/live-mode confidence, plus the need to stop piling new logic into oversized global files.
