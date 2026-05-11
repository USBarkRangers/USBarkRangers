# Lemon Squeezy Live-Mode Env Vars And Secrets

Date: 2026-05-09
Status: planning inventory. Do not deploy live secrets from this doc.

## 1. Current Test-Mode Secrets

| Name | Used by | Current purpose |
|---|---|---|
| `LEMONSQUEEZY_API_KEY` | `createCheckoutSession`, `getCustomerPortalUrl`, disabled legacy coupon callable | Lemon API calls. Currently expected to be test-mode key. |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | `lemonSqueezyWebhook` | HMAC SHA256 signature verification. Currently expected to match test-mode webhook. |

The functions bind these with `runWith({ secrets: [...] })`.

## 2. Current Locked Constants

| Constant | Current value | Meaning |
|---|---|---|
| `DEFAULT_LEMONSQUEEZY_STORE_ID` | `363425` | Lemon store ID accepted by checkout/webhook. |
| `DEFAULT_LEMONSQUEEZY_ANNUAL_VARIANT_ID` | `1604336` | Annual Premium variant accepted by checkout/webhook. |
| `DEFAULT_APP_BASE_URL` | `https://outswarming.github.io/bark-ranger-map/` | Checkout return URL base. |
| `BARK_LEMON_LIVE_MODE_APPROVAL` | expected future value `CARTER_APPROVED_LIVE_RC` | Named approval gate only. Current code still stays test-mode locked. |

## 3. Required Later For Live RC

Before live mode, Carter must confirm:

- live Lemon API key,
- live Lemon webhook signing secret,
- live store ID,
- live annual Premium variant ID,
- live product/variant price,
- live discounts/coupons,
- live webhook endpoint URL,
- live customer portal behavior,
- live return URL.

## 4. Recommended Future Env Shape

Use separate explicit live variables in the RC patch instead of silently reusing test values:

```bash
BARK_LEMON_LIVE_MODE_APPROVAL=CARTER_APPROVED_LIVE_RC
LEMONSQUEEZY_API_KEY=<live-api-key-secret>
LEMONSQUEEZY_WEBHOOK_SECRET=<live-webhook-signing-secret>
BARK_LEMONSQUEEZY_STORE_ID=<live-store-id>
BARK_LEMONSQUEEZY_ANNUAL_VARIANT_ID=<live-annual-variant-id>
BARK_APP_BASE_URL=https://<production-app-url>/
```

Current code does not yet accept store/variant/base URL overrides for checkout. That is intentional fail-closed behavior until the final RC patch.

## 5. Failure Rules For RC Patch

The future live patch should fail closed if:

- approval env value is missing or wrong,
- live API key is missing,
- live webhook secret is missing,
- store ID is missing or not numeric,
- variant ID is missing or not numeric,
- app base URL is missing or not HTTPS,
- checkout mode and webhook mode disagree.

## 6. Secret Handling

- Do not commit secrets.
- Do not paste secrets into docs, GitHub issues, screenshots, or chat.
- Use Firebase/Google Secret Manager or approved Firebase Functions secret binding.
- After live smoke, verify no live key appears in logs.
