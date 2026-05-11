# Phase 4E Lemon Squeezy Checkout Session Plan

Date: 2026-05-02

Status: Phase 4E backend-only local implementation is complete. Do not edit runtime app code, add frontend checkout buttons, add webhook handling, deploy, use live mode, or collect money in Phase 4E.

Readiness verdict: local implementation complete; NOT READY to deploy and NOT READY to collect money. Deployment still requires setting the Firebase Functions secret, explicit deploy approval, and later webhook/entitlement work before paid launch. ORS key rotation is owned separately by the maintainer and remains a public/paid launch blocker.

Implementation update:

- Added backend callable `createCheckoutSession`.
- The callable requires Firebase auth and trusts only `context.auth.uid`.
- The callable reads `LEMONSQUEEZY_API_KEY` from Firebase/backend secret env.
- The callable forces store ID `363425`, annual variant ID `1604336`, and app base URL `https://outswarming.github.io/bark-ranger-map/`.
- The callable creates a Lemon Squeezy test-mode hosted checkout and includes `checkout_data.custom.firebase_uid = context.auth.uid`.
- The callable returns only the hosted checkout URL.
- No API key was committed.
- No frontend button, paywall modal, webhook, entitlement write, Firestore rules change, deploy, or live money collection was added.

Current pricing note:

- Phase 4D recommended `$15/year` for beta planning.
- The current Lemon Squeezy test variant configured for Phase 4E is `$9.99/year`.
- The backend forces variant ID `1604336`; the client cannot choose price, product, store, or variant.

Verification status:

- `node --check functions/index.js`: PASS.
- `node --check functions/tests/checkout-session.test.js`: PASS.
- `npm --prefix functions test`: PASS.
- `npm run test:functions:emulator`: PASS on rerun after an initial local emulator port collision.
- `npm run test:rules`: PASS.
- `git diff --check`: PASS.
- Secret scan: no Lemon Squeezy API key/JWT committed.

## Goal

Document the backend-only `createCheckoutSession` callable that creates a Lemon Squeezy hosted checkout for the `$9.99/year` annual test-mode variant.

Phase 4E must prove only this narrow thing:

- An authenticated user can ask the backend for a Lemon Squeezy test-mode checkout URL.
- The backend, not the client, chooses the store, variant, price path, and test-mode checkout settings.
- The checkout carries Firebase `uid` in Lemon Squeezy custom data for later webhook reconciliation.
- The function returns a checkout URL only.
- The function does not write entitlement and does not unlock premium.

## Source Notes

Official Lemon Squeezy docs currently support the planned approach:

- Test Mode supports checkout flow, subscriptions, webhooks, and API integration testing, and the dashboard must have test mode enabled.
- API requests use `https://api.lemonsqueezy.com`, JSON:API headers, and `Authorization: Bearer {api_key}`.
- API keys are available for test mode and live mode and must not be exposed in client-side code or public places.
- `POST /v1/checkouts` creates a unique checkout for a variant.
- Checkout creation requires relationships for `store` and `variant`.
- Checkout attributes include `test_mode`.
- `checkout_data.email` and `checkout_data.name` can prefill customer fields.
- `checkout_data.custom` can carry custom values such as a user ID; Lemon Squeezy returns that custom data in later order/subscription/webhook metadata.
- `product_options.redirect_url` sets the success/confirmation redirect button for API-created checkouts.
- The checkout response includes `data.attributes.url`.

References:

- https://docs.lemonsqueezy.com/help/getting-started/test-mode
- https://docs.lemonsqueezy.com/api/getting-started/requests
- https://docs.lemonsqueezy.com/api/checkouts/create-checkout
- https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments
- https://docs.lemonsqueezy.com/help/webhooks/signing-requests

## 1. Lemon Squeezy Account/Test-Mode Prerequisites

Manual setup required before implementation:

1. Create or select the Lemon Squeezy store for BARK Ranger Map.
2. Confirm the store is in **Test mode**.
3. Create a subscription product, for example `BARK Ranger Premium`.
4. Create one annual subscription variant:
   - Current Phase 4E test variant price: `$9.99/year`.
   - Currency: USD unless product owner decides otherwise.
   - Billing interval: yearly/annual.
   - Published in test mode so test checkouts can be created.
5. Record the test-mode Store ID.
6. Record the test-mode annual Variant ID.
7. Create a **test-mode API key** for backend use.
8. Configure the success/confirmation redirect target:
   - Suggested success URL: `${APP_BASE_URL}?checkout=success&provider=lemonsqueezy`.
   - 4E should pass this as `product_options.redirect_url` during checkout creation.
9. Decide the cancel/abandon URL for later frontend UX:
   - Suggested cancel URL: `${APP_BASE_URL}?checkout=canceled&provider=lemonsqueezy`.
   - Current Lemon Squeezy checkout API docs expose the success/confirmation `redirect_url`; do not assume an API-level cancel URL unless verified during implementation.
   - For hosted checkout, cancel/abandon may be represented by closing/backing out and returning to the app manually until frontend paywall work in 4G.
10. Keep webhook signing secret planning separate:
   - Create/record `LEMONSQUEEZY_WEBHOOK_SECRET` later for 4F.
   - Do not add webhook handling in 4E unless the phase is explicitly expanded.

Provider values needed by Codex before 4E implementation:

- `LEMONSQUEEZY_API_KEY`: test-mode API key.
- `LEMONSQUEEZY_STORE_ID`: test-mode store ID.
- `LEMONSQUEEZY_VARIANT_ID_ANNUAL`: test-mode annual variant ID for `$9.99/year`.
- `APP_BASE_URL`: app URL used for success/cancel planning.

## 2. Backend Function Design

Implemented callable:

- `createCheckoutSession`
- Firebase callable, matching the existing Functions style.
- Requires `context.auth.uid`.
- Uses `context.auth.uid` as the only trusted UID.
- Reads user email/displayName from `context.auth.token` when available.
- Does not read or write Firestore in 4E.
- Does not implement already-premium branching in 4E.

For signed-in free users:

1. Load and validate backend config/secrets.
2. Build the checkout request server-side.
3. Send `POST https://api.lemonsqueezy.com/v1/checkouts`.
4. Include JSON:API headers:
   - `Accept: application/vnd.api+json`
   - `Content-Type: application/vnd.api+json`
   - `Authorization: Bearer <LEMONSQUEEZY_API_KEY>`
5. Use the backend-forced store `363425` and annual variant `1604336` relationships.
6. Set `attributes.test_mode = true`.
7. Set `product_options.enabled_variants = [1604336]` so other variants are hidden.
8. Set `product_options.redirect_url` to `https://outswarming.github.io/bark-ranger-map/?checkout=success&provider=lemonsqueezy`.
9. Set `checkout_data.email` and `checkout_data.name` if available.
10. Set `checkout_data.custom.firebase_uid = context.auth.uid`.
11. Optionally include custom data such as:
    - `source: "bark_ranger_map"`
    - `plan: "annual"`
12. Return only:

```js
{
  checkoutUrl: "https://..."
}
```

Important non-goals:

- Do not write `users/{uid}.entitlement`.
- Do not write provider IDs.
- Do not create customer portal sessions.
- Do not add frontend upgrade buttons.
- Do not add live-mode checkout.
- Do not unlock premium from this callable result.

Implementation recommendation:

- Use existing `axios` from `functions/package.json`; no new provider SDK is required for 4E.
- Add small helper functions in `functions/index.js` for config loading, checkout payload construction, and Lemon Squeezy response normalization.
- Expose helper test hooks only under `NODE_ENV === "test"`, following the existing ORS test pattern.
- Prefer no Firestore writes in 4E. The only Firestore action should be reading `users/{uid}` to check entitlement/already-premium state if desired.

## 3. Secret/Config Design

Required for 4E:

- `LEMONSQUEEZY_API_KEY`
  - Secret value.
  - Test-mode API key only in 4E.
  - Never exposed to client code or logs.
- `LEMONSQUEEZY_STORE_ID`
  - Backend-forced value in 4E: `363425`.
- `LEMONSQUEEZY_VARIANT_ID_ANNUAL`
  - Backend-forced annual `$9.99/year` test variant in 4E: `1604336`.
- `APP_BASE_URL`
  - Backend-forced app URL in 4E: `https://outswarming.github.io/bark-ranger-map/`.

Secret setup command for later deploy:

```bash
firebase functions:secrets:set LEMONSQUEEZY_API_KEY
```

Later deployment command, do not run without explicit approval:

```bash
firebase deploy --only functions:createCheckoutSession
```

Later for 4F:

- `LEMONSQUEEZY_WEBHOOK_SECRET`
  - Secret value.
  - Used to verify webhook `X-Signature`.
  - Plan only in 4E; do not wire webhook handling yet.

Local/testing guidance:

- Do not commit `.secret.local`, `.env`, storage-state files, debug logs, or provider IDs that are sensitive.
- It is acceptable for the plan or setup notes to name placeholder env var names, but not real API key values.
- Tests should use fake values and mocked Lemon Squeezy HTTP calls.

## 4. Security Rules And Trust Boundaries

Checkout creation trust rules:

- Client cannot create or update `users/{uid}.entitlement`.
- Client cannot choose arbitrary price, store, variant, provider customer ID, or subscription ID.
- Client cannot submit a trusted `uid`; backend uses `context.auth.uid`.
- Backend decides `LEMONSQUEEZY_VARIANT_ID_ANNUAL`.
- Backend forces `test_mode: true` in 4E.
- Backend returns only a checkout URL and status.
- Checkout URL returned from the backend is not proof of payment.
- Checkout success/confirmation URL is not proof of payment.
- Premium unlock still requires Firestore entitlement update from a later verified webhook phase.

Firestore rules status:

- Existing deployed rules already protect entitlement/provider/payment/admin fields from client writes.
- 4E should not require Firestore rules changes.
- Rules tests must still pass after the backend function is added.

## 5. Implemented Tests

Focused function tests were added in 4E.

Covered cases:

- Unauthenticated `createCheckoutSession` is rejected with `unauthenticated`.
- Signed-in free user receives a checkout URL from mocked Lemon Squeezy.
- Already-premium branching is intentionally not implemented in 4E.
- Client-provided `uid` is ignored.
- Client-provided price, store ID, variant ID, `test_mode`, and provider fields are ignored.
- Backend request uses forced annual variant `1604336`, not client data.
- Backend request includes `checkout_data.custom.firebase_uid` from `context.auth.uid`.
- Backend request sets `test_mode: true`.
- Backend request includes prefilled email/display name when available.
- Lemon Squeezy API failure returns a safe `internal` or `failed-precondition` error without leaking API response secrets.
- Missing backend config returns `failed-precondition`.
- No entitlement write occurs during checkout creation.
- Existing ORS entitlement tests still pass.

Verification commands:

```bash
node --check functions/index.js
node --check functions/tests/checkout-session.test.js
npm --prefix functions test
npm run test:rules
npm run test:functions:emulator
git diff --check
```

If the root E2E environment is available, also run the configured smoke suite, but no frontend checkout button behavior is expected in 4E.

## 6. Implementation Files For 4E

Changed files:

- `functions/index.js`
  - Add `createCheckoutSession` callable.
  - Add Lemon Squeezy helper functions and test hooks.
- `functions/tests/checkout-session.test.js`
  - New handler/helper tests with mocked Firestore and mocked Lemon Squeezy HTTP.
- `functions/package.json`
  - Updated test script so both ORS and checkout tests run.
  - No new dependency expected if using existing `axios`.
- `plans/PHASE_4E_LEMONSQUEEZY_CHECKOUT_PLAN.md`
  - Updated status after implementation/QC.

Possible but not expected:

- `functions/package-lock.json` or root lockfile only if a dependency is explicitly added.

Not expected:

- No frontend files.
- No checkout buttons.
- No paywall modal.
- No `services/` runtime app changes.
- No Firestore rules changes.
- No webhook endpoint.
- No deploy config change.

## 7. Stop Lines

- Do not add webhook handling in 4E unless explicitly moved.
- Do not write entitlement.
- Do not add checkout buttons.
- Do not collect live money.
- Do not use live mode.
- Do not unlock on success URL.
- Do not trust client payment state.
- Do not trust client-provided `uid`, price, store ID, variant ID, provider IDs, or entitlement state.
- Do not log `LEMONSQUEEZY_API_KEY`.
- Do not deploy in 4E.
- Do not deploy until explicit approval.

## 8. Required Manual Provider Setup Checklist

Before implementation starts, the maintainer should create/provide:

- Lemon Squeezy store for BARK Ranger Map.
- Test mode enabled in the Lemon Squeezy dashboard.
- Product: `BARK Ranger Premium` or final agreed product name.
- Annual subscription variant:
  - Current Phase 4E test variant: `$9.99/year`.
  - Annual billing interval.
  - Test-mode published/available.
- Test-mode API key.
- Test-mode Store ID.
- Test-mode annual Variant ID.
- App success URL:
  - `${APP_BASE_URL}?checkout=success&provider=lemonsqueezy`
- App cancel/abandon URL for later frontend UX:
  - `${APP_BASE_URL}?checkout=canceled&provider=lemonsqueezy`
- Confirmation/receipt button copy if desired, for example:
  - `Return to BARK Ranger Map`
- Decision on whether checkout should hide other variants:
  - Recommended: yes, backend sets `enabled_variants` to the annual variant only.
- Later-only webhook signing secret plan:
  - Create/record in 4F, not 4E, unless the phase scope changes.

Do not provide real API key values in chat or committed files. Use a secure secret manager or local uncommitted secret file for implementation/testing.

## 9. Blockers

Current blockers before deploy:

- Set `LEMONSQUEEZY_API_KEY` with Firebase Functions secrets.
- Get explicit deploy approval.
- Run the full pre-deploy verification set again.
- Keep checkout/frontend/webhook/entitlement unlock out of scope until later phases.

Not a 4E implementation blocker, but still a paid/public launch blocker:

- ORS key rotation remains owned separately by the maintainer and must happen before public/paid launch.

## 10. Phase 4E Recommendation Summary

Implementation recommendation:

- Add backend-only `createCheckoutSession` callable in test mode.
- Use existing `axios` to call Lemon Squeezy API.
- Use Firebase Functions secret env for the API key.
- Force store ID `363425`, annual `$9.99/year` test-mode variant ID `1604336`, and app base URL server-side.
- Return checkout URL only.
- Add function tests with mocked Lemon Squeezy HTTP and mocked Firestore.

Expected first implementation PR:

- Functions-only backend checkout session creation and tests.
- No frontend buttons.
- No webhooks.
- No entitlement writes.
- No deploy.
- No live money.

Ready to implement 4E: YES, local backend-only implementation is complete.

Ready to deploy 4E: NO, not until the secret is set, verification is rerun, and explicit deploy approval is given.

Ready to collect money: NO, not until webhook verification, entitlement updates, frontend paywall UX, refund/cancel behavior, and final paid-launch smoke are complete.

Next webhook hardening plan:

- Phase 4F.2 payload capture and provider ordering decision is documented in `plans/PHASE_4F2_LEMONSQUEEZY_WEBHOOK_PAYLOAD_CAPTURE_PLAN.md`.
- Phase 4F.3 test-mode capture deploy gate is documented in `plans/PHASE_4F3_LEMONSQUEEZY_TESTMODE_CAPTURE_GATE.md`.
- Do not deploy checkout/webhook functions for capture until explicit approval, test-mode secrets, and safe redacted payload handling are confirmed.
