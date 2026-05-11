# Phase 4G Public Paywall UI Plan

Date: 2026-05-03

Status: planning only. This plan designs the real public-facing Lemon Squeezy paywall UI for the maintainer's internal testing branch/version only.

Readiness verdict: ready to implement Phase 4G.1 paywall modal shell and entitlement-state display in the internal testing version. Not ready for full checkout smoke, beta rollout, live mode, or money collection until the Lemon Squeezy test-mode backend functions are secret-configured, deployed with explicit approval, webhook payload paths are confirmed, and entitlement updates are verified.

Hard stop lines for this phase:

- Do not deploy in this planning task.
- Do not collect live money.
- Do not use Lemon Squeezy live mode.
- Do not write entitlement from the client.
- Do not put API keys or webhook secrets in frontend code.
- Do not unlock premium from `?checkout=success`.
- Do not roll this UI to beta testers until test-mode checkout, webhook, entitlement, and smoke checks pass.

2026-05-02 implementation note:

- Public-facing account UI was added locally for internal branch testing.
- Existing Google sign-in remains.
- Email/password create account, sign-in, password reset, sign out, switch account, and current account display were added.
- Firebase Console Email/Password provider must be enabled manually before the email/password flows work in deployed/internal testing.
- Account linking is explicitly deferred.
- Premium entitlement logic did not change; premium still unlocks only from the current UID's Firestore entitlement through `premiumService`.

## 1. Public-Facing UX Goal

Build the paywall UI as if real users will eventually see it, while keeping this branch/version internal-only until payment smoke is complete.

The UI should feel like a quiet product upgrade, not a trap:

- Clean upgrade modal with focused copy.
- Clear annual price.
- Short feature list tied to things users can recognize in the app.
- Signed-out users are asked to sign in first.
- Signed-in free users see an upgrade button.
- Premium and manual-active users see an active state instead of an upgrade button.
- Checkout success/canceled returns show safe state messaging.
- Support/help text is visible when payment verification is delayed.

Recommended modal structure:

- Header: `Upgrade to BARK Ranger Premium`
- Price line: `$9.99/year`
- Renewal line: `Annual plan. No monthly plan in this test version.`
- Feature list:
  - `Visited-aware map tools`
  - `Advanced map styles`
  - `Virtual and completed trail controls`
  - `Global search and premium routing tools`
  - `More premium map features as they ship`
- Primary action:
  - Signed out: `Sign in to upgrade`
  - Signed-in free: `Continue to secure checkout`
  - Premium/manual active: `Premium is active`
- Secondary action: `Maybe later`
- Support text: `Payment handled securely by Lemon Squeezy. If premium does not unlock after checkout, contact support with your account email.`

Avoid:

- Countdown pressure.
- Hidden pricing.
- Client-side "paid" flags.
- Success URL celebrations before Firestore entitlement is active.

## 2. Price And Copy

Current configured Lemon Squeezy test variant:

- Price: `$9.99/year`
- Billing: annual only.
- Monthly plan: none.
- 2-year/3-year plan: none.
- Provider: Lemon Squeezy test mode.

Planning note:

- Phase 4D recommended `$15/year` as the beta pricing target.
- The current Lemon Squeezy test product/variant used for implementation is `$9.99/year`.
- Until the maintainer changes the provider product, the UI should show `$9.99/year`.

Suggested copy:

- Modal title: `Upgrade to BARK Ranger Premium`
- Price: `$9.99/year`
- Subcopy: `Unlock the premium map tools for one annual plan.`
- Signed-out body: `Sign in first so premium can be attached to your BARK Ranger account.`
- Free body: `Premium unlocks the tools that make planning and tracking park visits faster.`
- Success return: `Verifying your payment...`
- Pending return: `Checkout finished, but premium has not arrived on this account yet. Keep this tab open or check again in a moment.`
- Canceled return: `Checkout canceled. No charge was made, and your account is still on Free.`
- Premium active: `Premium is active on this account.`
- Past due/expired/canceled: `Premium is not active on this account. You can upgrade again when ready.`

## 3. Paywall Trigger Surfaces

Later implementation should route premium prompts through one shared paywall controller instead of duplicating modal logic per feature.

Trigger surfaces:

- Visited filter.
- Map style select.
- Virtual trail button.
- Completed trails button.
- Global search.
- Profile/account premium card.
- Account/status area.
- Future premium buttons.

Expected behavior:

- Signed-out users: open sign-in prompt or sign-in-first paywall state.
- Signed-in free users: open upgrade modal.
- Premium/manual-active users: open the feature directly.
- Inactive paid states such as `past_due`, `expired`, or `canceled`: show upgrade-again state.

## 4. User States

| State | UI behavior |
| --- | --- |
| Signed out | Show sign-in prompt. Do not call checkout. Explain that premium attaches to an account. |
| Signed-in free | Show upgrade modal and checkout button. |
| Premium active | Show premium active state. Hide/disable upgrade button. Premium features open. |
| Manual active | Show premium active state. Treat as premium. |
| Checkout success return | Show verifying payment state. Do not unlock from URL params. Wait for Firestore entitlement. |
| Checkout canceled return | Show canceled/no-charge/still-free state. Keep premium locked. |
| Entitlement delayed | Show pending/verifying message, support text, and retry/refresh affordance. |
| Entitlement active after webhook | Premium features unlock from Firestore entitlement. Show success state. |
| Past due | Show inactive state and upgrade/retry billing prompt. Premium features stay locked. |
| Expired | Show inactive state and upgrade-again prompt. Premium features stay locked. |
| Canceled without active period | Show inactive state and upgrade-again prompt. Premium features stay locked. |

Important rule:

- The app unlocks premium only from `premiumService` reading Firestore entitlement where effective premium is `premium === true` and status is `active` or `manual_active`.
- The account UI may display the current premium status, but it does not write entitlement or mark an account premium.

## 4A. Account UI Addendum

The public-facing account UI now supports:

- Continue with Google.
- Create account with email/password.
- Sign in with email/password.
- Password reset email.
- Sign out.
- Switch account.
- Current account display with email, Firebase UID, provider/method, and premium status.

Security boundaries:

- Passwords are submitted only to Firebase Auth and are not stored by the app.
- Client code does not write `users/{uid}.entitlement`.
- Client code does not set `premiumService` manually.
- Premium is attached to the currently signed-in Firebase UID.
- Checkout return messaging must keep reminding users to return with the same account.
- Account linking between Google and email/password is deferred until a separate focused phase.

## 5. Frontend Implementation Shape

Likely files for later 4G implementation:

- `modules/paywallController.js` or `services/paywallService.js`
  - Owns modal open/close, checkout creation call, return-state handling, and safe state transitions.
- Optional `renderers/paywallRenderer.js`
  - If the existing codebase favors renderer modules for DOM updates.
- `index.html`
  - Modal markup, account premium card shell, and accessible labels.
- `services/premiumService.js`
  - Read-only entitlement state access only if existing exports are insufficient.
  - No client entitlement writes.
- Existing premium surfaces:
  - `modules/searchEngine.js`
  - expedition/trail/map-control modules if they own premium button interactions.
  - `services/authPremiumUi.js` if it already controls premium affordances.
- Tests:
  - Existing Playwright smoke files where the app already exercises premium gating.
  - Optional new `tests/playwright/payment/paywall-smoke.spec.js` or similar if the repo structure supports it.

Implementation guidance:

- Prefer one paywall entry point, for example `openPaywall({ source })`.
- Keep state reads centralized through the existing auth and premium services.
- Use existing modal/dialog patterns if present.
- Keep UI copy static and clear.
- Keep provider details limited to safe display copy such as `Payment handled by Lemon Squeezy`.

## 6. Checkout Call

On signed-in free upgrade click:

1. Confirm the user is authenticated.
2. Set button state to loading.
3. Call Firebase callable `createCheckoutSession`.
4. Expect backend response:

```js
{
  checkoutUrl: "https://..."
}
```

5. Validate that `checkoutUrl` is a non-empty HTTPS URL.
6. Redirect the browser to `checkoutUrl`.
7. If the callable fails, show safe retry/support copy.

Security boundaries:

- Do not send client-selected `uid`, email, store, variant, price, product, entitlement, premium, success URL, or cancel URL.
- Do not store premium in `localStorage`.
- Do not set `premiumService` manually.
- Do not write Firestore entitlement from the frontend.
- Do not trust checkout URL query params.
- Do not put Lemon Squeezy API keys or webhook secrets in frontend code.

## 7. Return-State Handling

On app load, inspect checkout URL params only to decide which message to show. They are not proof of payment.

Success return:

- If URL has `?checkout=success&provider=lemonsqueezy`:
  - Show `Verifying your payment...`.
  - Wait for `premiumService`/Firestore entitlement to become active.
  - Show success only when Firestore entitlement is active or manual active.
  - If entitlement does not become active within a short window, show pending/support copy.
  - Keep premium features locked until entitlement changes.

Canceled return:

- If URL has `?checkout=canceled&provider=lemonsqueezy`:
  - Show `Checkout canceled. No charge was made.`
  - Keep user on Free unless Firestore entitlement already says otherwise.

Clear URL params:

- Provide a button such as `Back to map` or `Dismiss`.
- Use `history.replaceState` to remove checkout query params after the message is acknowledged.

Fake success URL rule:

- A manually typed success URL must not unlock premium.

## 8. Test-Mode Safety

This internal branch can include visible test-mode cues until final beta release:

- Example account card text: `Payment test mode`
- Example verifying footer: `Internal test checkout`

Safety requirements:

- Lemon Squeezy live mode remains off.
- No public beta rollout until smoke passes.
- No entitlement write from frontend.
- No API key or webhook secret in frontend.
- No success URL unlock.
- No local premium flag.
- No payment code deploy without explicit approval.

## 9. Manual Smoke Checklist

Manual smoke before any beta rollout:

- Signed-out premium click opens sign-in prompt.
- Signed-in free premium click opens paywall.
- Upgrade button calls `createCheckoutSession`.
- Checkout canceled returns to app and user remains free.
- Checkout success returns to verifying state.
- Fake success URL alone does not unlock.
- Verified webhook entitlement active unlocks premium.
- Reload restores premium from Firestore.
- Account switch does not leak premium UI or controls.
- `expired` locks premium again.
- `past_due` locks premium again.
- `canceled` without active period locks premium again.
- Existing ORS premium callable enforcement still blocks free users.
- Full existing smoke still passes.

Manual command set for later verification:

```bash
npm --prefix functions test
npm run test:functions:emulator
npm run test:rules
npm run test:e2e:smoke
git diff --check
```

## 10. Playwright Test Plan

Focused Playwright coverage where practical:

- Signed-out premium trigger opens sign-in prompt.
- Signed-in free premium trigger opens paywall modal.
- Mocked `createCheckoutSession` returns checkout URL and the UI attempts redirect.
- `?checkout=success&provider=lemonsqueezy` shows verifying state but does not unlock without entitlement.
- `?checkout=canceled&provider=lemonsqueezy` shows canceled/no-charge message.
- Premium entitlement hides upgrade button and shows active state.
- Manual active entitlement shows active state.
- Past_due/expired entitlement shows inactive upgrade-again state.
- No `localStorage` premium flag is written.
- Account switching does not leak premium state.

Test strategy:

- Use existing storage-state patterns.
- Mock the callable at the network/Firebase boundary where possible for frontend-only tests.
- Use real deployed test-mode backend only in a later manual/payment smoke phase, not in normal CI.
- Keep tests independent of live Lemon Squeezy availability.

## 11. Required Backend Preconditions

Before full checkout testing:

- `LEMONSQUEEZY_API_KEY` is set as a Firebase Functions secret.
- `LEMONSQUEEZY_WEBHOOK_SECRET` is set as a Firebase Functions secret.
- Only `createCheckoutSession` and `lemonSqueezyWebhook` are deployed to the internal/test Firebase project after explicit approval.
- Lemon Squeezy dashboard is in test mode.
- Lemon Squeezy test webhook points to deployed `lemonSqueezyWebhook`.
- Test webhook events confirm real payload paths for `firebase_uid`, event ID, status, provider IDs, test mode, store ID, and timestamps.
- Out-of-order provider timestamp decision from Phase 4F.2/4F.3 is resolved before public/paid launch.
- Test checkout can produce a webhook carrying `checkout_data.custom.firebase_uid`.
- The backend `APP_BASE_URL` points to the same app origin/session being used for internal checkout smoke.
  - Use the production default `https://outswarming.github.io/bark-ranger-map/` for GitHub Pages testing.
  - Use a local value such as `http://localhost:4173/index.html` for localhost testing.
  - Do not let the client provide this value.

Internal testing gotcha:

- If checkout starts from localhost and Lemon Squeezy returns to GitHub Pages, the webhook may write entitlement to the UID that created checkout while the returned browser is signed into a different UID/session.
- That leaves the returned app correctly stuck on `Verifying payment...` because its current Firestore entitlement is not active.
- This is not a payment security bug. It is the frontend refusing to unlock without entitlement on the current signed-in UID.

Later commands, do not run in this planning phase:

```bash
firebase functions:secrets:set LEMONSQUEEZY_API_KEY
firebase functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET
firebase deploy --only functions:createCheckoutSession,functions:lemonSqueezyWebhook
```

## 12. Risks

- Frontend could accidentally imply success URL equals premium; mitigate with explicit verifying-only state.
- Checkout may be reachable before webhook entitlement is proven; keep this internal until 4F capture is complete.
- Lemon Squeezy cancel behavior may not map to a direct cancel URL in all flows; test real hosted checkout behavior.
- Payment verification may be delayed; support copy must be calm and practical.
- Account switching can leak UI state if paywall state is cached outside auth/premium subscriptions.
- Over-wiring premium surfaces can create broad regressions; implement one shared paywall controller and add focused smoke tests.
- Showing `$9.99/year` may conflict with Phase 4D's `$15/year` recommendation; UI must follow the current provider variant until product pricing changes.

## 13. Stop Lines

- No live money.
- No beta rollout yet.
- No entitlement write from client.
- No API key in frontend.
- No webhook secret in frontend.
- No unlock from success URL.
- No provider live mode.
- No deploy to beta testers until final smoke is approved.
- No public checkout button until maintainer approves the internal test flow.
- No weakening Firestore rules or ORS callable entitlement checks.

## 14. PR Breakdown

Recommended slices:

- **4G plan only**
  - This document.
  - No runtime code.
- **4G.1 paywall modal shell + state display**
  - Add modal UI.
  - Wire signed-out/free/premium/manual/inactive display states.
  - No checkout redirect required yet.
  - Add frontend smoke tests for modal/state behavior.
- **4G.2 checkout callable integration behind test mode**
  - Upgrade button calls `createCheckoutSession`.
  - Redirects only to backend-returned checkout URL.
  - Requires 4E/4F test-mode backend readiness.
- **4G.3 success/cancel return handling**
  - Verifying state for success URL.
  - Canceled/no-charge state.
  - Clear checkout params.
  - Fake success URL does not unlock.
- **4G.4 payment E2E/manual test-mode smoke**
  - Test hosted checkout, webhook, entitlement update, reload, account switch, canceled flow, and inactive states.
- **4G.5 beta release gate**
  - Confirm ORS key rotation.
  - Confirm provider live/test settings.
  - Confirm support/terms/refund basics.
  - Confirm all tests and manual smoke.
  - Explicit maintainer go/no-go.

## 15. Return Summary

Recommended UI structure:

- One shared paywall controller.
- One modal with signed-out, free, premium, inactive, verifying, and canceled states.
- Profile/account premium card as a secondary surface.
- Existing premium feature controls call into the same paywall entry point.

Expected files later:

- `modules/paywallController.js` or `services/paywallService.js`.
- Optional `renderers/paywallRenderer.js`.
- `index.html`.
- Existing premium-surface modules only for wiring.
- Focused Playwright smoke tests.

Copy:

- Use `$9.99/year`.
- Annual only.
- No monthly, 2-year, or 3-year plan yet.
- Mention Lemon Squeezy only as the secure payment processor/Merchant of Record, not as an implementation detail.

Smoke checklist:

- Signed-out prompt.
- Free paywall.
- Checkout callable.
- Canceled return.
- Success verifying.
- Fake success does not unlock.
- Webhook entitlement unlocks.
- Reload restores premium.
- Account switch isolation.
- Inactive statuses lock.
- Existing smoke passes.

Ready to implement 4G.1: YES, for internal testing branch modal shell and state display only.

Ready for full checkout UI rollout: NO, not until test-mode backend secrets/deploy, real webhook payload capture, entitlement update confirmation, and payment smoke are complete.
