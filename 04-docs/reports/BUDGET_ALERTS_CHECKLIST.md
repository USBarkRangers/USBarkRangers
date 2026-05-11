# BARK Ranger Map Budget Alerts Checklist

Date: 2026-05-09

Budget alerts are required before expanding beta beyond the current 10 testers. They are a final pre-RC operational guardrail, not a blocker for implementing Stage 0 kill switches.

## Required Before Expanding Beta

- [ ] Confirm Firebase/Google Cloud billing account owner and alert recipients.
- [ ] Confirm Firestore database region and pricing tier.
- [ ] Create Google Cloud budget for the Firebase project.
- [ ] Add monthly actual-spend alerts at $10, $25, $50, and $100.
- [ ] Add forecast/projected-spend alerts that notify before the monthly budget is exceeded.
- [ ] Add a launch-day manual check for Firestore reads, writes, deletes, storage, and Functions invocations.
- [ ] Add a named owner for responding to cost alerts.
- [ ] Document the emergency action order:
  1. Disable route generation.
  2. Disable premium geocode/global town search.
  3. Disable checkout if payment/webhook issues are present.
  4. Disable leaderboard deep browsing/See More if read spikes point there.
  5. Pause external promotion until metrics normalize.

## Current Stage 0 App Switches

- `checkoutEnabled`
- `routePlannerEnabled`
- `routeGenerationEnabled`
- `premiumGeocodeEnabled`
- `leaderboardDeepBrowsingEnabled`
- `feedbackEnabled`
- `premiumRiskyToolsEnabled`

## Current Stage 0 Server Switches

- `BARK_ENABLE_CHECKOUT=false` disables `createCheckoutSession`.
- `BARK_ENABLE_PREMIUM_ROUTE=false` disables `getPremiumRoute`.
- `BARK_ENABLE_PREMIUM_GEOCODE=false` disables `getPremiumGeocode`.

## Expansion Gate

- [ ] Do not expand beyond the current 10 testers until budget alerts and recipients are confirmed.
