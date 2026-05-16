# Controlled Release Known Issues

Date: 2026-05-15
Scope: known non-blockers and watch items for 25-50 controlled users.
Status: operational beta notes. Lemon Squeezy remains test mode.

## Non-Blockers For Controlled Release

| Issue | Severity | Why it is acceptable for 25-50 controlled users | Watch/Fix Later |
|---|---|---|---|
| Lemon live mode locked | Expected | Private/broader beta should not take real payments yet. | Final RC only after Carter approval. |
| Achievements are partly cosmetic/client-writable | P2 | Does not grant Premium, payments, route/geocode, or leaderboard authority. | Server-derived achievements before higher-trust public gamification. |
| App Check not fully enforced | P1 before larger beta | Rate limits/rules/kill switches exist; controlled tester count is small. | Prepare/stage App Check before wider public exposure. |
| Google Sheet dependency | P2 | Fallback CSV exists; public map cost is low. | Monitor Sheet latency/fallback behavior. |
| Legacy `access_code` entitlement compatibility remains | P2 | No new user-facing access-code flow; coupons are Lemon-only. | Remove after confirming no legacy users need it. |
| Legal/business review | P1 before paid public launch | Does not block app runtime or controlled beta testing. | Finish privacy/terms/refund/support/data-source/trademark review before paid public launch. |
| Public repo/internal docs exposure | P1 business/legal | Does not block app runtime, but should be cleaned before broad public/legal review. | Make repo private or sanitize docs before launch/promotion. |
| Java 18 warning in Firebase emulator | P2 | Tests pass now. | Upgrade to Java 21 before firebase-tools v15. |

## Recently Cleared

- Budget alerts/manual monitoring: Carter confirmed done on 2026-05-15.
- Leaderboard client-write red flag: current rules block client writes to `leaderboard/{uid}` and score sync uses the server callable.
- Feedback direct-write red flag: current app submits feedback through the server callable and rules deny direct client writes.

## Watch Closely During Release

- feedback submissions after callable fix,
- free 5-park cap messaging,
- route/geocode function errors,
- Lemon test checkout/coupon confusion,
- email verification friction,
- mobile account/paywall layout,
- leaderboard See More behavior,
- saved route premium gates,
- account switching and sign-out cleanup.

## Not A Known Blocker If Communicated Clearly

- Testers cannot make real payments.
- Testers may need to verify email before checkout/premium callables.
- Premium checkout return may show a verifying state until webhook updates entitlement.
- Admin/mod/VIP free access should be via Lemon test coupons during beta, not internal app codes.

## Must Not Happen

- Lemon live checkout appears.
- Real payment is requested without Carter instruction.
- One user sees another user's data.
- Free user can normally track more than 5 parks.
- Free user can save/load routes.
- Direct Firestore permission errors appear in normal feedback submission.
- Route/geocode calls continue after kill switch.
