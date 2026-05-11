# Phase 4G Payment Test-Mode Smoke Report

Date: 2026-05-03

Status: PASS for internal Lemon Squeezy test-mode payment smoke.

Scope:

- Verified internal test checkout flow only.
- No live money.
- No deploy in this report slice.
- No manual Firestore entitlement grant.
- No payment/paywall logic changes.

## Result

The full test-mode chain worked:

1. App paywall called `createCheckoutSession`.
2. Lemon Squeezy hosted checkout completed in test mode.
3. Lemon Squeezy called `lemonSqueezyWebhook`.
4. Webhook wrote `users/{uid}.entitlement` through Admin SDK.
5. App received the Firestore user snapshot.
6. `premiumService` normalized the entitlement as premium.
7. UI changed from verifying to `Premium active`.

## Evidence

Latest matching Firestore entitlement:

- `premium: true`
- `status: active`
- `source: lemon_squeezy`
- provider customer ID: present
- provider subscription ID: present
- provider order ID: present
- `currentPeriodEnd: 2027-05-03T03:10:23.000000Z`
- `lastProviderEventId`: present
- `updatedAt: 2026-05-03T03:11:07.945Z`

Firebase Functions logs:

- `createCheckoutSession`: invocation found, auth valid, status 200.
- `lemonSqueezyWebhook`: invocations found around checkout completion, status 200.

UI:

- Returned app showed `Premium active`.
- Paywall source showed checkout success.

## Negative Check

Fake success URL was tested with a signed-in free user:

- URL: `?checkout=success&provider=lemonsqueezy`
- `premiumService.isPremium()`: false
- Paywall state: verifying
- Premium controls: still locked

This confirms the success URL alone does not unlock premium.

## Security Boundary Check

- No frontend Lemon Squeezy API key.
- No frontend webhook secret.
- No frontend entitlement write.
- No `premiumService.setEntitlement` from paywall code.
- No localStorage/sessionStorage premium flag.
- Premium unlock came from Firestore entitlement only.

## Commands Run

```bash
node --check services/authAccountUi.js modules/paywallController.js
npm --prefix functions test
npm run test:rules
npm run test:e2e:smoke
git diff --check
```

Results:

- `node --check services/authAccountUi.js modules/paywallController.js`: PASS
- `npm --prefix functions test`: PASS, 65/65
- `npm run test:rules`: PASS, 12/12
- `npm run test:e2e:smoke`: PASS, 9/9
- `git diff --check`: PASS after removing generated emulator debug logs

## Remaining Concerns

- Real Lemon Squeezy dashboard delivery details should still be reviewed manually before public rollout.
- Firebase logs do not currently include sanitized event names/UID summaries, which makes future payment smoke diagnosis more manual.
- Provider timestamp/out-of-order protection remains a pre-public-launch hardening item.
- ORS key rotation remains separate launch hygiene.

## Verdict

The internal test-mode payment chain is working and the frontend is enforcing the correct security boundary: premium unlocks only when the signed-in account receives an active Firestore entitlement.
