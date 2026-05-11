# BARK Ranger Map App Check Rollout Plan

Date: 2026-05-09
Status: staged rollout plan. Prepare first; do not blindly enforce.
Scope: App Check readiness for Firestore and Functions without breaking testers.

## 1. Goal

Use Firebase App Check to reduce scripted abuse against Firestore and callable Functions while preserving normal desktop/mobile web access for testers.

Do not enable enforcement across services until the app has been tested in real browsers on desktop and mobile.

## 2. Services To Test

| Service | Why it matters |
|---|---|
| Firestore | User profiles, visited places, saved routes, leaderboard reads, rules-protected data. |
| Cloud Functions | Checkout, Lemon webhook side effects, premium route/geocode, leaderboard sync. |
| Hosting | Public app delivery; App Check enforcement is not the main control here. |

## 3. Current Safety Controls To Preserve

App-side flags:

- `checkoutEnabled`
- `routePlannerEnabled`
- `routeGenerationEnabled`
- `premiumGeocodeEnabled`
- `leaderboardDeepBrowsingEnabled`
- `feedbackEnabled`
- `premiumRiskyToolsEnabled`

Server-side callable flags:

- `BARK_ENABLE_CHECKOUT`
- `BARK_ENABLE_PREMIUM_ROUTE`
- `BARK_ENABLE_PREMIUM_GEOCODE`

Rate limits:

- `getPremiumRoute`
- `getPremiumGeocode`

App Check should add a layer. It should not replace entitlement checks, email verification, Firestore rules, rate limits, or kill switches.

## 4. Preparation Checklist

- [ ] Confirm the Firebase web app is registered in Firebase Console.
- [ ] Choose the web App Check provider in Firebase Console. Use the provider supported by the current Firebase project and app setup.
- [ ] Add allowed production domains.
- [ ] Add local/development debug token process for Carter's machine.
- [ ] Verify the app initializes App Check tokens before any enforcement is enabled. If the code does not initialize App Check yet, do not enforce.
- [ ] Confirm Firestore, Functions, checkout, route/geocode, and signed-in flows still work in a monitor-only state.
- [ ] Save screenshots of App Check request metrics before enforcement.

## 5. Stage 0: Monitor Only

Firebase Console:

1. Open Firebase Console -> App Check.
2. Register/configure the web app.
3. Keep enforcement off.
4. Invite 1-2 trusted testers on desktop and mobile.
5. Watch request metrics for valid/invalid/unverified requests.

Test:

- Signed-out public map load.
- Local search.
- Free account sign-in/profile.
- Premium/test entitlement account.
- Checkout start in Lemon test mode.
- Route generation under entitlement.
- Premium geocode under entitlement.
- Leaderboard initial load and See More.

Exit criteria:

- No normal tester browser is classified in a way that would block access after enforcement.
- No core Firestore or callable path is missing App Check coverage unexpectedly.

## 6. Stage 1: Functions Enforcement Trial

Only after Stage 0 passes:

1. Enable App Check enforcement for Cloud Functions in Firebase Console.
2. Keep Firestore enforcement off at first.
3. Test:
   - `createCheckoutSession`
   - `getPremiumRoute`
   - `getPremiumGeocode`
   - `syncLeaderboardScore`
4. Keep Lemon Squeezy test mode.
5. Watch Functions logs and support reports for blocked users.

If users are blocked:

- Disable Functions enforcement in Firebase Console.
- Use app/server kill switches for expensive features if abuse is happening.
- Collect browser/device details.
- Do not continue enforcement until root cause is fixed.

## 7. Stage 2: Firestore Enforcement Trial

Only after Stage 1 passes:

1. Enable App Check enforcement for Firestore.
2. Test signed-out and signed-in flows.
3. Test mobile-ish and real mobile browsers.
4. Confirm Firestore rules tests still pass locally before and after any rules changes.

Critical flows:

- Public map.
- Auth state load.
- Profile render.
- Visited place add/unmark.
- Free 5-cap enforcement.
- Saved route premium gate.
- Leaderboard read/pagination.
- Settings persistence.

Rollback:

- Disable Firestore enforcement in Firebase Console.
- Confirm app recovers after hard refresh.
- Keep tester communication ready.

## 8. Stage 3: Broader Controlled Enforcement

Before 25-50 testers:

- App Check enforcement should either be proven safe, or intentionally left monitor-only with abuse risk documented.
- Keep budget alerts and kill switches active either way.
- Review App Check metrics daily during the first broader tester week.

Before paid public launch:

- Enforce App Check for Firestore and Functions only after desktop/mobile, checkout, route/geocode, and account flows pass.
- Document the rollback path and who can access Firebase Console.

## 9. Rollback Steps

If normal users are blocked:

1. Firebase Console -> App Check.
2. Select affected service.
3. Disable enforcement for Firestore and/or Functions.
4. Hard refresh production app.
5. Test signed-out map and signed-in account.
6. Watch logs for recovery.
7. Message testers if the outage was visible.

Do not deploy random code changes while App Check enforcement is the likely cause. First roll back enforcement, then investigate.

## 10. Evidence To Capture

- App Check settings screenshots.
- Valid/invalid/unverified request graph screenshots.
- Desktop browser smoke result.
- Mobile browser smoke result.
- Firestore and Functions metrics before/after enforcement.
- Any blocked-user support report with browser/device/time/action.
