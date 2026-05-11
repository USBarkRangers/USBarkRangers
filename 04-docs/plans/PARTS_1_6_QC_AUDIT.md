# Parts 1-6 QC Audit

Date: 2026-05-09  
Branch: `codex/payment-webhook-hardening-test-mode`  
Source of truth: `plans/LAUNCH_READINESS_FIREBASE_COST_REPORT.md`

## 1. Executive Pass/Fail Summary

Overall result: **PASS for Parts 1-6 private-beta hardening**, with paid/public launch still blocked.

Confirmed:

- Lemon Squeezy checkout remains test-mode-only.
- Live-mode webhook events are still ignored.
- Carter approval lock remains documented.
- Premium entitlement remains server-authoritative.
- Free tracked-visit enforcement is now server-backed through Firestore rules.
- Route/geocode premium checks and rate limits remain server-side.
- Kill switches disable risky UI paths gracefully and server flags block sensitive callables.
- Existing signed-out map browsing, local search, profile basics, settings, route gating, mobile smoke, and signed-in account flows still pass targeted Playwright checks.

Important policy note: the current implemented free tracked-visit cap is **5**, not 20. This follows the later owner request to bring the free account down to 5 across the board. Tests now verify 5/6 behavior, not 20/21 behavior.

Post-merge clarification: older free or expired accounts already above 5 are locked from adding or swapping over-limit visits, but can remove visits one at a time. Firestore rules now also treat `past_due` and `cancelled_active` as premium-active states, matching the payment-hardening policy.

## 2. Launch Readiness Color

| Launch scope | Color | Reason |
|---|---|---|
| 5-10 private testers, Lemon still in test mode | **YELLOW** | Much safer after kill switches, rules, rate limits, signed-in E2E, and webhook hardening. Still needs active monitoring and known risk acceptance. |
| Paid public launch | **RED** | Lemon live mode is intentionally locked, chargeback/dispute handling is not provider-confirmed, leaderboard scores are still client-authoritative, and final budget/ops checks remain. |

## 3. Files Changed Across Parts 1-6

Functional/test files changed in the roadmap stack:

- `modules/launchFlags.js`
- `modules/barkState.js`
- `modules/paywallController.js`
- `modules/profileEngine.js`
- `modules/searchEngine.js`
- `modules/uiController.js`
- `services/orsService.js`
- `services/authPremiumUi.js`
- `services/checkinService.js`
- `services/premiumService.js`
- `services/authAccountUi.js`
- `engines/tripPlannerCore.js`
- `renderers/panelRenderer.js`
- `functions/index.js`
- `firestore.rules`
- `functions/tests/checkout-session.test.js`
- `functions/tests/lemonsqueezy-webhook.test.js`
- `functions/tests/ors-entitlement.test.js`
- `functions/tests/ors-callable-emulator.test.js`
- `tests/rules/firestore-entitlement.rules.test.js`
- `tests/playwright/bug015-free-visited-limit-smoke.spec.js`
- `tests/playwright/bug016-route-generation-gating-smoke.spec.js`
- `tests/playwright/bug017-product-rules-audit-smoke.spec.js`
- `tests/playwright/stage0-launch-flags-smoke.spec.js`

Documentation/progress files changed in the roadmap stack:

- `ACTION_TRACKER.md`
- `BUDGET_ALERTS_CHECKLIST.md`
- `HARDENING_PROGRESS.md`
- `plans/LAUNCH_READINESS_FIREBASE_COST_REPORT.md`
- `plans/FAST_FIX_RELEASE_CANDIDATE_PLAN.md`
- related premium/bug audit plan docs.

QC conclusion: no unrelated runtime feature expansion was found in this pass. The changes stay within safety flags, premium gating, auth E2E, route/geocode limits, visit-limit enforcement, Lemon webhook hardening, and supporting docs/tests.

## 4. Test Commands Run And Results

Baseline:

- `git status --short` - clean before QC edits; generated logs cleaned after tests.
- `git diff --check` - PASS after generated logs were removed/reverted.
- `rg -n "^(<<<<<<<|=======|>>>>>>>)" ...` - PASS, no conflict markers.
- `node --check functions/index.js` - PASS.
- `node --check functions/tests/lemonsqueezy-webhook.test.js` - PASS.
- `node --check tests/playwright/stage0-launch-flags-smoke.spec.js` - PASS.
- `npm ls --depth=0` - PASS.
- `npm --prefix functions ls --depth=0` - PASS.

Backend:

- `npm --prefix functions test` - PASS, 82/82.
- `npm run test:rules` - PASS, 23/23 during the Parts 1-6 QC pass; follow-up free-cap edge-case QC PASS, 24/24. Note: firebase-tools emitted the existing Java 21 future-requirement warning while running on Java 18.
- `npm run test:functions:emulator` - PASS, 9/9. Same Java 21 future-requirement warning.

Playwright, local static server at `http://localhost:4173/index.html`:

- `stage0-launch-flags-smoke.spec.js` - PASS, 2/2.
- `bug017-product-rules-audit-smoke.spec.js`, `bug015-free-visited-limit-smoke.spec.js`, `bug016-route-generation-gating-smoke.spec.js`, `account-switch-premium-matrix.spec.js` - PASS, 13/13.
- `phase1b-visited-smoke.spec.js`, `phase3a-account-switch-smoke.spec.js`, `phase3a-premium-gating-smoke.spec.js`, `phase3a-profile-manage-smoke.spec.js`, `phase3a-settings-persistence-smoke.spec.js`, `phase3a-trip-planner-visited-smoke.spec.js`, `phase4c-premium-entitlement-smoke.spec.js`, `phase4c-global-search-entitlement-smoke.spec.js` - PASS, 23/23.
- Public/mobile regression group: app identity, fallback data, route bookends, route upgrade prompt, settings sync policy, cluster ghost, settings nav, custom stop save, route-only filter, fixed UI scroll guard, final mobile console sweep - PASS, 16/16.

## 5. New Tests Added In This QC Pass

- `tests/playwright/stage0-launch-flags-smoke.spec.js`
  - Verifies checkout, route planner/generation, premium geocode, leaderboard deep browse, feedback, and risky premium tools fail closed with friendly UI.
  - Verifies route/geocode callable wrappers can be re-enabled and reach callable stubs.
  - Verifies normal app identity and public park data still load with risky features disabled.

- `tests/rules/firestore-entitlement.rules.test.js`
  - Added explicit denial tests for `_premiumCallableRateLimits`.
  - Added explicit denial tests for `_lemonSqueezyWebhookEvents`.
  - Added explicit denial tests for direct `feedback` writes while feedback is app-disabled.

- `functions/tests/lemonsqueezy-webhook.test.js`
  - Added variant-mismatch coverage for signed test-mode webhook payloads when Lemon includes a variant ID.

## 6. Manual Checks Performed

- Confirmed checkout payload still sets `attributes.test_mode: true`.
- Confirmed webhook mapper still ignores `attributes.test_mode !== true`.
- Confirmed Carter approval lock remains in launch docs.
- Confirmed no Playwright storage states are tracked; `playwright/.auth/` is ignored.
- Confirmed storage states exist locally for free, premium/test entitlement, and second account.
- Confirmed no Lemon/ORS secret values were introduced in committed changes.
- Confirmed during Parts 1-6 QC that Firestore rules did not use `get()`, `exists()`, or `getAfter()`. Follow-up saved-route premium gating intentionally added `exists()`/`get()` only for premium saved-route entitlement checks.
- Confirmed generated `firebase-debug.log`, `firestore-debug.log`, `functions/.secret.local`, and `test-results/` artifacts were not included in the QC commit.

## 7. Bugs Found

Fixed during QC:

- `functions/index.js` had two same-scope `getHeaderValue` declarations. The webhook helper shadowed the ORS retry-header helper, which could make ORS `Retry-After` headers get ignored. Renamed the webhook helper to `getRequestHeaderValue`.
- Variant mismatch was not explicitly checked for Lemon Squeezy webhooks. Added a conservative check when `variant_id` or a variant relationship is present.
- Missing explicit rules coverage for server-only rate-limit/webhook receipt collections and feedback denial. Added tests.
- Missing app-side Stage 0 Playwright coverage for fail-closed/re-enabled kill-switch behavior. Added tests.

Not changed in this QC pass:

- Product ID mismatch is not explicitly checked because the code currently has a configured annual variant ID but no configured Lemon product ID. Variant and store mismatch are now covered; product mismatch needs provider payload/config confirmation before enforcing.

## 8. Regressions Found

No runtime regressions found after fixes. Targeted backend, rules, callable emulator, signed-in E2E, public smoke, and mobile-ish smoke tests passed.

## 9. Security/Data-Integrity Gaps Still Open

- Leaderboard totals are still client-authoritative. This remains a public-launch blocker if the leaderboard matters.
- Achievements remain client-writable and should stay cosmetic or become server-derived later.
- Chargeback/dispute-specific Lemon Squeezy event handling is still not provider-confirmed.
- Existing tracked `firebase-debug.log` is a repo hygiene issue from before this QC pass; no new generated log was included here.
- Public Firebase web config keys still exist in normal client config files. That is expected for Firebase web apps, but admin-page exposure should remain reviewed separately.

## 10. Cost/Abuse Risks Still Open

- Google Sheet polling kill switch was not implemented in Parts 1-6. The audit prompt asked to test it only if implemented.
- Route/geocode rate limits and kill switches are now in place, but App Check enforcement is still future work.
- Free-user visited arrays are capped at 5 by rules, but premium visited storage is still whole-array user-doc storage and should be watched as premium use grows.
- Exact leaderboard rank aggregation remains a watchlist item, not a launch blocker for the private beta.

## 11. Merge/Release Recommendation

Parts 1-6 are safe to merge/release to **5-10 private testers** with Lemon Squeezy still locked in test mode.

Do not use this as paid/public launch approval. Paid/public remains RED until the remaining payment live-mode, ops, leaderboard integrity, and provider edge-case items are closed.

## 12. Top 5 Next Fixes

1. Confirm Lemon Squeezy chargeback/dispute event design and add fixtures.
2. Make leaderboard scores server-derived before public leaderboard exposure.
3. Add App Check enforcement plan for Firestore and Functions.
4. Add budget alerts/monitoring before expanding beyond the current 10 testers.
5. Final RC only: Carter-approved live-mode switch and one low-risk real transaction/refund smoke.
