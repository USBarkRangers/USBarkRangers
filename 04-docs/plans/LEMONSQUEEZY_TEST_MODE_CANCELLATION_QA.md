# Lemon Squeezy Test-Mode Cancellation QA

Date: 2026-05-09

Status: Lemon Squeezy remains locked in test mode. Do not enable live checkout until Carter explicitly approves the final RC switch.

## Official References

- Test mode: https://docs.lemonsqueezy.com/help/getting-started/test-mode
- Cancel subscription API: https://docs.lemonsqueezy.com/api/subscriptions/cancel-subscription
- Customer Portal and signed URLs: https://docs.lemonsqueezy.com/help/online-store/customer-portal
- Developer guide for signed customer portal URLs: https://docs.lemonsqueezy.com/guides/developer-guide/customer-portal
- Subscription lifecycle/event types: https://docs.lemonsqueezy.com/help/webhooks/event-types
- Subscription statuses: https://docs.lemonsqueezy.com/help/products/subscriptions

## Current App Policy

- `subscription_cancelled` with a future `ends_at` keeps Premium active as `cancelled_active`.
- `cancelled_active` users see `Access ends: [date]` and `Auto-renew: No`.
- `subscription_expired` sets Premium inactive with `status: "expired"`.
- `subscription_payment_refunded` and `order_refunded` set Premium inactive with `status: "refunded"`.
- Active `access_code` users are not downgraded by Lemon cancellation, expiration, or refund events.
- Customer billing opens a fresh signed Lemon `customer_portal` URL from the Subscription API when available; stored signed URL or the generic billing URL is only fallback behavior.

## Path 1: Dashboard Cancellation

1. Keep Lemon Squeezy Dashboard in test mode.
2. Complete a test-mode checkout from the app and confirm the user has `users/{uid}.entitlement.source == "lemon_squeezy"`.
3. In Lemon Dashboard, open the test subscription and cancel it.
4. Confirm the webhook endpoint receives `subscription_cancelled` with `attributes.test_mode === true`.
5. Confirm Firestore:
   - `entitlement.premium == true`
   - `entitlement.status == "cancelled_active"`
   - `entitlement.currentPeriodEnd` matches Lemon `ends_at`
   - `entitlement.customerPortalUrl` is stored if Lemon included `urls.customer_portal`
6. Reload the app account panel.
7. Confirm UI shows:
   - `Premium cancelled`
   - `Access ends: [date]`
   - `Auto-renew: No`
8. Confirm Premium features still work until the period end.

## Path 2: API Cancellation

Use this when the customer portal is unreliable in test mode.

```bash
export LS_TEST_API_KEY="paste test-mode Lemon API key locally only"
export LS_TEST_SUBSCRIPTION_ID="paste test subscription id"

curl -sS -X DELETE "https://api.lemonsqueezy.com/v1/subscriptions/${LS_TEST_SUBSCRIPTION_ID}" \
  -H "Accept: application/vnd.api+json" \
  -H "Content-Type: application/vnd.api+json" \
  -H "Authorization: Bearer ${LS_TEST_API_KEY}"
```

Expected:

- Lemon returns the subscription in cancelled state.
- The response includes `ends_at` and usually `urls.customer_portal`.
- The app receives/processes `subscription_cancelled`.
- The app shows cancelled-but-active Premium until `ends_at`.

Never commit `LS_TEST_API_KEY` or shell history containing a real key.

## Path 3: Test-Mode Webhook Simulation For Expiration

Use this to prove final access removal without waiting for the real period end.

1. In the Lemon dashboard webhook test/simulation tooling, send or resend a test-mode `subscription_expired` event for the subscription.
2. If the dashboard simulator cannot attach the app's `firebase_uid`, use the existing automated signed fixture tests as the local proof:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
```

Expected:

- `subscription_expired` maps to `entitlement.premium == false`.
- `entitlement.status == "expired"`.
- Premium tools lock on the next entitlement refresh.
- Active `access_code` fallback, if present, keeps Premium true.

## Refund Test

1. In Lemon test mode, refund the test order/payment if the dashboard supports it, or send a test-mode `subscription_payment_refunded` / `order_refunded` webhook simulation.
2. Confirm Firestore:
   - `entitlement.premium == false`
   - `entitlement.status == "refunded"`
3. Confirm the app account panel shows inactive/refunded copy and Premium tools are locked.
4. Confirm active `access_code` users are preserved and not downgraded.

## Signed Customer Portal Check

1. Sign in as a Lemon subscription user.
2. Click `Manage subscription`.
3. The app first calls the `getCustomerPortalUrl` callable.
4. The callable retrieves `GET /v1/subscriptions/:id` with the test API key.
5. The app opens `data.attributes.urls.customer_portal` when Lemon returns one.
6. If the signed URL cannot be fetched, the app falls back to the stored signed URL or generic store billing URL and shows support-safe error handling if that URL cannot open.

The signed URL path is preferred because Lemon's docs say signed `customer_portal` URLs automatically authenticate customers, while the generic `/billing` URL may require a magic-link login.

## Automated Coverage

- Function tests cover cancelled-active, expired, refunded, signed portal retrieval, store mismatch, and access-code preservation.
- Account UI tests cover cancelled-active copy, expired/refunded inactive states, and fresh signed portal URL preference.
- Lemon checkout remains `attributes.test_mode: true`.
