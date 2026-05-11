# Final Private Beta QC Report

Date: 2026-05-09

Source of truth: `plans/LAUNCH_READINESS_FIREBASE_COST_REPORT.md`, `HARDENING_PROGRESS.md`, `plans/PARTS_1_6_QC_AUDIT.md`, and recent hardening docs.

## 1. Executive Summary

Final QC found one real test-suite drift issue and no new runtime P0 blockers for a 5-10 person private beta. The stale emulator fixture was fixed, rerun, and now explicitly proves unverified email/password users are blocked from premium ORS callables.

Lemon Squeezy remains locked in test mode. Checkout payloads still force `attributes.test_mode: true`, live-mode webhook events are ignored, and the Carter approval lock remains documented. No Playwright auth states, local secret files, or test-results are tracked by this QC change.

## 2. Launch Colors

- Private beta, 5-10 named testers: **GREEN**, assuming this branch plus Functions and Firestore rules are deployed together.
- Broader Facebook/admin beta: **YELLOW**, mainly because budget alerts/App Check/live provider re-skim are still operational tasks.
- Paid public launch: **RED**, because Lemon live mode is intentionally locked and final live payment verification is not approved or run.

## 3. Branch and Commit Tested

- Branch: `codex/promo-access-code-premium`
- Base commit tested: `fe99f4bc662ba9da181b604592961f97f74e1052`
- QC state: base commit plus the in-scope QC test/doc changes listed below.

## 4. Files Changed During QC

- `functions/tests/ors-callable-emulator.test.js`
- `plans/FINAL_PRIVATE_BETA_QC_TRACKER.md`
- `plans/FINAL_PRIVATE_BETA_QC_REPORT.md`

No runtime app code, payment mode, checkout behavior, promo/access-code architecture, Firestore rules, or unrelated systems were changed during this final QC.

## 5. Commands Run

| Command | Result |
|---|---|
| `git status -sb` | Pass; only QC files/test edits remain dirty. |
| `git rev-parse --abbrev-ref HEAD` | Pass: `codex/promo-access-code-premium`. |
| `git rev-parse HEAD` | Pass: `fe99f4bc662ba9da181b604592961f97f74e1052`. |
| `git diff --check` | Pass. |
| Conflict-marker search | Pass. |
| `npm ls --depth=0` | Pass. |
| `npm --prefix functions ls --depth=0` | Pass. |
| `node --check` on high-risk JS files | Pass. |
| `npm --prefix functions test` | Pass: 111/111. |
| `npm run test:rules` | Pass: 26/26. Java 18 warning remains for future Firebase Tools v15. |
| `npm run test:functions:emulator` first run | Fail: 1/9, stale unverified-user fixture. |
| `npm run test:functions:emulator` rerun | Pass: 10/10 after fixture/test fix. |
| `node --test tests/*.test.js` | Pass: 53/53. |
| Full signed-in Playwright smoke on `127.0.0.1` | Invalid setup run; auth states are `localhost` origin-bound. |
| Full signed-in Playwright smoke on `localhost` | Pass: 41/41. |
| Targeted Playwright auth/promo/flags/mobile/entitlement sweep | Pass: 22/22. |

Final passing automated count after the fix: **263 tests passed** across functions, rules, emulator, unit, and browser suites.

## 6. New Tests Added

- Added emulator coverage proving unverified email/password users are rejected before entitlement checks or ORS/geocode work.
- Updated the emulator signed-in user fixture so entitlement/rate-limit tests use verified email/password users by default.

## 7. Manual Checks Performed

- Confirmed `functions/index.js` still sets Lemon checkout `attributes.test_mode: true`.
- Confirmed webhook mapping ignores `attributes.test_mode !== true`.
- Confirmed Carter approval lock remains documented in launch/progress docs.
- Confirmed no `playwright/.auth`, `functions/.secret.local`, `node_modules/.cache/bark-e2e`, or `test-results` files are tracked.
- Searched for direct client leaderboard writes; client now calls `syncLeaderboardScore`, while reads/pagination remain unchanged.
- Confirmed Firestore rules deny direct leaderboard writes, access-code writes, access-code redemption writes, entitlement writes, and server-only rate-limit docs.
- Confirmed free visit policy is 5 in client UI/tests/rules.
- Confirmed saved route save/load is premium-gated in browser smoke.
- Superseded note: the app-side `Promo / Access Code` box was later removed. Coupons are now entered on Lemon checkout only.
- Confirmed legacy access-code users, if any exist, still show no auto-renew, no payment method, and no Manage Billing.

## 8. Bugs Found and Fixed

- **P1 test drift:** ORS callable emulator tests created unverified email/password users after email verification became enforced. Fixed by verifying default test users and adding an explicit unverified rejection test.
- **Setup false alarm:** signed-in Playwright smoke initially timed out on `127.0.0.1` because storage states were generated for `localhost`. Rerun on `http://localhost:4173/index.html` passed 41/41.

## 9. Bugs Found and Not Fixed

- **P2 repository hygiene:** `firebase-debug.log` is historically tracked even though `.gitignore` excludes it. The QC-modified copy was restored and no debug-log change is included here. Remove it from tracking/history in a separate cleanup if desired.
- **P2 cosmetic integrity:** achievements remain client-writable/cosmetic. This does not block private beta because it does not grant payment, access-code, route/geocode, or leaderboard authority.
- **P1 operational:** real Lemon test-mode dashboard/API cancellation was not executed in this local QC because no Lemon test API credential/dashboard action was used. Unit fixtures cover cancellation/expiration/refund behavior.

## 10. Security Rules Status

Rules tests passed 26/26. Confirmed:

- Clients cannot write entitlement/premium/subscription/provider/admin fields.
- Clients cannot write other users' user docs.
- Free users cannot write `visitedPlaces` above the 5-visit cap unless entitlement is active.
- Expired access-code users cannot write above the free cap.
- Clients cannot write `leaderboard/{uid}`.
- Clients cannot write `accessCodes`, `accessCodeRedemptions`, `_premiumCallableRateLimits`, or webhook event docs.
- Saved routes are owner-scoped and premium-gated.

Rules now use `exists()`/`get()` only for the saved-route premium gate, not for hot public map, leaderboard read, or basic visit paths.

## 11. Payment / Lemon Status

Payment is safer in test mode:

- Checkout remains test-mode only.
- Live webhook payloads are ignored while locked.
- Signature verification uses raw-body HMAC tests.
- Store and variant mismatches are rejected.
- Duplicate events are durable through processed webhook event receipts.
- Older out-of-order events do not overwrite newer entitlement state.
- `past_due` stays premium during grace.
- `subscription_cancelled` with future `ends_at` stays premium as `cancelled_active`.
- `subscription_expired` removes premium.
- Refund events set `refunded`.
- Manual/admin override and active access-code entitlements are not downgraded by Lemon cancellation/expiration/refund events.

Paid public launch remains blocked until Carter approves the live-mode RC switch and a real low-risk live transaction/refund smoke is run.

## 12. Access-Code Status

Coupon/access behavior was simplified after this QC:

- New user-facing flow: all codes are Lemon Squeezy discount codes entered on Lemon checkout.
- The app-side `Promo / Access Code` box is removed.
- The old `redeemAccessOrPromoCode` callable is disabled for new redemptions.
- Premium is granted only after Lemon webhook confirmation.
- Legacy `source: access_code` entitlements remain display/evaluation compatibility only.

Remaining admin task: Carter needs to create Lemon Squeezy test-mode discounts for admin/mod/VIP/support and launch coupons.

## 13. Email Verification Status

Email verification is covered:

- Account UI unit tests cover verification sent, unverified banner, resend cooldown, and refresh-to-verified.
- Lemon coupon checkout Playwright tests cover unverified users blocked before checkout.
- ORS emulator tests now cover unverified users blocked before premium callable work.
- Google sign-in users are not blocked by email/password-only verification checks.

## 14. Free Visit Cap Status

Current policy is 5 free tracked parks.

Verified:

- Free user can add the 5th park.
- Free user cannot add the 6th, even with fake `localStorage` premium.
- GPS check-in path is also blocked at the cap.
- Unmarking one visit allows another mark.
- Premium/test-entitlement user can exceed 5.
- Expired access-code user cannot exceed the free cap by direct rules write.

Existing users above the cap: they should keep existing data visible but cannot add more while free/expired; they can unmark to get back under the cap or regain Premium/access-code.

## 15. Leaderboard Integrity Status

Leaderboard direct spoofing is fixed for private beta:

- Client no longer writes `leaderboard/{uid}` directly.
- Client calls `syncLeaderboardScore`.
- Server calculates totals from user data and ignores fake client totals.
- Rules deny direct leaderboard writes.
- Initial load and See More pagination still pass and use the existing UX.

Remaining risk: the server calculation still trusts some user-owned source data such as walk/expedition state. Direct fake leaderboard totals are blocked; deeper anti-cheat can wait until broader launch planning.

## 16. Cost / Abuse Status

Cost controls are materially stronger:

- Kill switches cover checkout, route generation, premium geocode/global search, feedback, leaderboard See More/deep browsing, and risky premium tools.
- Route/geocode callables enforce auth, verified-email policy where applicable, premium entitlement, function flags, and rate limits before external ORS work.
- Free cap prevents unlimited free-user visited arrays in normal UI and rules paths.
- Leaderboard direct writes are server-authoritative.
- Public map/search still use CSV/fallback data, not Firestore.

Remaining cost tasks before broader beta: App Check, budget alerts/dashboard, and operational monitoring.

## 17. Remaining Launch Blockers

Private 5-10 tester blockers: **none found in this QC** after the emulator fixture fix, as long as Lemon stays in test mode and this branch/rules/functions are deployed together.

Broader beta blockers:

- Budget alerts and dashboards not confirmed.
- App Check not enforced.
- Real Lemon test-mode dashboard/API cancellation path not re-skimmed after deploy.
- Existing tracked `firebase-debug.log` should be cleaned up separately.

Paid public launch blockers:

- Lemon live mode remains locked by design.
- Carter has not approved the final RC switch.
- No real live low-risk transaction/refund smoke has been run.
- Chargeback/dispute event design remains provider-confirmation work.

## 18. Recommendation

Safe for 5-10 private testers: **Yes, GREEN**, after deploying Hosting, Functions, and Firestore rules from the same branch and keeping Lemon in test mode.

Safe for Facebook/admin broader beta: **Not yet; YELLOW** until budget alerts, App Check, monitoring, and one more deployed Lemon test-mode re-skim are complete.

Safe for paid public launch: **No; RED** until Carter explicitly approves the live-mode RC switch and live payment/refund validation passes.

## 19. Next 5 Tasks

1. Deploy this branch's Hosting, Functions, and Firestore rules together to the test/private-beta environment.
2. Run one deployed Lemon test-mode checkout/cancel/expire/refund re-skim using dashboard/API or webhook simulation.
3. Configure Google Cloud/Firebase budget alerts and a simple launch monitoring dashboard.
4. Enable/verify App Check for Firestore and Functions after confirming real clients pass.
5. Clean up tracked `firebase-debug.log` in a separate repo hygiene task, then proceed to broader-beta readiness review.

## 20. Final Lock Confirmations

- Lemon Squeezy remains `test_mode: true`.
- Carter approval lock still exists.
- No secrets, storage states, local auth files, or new debug logs are included in this QC commit.
- No app-side Promo / Access Code box exists; users enter coupons on Lemon checkout.
- New free/admin/mod/VIP codes should be Lemon Squeezy 100%-off discounts.
- Legacy access-code entitlements, if any, do not auto-renew and do not create Lemon subscriptions.
- Manage Billing is hidden for legacy access-code users.
- Paid Lemon users still have a billing/customer portal path.
