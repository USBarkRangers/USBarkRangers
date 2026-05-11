# BARK Ranger Map Codebase Launch Risk Register

Date: 2026-05-09
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1c6587a41371fb1b95c48392970189d1ac0782cf`

## Summary

No code-structure P0 was found that blocks a controlled 5-10 tester private beta. Paid public launch remains blocked by broader legal, operational, live-payment, monitoring, and maintainability risks.

## Risk Register

| Priority | Area | File / Path | Problem | Why It Matters | Recommended Fix | Difficulty | Change Risk | Tests Needed |
|---|---|---|---|---|---|---|---|---|
| P0 private beta | Deployment consistency | Hosting, Functions, Firestore rules | The current hardened branch must be deployed as a matching set | If Hosting is new but rules/functions are stale, free caps, saved-route gating, Lemon coupon checkout, or callables can appear broken | Deploy Hosting + Functions + Firestore rules from same commit; smoke test deployed URL | Small | Medium operational | Functions tests, rules tests, public smoke, key signed-in smoke |
| P1 broader beta | Rollback/flag clarity | `modules/barkState.js`, `modules/launchFlags.js`, `functions/index.js` | Kill switches exist but need an operator-facing runbook | During a Facebook/admin spike Carter needs fast exact switches | Add one runbook listing flags, env vars, behavior, and deploy/reload notes | Small | Low | Stage0 launch flags Playwright |
| P1 broader beta | Signed-in test discipline | `tests/playwright/*`, `scripts/save-playwright-storage-state.js` | Many critical tests require ignored auth storage states | Easy to accidentally skip signed-in coverage | Make release checklist require storage-state generation and full signed-in suite | Small | Low | Full smoke with free/free-b/premium states |
| P1 broader beta | Duplicate user-doc listeners | `services/authService.js:821-885`, `repos/VaultRepo.js:631` | Two listeners watch `users/{uid}` | Extra reads and duplicated state triggers | Leave for beta; later consolidate or split `visitedPlaces` | Medium | High | Account switch, visit lifecycle, premium UI |
| P1 broader beta | Feedback path | `modules/uiController.js`, `firestore.rules` | Feedback is denied/disabled unless flag/config path is set | Testers need a clear support channel | Either keep disabled with clean message or add a callable with validation/rate limit | Small/Medium | Medium | Feedback UI smoke + rules/function test |
| P1 broader beta | Production debug process | `services/authService.js`, `premiumService.js`, `VaultRepo.js` | Debugging account state requires knowing many globals/services | Slow support and risky manual diagnosis | Create a support/debug checklist: UID, entitlement, visits count, flags, function logs | Small | Low | Docs only |
| P2 paid launch | Oversized backend file | `functions/index.js` | About 2,060 lines mixes ORS, Lemon, legacy access-code compatibility, leaderboard, Gemini, Sheets | Payment code becomes harder to safely change | Split into modules after private beta | Medium/Large | Medium if test-first | Full functions suite + emulator + webhook tests |
| P2 paid launch | Auth service overload | `services/authService.js` | Auth lifecycle also hydrates settings, entitlement, admin, walk, leaderboard, route list | Account bugs can spread across app | Extract user snapshot hydration helpers | Medium | High | Account-switch, profile, settings, premium tests |
| P2 paid launch | Inline HTML and user strings | `profileEngine.js`, `tripPlannerCore.js`, `routeRenderer.js`, `shareEngine.js` | Many UI fragments use `innerHTML` | Injection/layout regressions are harder to reason about | Sanitize dynamic data or move to DOM builders gradually | Medium | Medium | Public smoke, route, profile, share tests |
| P2 paid launch | Entitlement logic duplication | `functions/index.js`, `services/premiumService.js`, `paywallController.js`, `authAccountUi.js` | Server and client both normalize states | Future state drift can break billing display | Add entitlement matrix fixtures shared by unit tests | Medium | Medium | Functions webhook/legacy-access + client unit tests |
| P2 paid launch | Source inputs for leaderboard | `modules/expeditionEngine.js`, `services/firebaseService.js`, `functions/index.js` | Direct leaderboard writes are fixed, but walk/source inputs are still less trusted | Public competitive leaderboard can still be gamed indirectly | Decide if leaderboard is cosmetic; otherwise server-derive/cap walk points | Medium/Large | Medium | Leaderboard sync tests + rules |
| P2 paid launch | `visitedPlaces` embedded array | `users/{uid}.visitedPlaces`, `firebaseService.js` | Premium power users can grow a user document | Document-size and write amplification risk | Keep for beta; migrate to subcollection if real usage grows | Large | High | Migration tests, account/visit tests |
| P2 paid launch | Legal/assets/data rights | `assets/images/*`, `assets/data/*`, root data snapshots | Source/permission unknown | Paid launch risk is legal/business more than code | Lawyer/provenance review | Medium | Low code | Docs/legal checklist |
| P2 paid launch | Functions runtime deprecation warning | `functions/package.json`, deploy logs in `HARDENING_PROGRESS.md` | Node 20 deploy warnings are documented | Future deploy risk | Plan runtime upgrade when Firebase supported target is chosen | Medium | Medium | Full functions/emulator suite |
| P3 post-launch | CSS size | `styles.css` | 3,260 lines in one stylesheet | Hard to safely adjust mobile/paywall/account styling | Split by map/account/paywall/profile/trip after launch | Medium | Medium | Visual Playwright screenshots |
| P3 post-launch | ES module/build system absence | `index.html` script tags | Global script order is the module system | Limits scaling team/code quality | Introduce bundler or ES modules only after tests are stable | Large | High | Full smoke, performance, deploy test |
| P3 post-launch | Achievement integrity | `gamificationLogic.js`, rules achievement paths | Client-writable achievements are cosmetic | Not a paid blocker unless rewards/prizes depend on it | Treat as cosmetic or server derive later | Medium | Medium | Achievement tests |

## Current Launch Colors

| Launch Stage | Color | Reason |
|---|---|---|
| 5-10 private testers | YELLOW/GREEN | Safety-critical gates are in place; remaining structure issues are manageable with careful deployment and test discipline. |
| 25-50 broader beta | YELLOW | Needs release checklist, support path, storage-state test discipline, and monitoring/budget ops. |
| Paid public launch | RED/YELLOW | Payment test mode intentionally remains locked, legal/data rights are unresolved, operational monitoring is incomplete, and maintainability needs staged cleanup. |
