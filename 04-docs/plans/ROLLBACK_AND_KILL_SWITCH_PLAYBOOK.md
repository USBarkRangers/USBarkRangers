# BARK Ranger Map Rollback And Kill Switch Playbook

Date: 2026-05-09
Status: operator playbook for private beta and broader controlled release.
Scope: safe feature pause steps. Lemon Squeezy remains test mode.

## 1. Available Kill Switches

App-side flags are defined in `modules/launchFlags.js` and `modules/barkState.js`.

| Flag | Default | Disables |
|---|---:|---|
| `checkoutEnabled` | true | Upgrade/checkout UI before Lemon redirect. |
| `routePlannerEnabled` | true | Route planner tools. |
| `routeGenerationEnabled` | true | Premium route generation. |
| `premiumGeocodeEnabled` | true | Premium/global town geocode. |
| `leaderboardDeepBrowsingEnabled` | true | Leaderboard See More/deep browsing. |
| `feedbackEnabled` | false | In-app Firestore feedback path. |
| `premiumRiskyToolsEnabled` | true | Broad premium-risky map tools. |

Server-side callable flags are defined in `functions/index.js`.

| Env var | Disables |
|---|---|
| `BARK_ENABLE_CHECKOUT=false` | `createCheckoutSession` before Lemon API call. |
| `BARK_ENABLE_PREMIUM_ROUTE=false` | `getPremiumRoute` before ORS call. |
| `BARK_ENABLE_PREMIUM_GEOCODE=false` | `getPremiumGeocode` before ORS call. |

Disabled values accepted by backend include `0`, `false`, `off`, `disabled`, and `no`.

## 2. Important Limitation

App-side flags are static frontend config unless Carter uses local session overrides. A production-wide app-side flag change requires a Hosting deploy unless a remote config layer is added later.

Server-side env flag changes require a Functions config/environment update and Functions deploy or console update depending on the deployed Functions setup.

## 3. Fastest Safe Rollback

If a new deploy breaks the app:

1. Stop promotion and tester invites.
2. Identify the last known good commit.
3. Deploy Hosting, Functions, and Firestore rules from the last known good commit if all three changed together.
4. Run post-deploy smoke.
5. Document the rollback commit and incident time.

Rollback command pattern:

```bash
git status --short
git rev-parse HEAD
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" firebase deploy --only hosting,functions,firestore:rules
```

Do not use destructive git commands unless Carter explicitly approves.

## 4. Disable Checkout

Use when:

- Lemon checkout errors spike.
- coupon/discount checkout is confusing testers.
- webhook entitlement is failing.
- spend or support risk is unclear.

Preferred order:

1. Set server flag `BARK_ENABLE_CHECKOUT=false` and redeploy Functions or update runtime env through the console.
2. Set app flag `checkoutEnabled: false` and deploy Hosting if the UI should hide/disable the button.
3. Confirm no new Lemon checkout sessions are created.

Watch logs:

- `createCheckoutSession` invocations.
- Lemon API errors.
- Lemon webhook retries.
- Support messages saying checkout is unavailable.

User message:

> Premium checkout is paused while we verify a billing issue. Your map, profile, and saved progress are still available.

## 5. Disable Route And Geocode

Use when:

- ORS errors spike.
- route/geocode invocations spike.
- rate-limit denials spike.
- cost alert fires.
- premium tools behave incorrectly.

Server first:

1. Set `BARK_ENABLE_PREMIUM_ROUTE=false`.
2. Set `BARK_ENABLE_PREMIUM_GEOCODE=false`.
3. Redeploy/update Functions.

Frontend:

1. Set `routeGenerationEnabled: false`.
2. Set `premiumGeocodeEnabled: false`.
3. If needed, set `premiumRiskyToolsEnabled: false`.
4. Deploy Hosting.

Watch logs:

- `getPremiumRoute` invocations/errors.
- `getPremiumGeocode` invocations/errors.
- ORS network errors.
- Rate-limit denial logs.
- Firestore rate-limit docs growth.

User message:

> Route generation and global town search are paused for beta safety. Local map browsing, local search, and visited places still work.

## 6. Disable Leaderboard Deep Browsing

Use when:

- Firestore reads spike.
- exact-rank/leaderboard usage looks abusive.
- See More causes UI errors.

Steps:

1. Set app flag `leaderboardDeepBrowsingEnabled: false`.
2. Deploy Hosting.
3. Confirm the initial leaderboard still loads.
4. Confirm See More is hidden/disabled with a clean message.

Watch logs/metrics:

- Firestore reads by hour.
- leaderboard query patterns.
- `syncLeaderboardScore` invocations/errors.

User message:

> Leaderboard browsing is temporarily limited during beta. Top results and your own progress remain available.

## 7. Disable Feedback

Current default is `feedbackEnabled: false`.

Use when:

- Feedback writes are denied.
- spam appears.
- support routing is unclear.

Steps:

1. Keep or set `feedbackEnabled: false`.
2. Confirm UI shows a clean fallback message.
3. Use support email/process from the support draft.

Watch:

- Firestore permission errors.
- support inbox volume.
- browser console reports from testers.

## 8. Disable All Risky Premium Tools

Use when:

- entitlement state is suspect.
- premium-only features are leaking to free users.
- paid/test entitlement is confusing.

Steps:

1. Set `premiumRiskyToolsEnabled: false`.
2. Also set route/geocode server env flags false if there is any abuse or cost risk.
3. Deploy Hosting and Functions as needed.
4. Confirm account/profile/map still works.

Watch:

- Premium UI gating.
- support reports.
- route/geocode function calls.
- entitlement listener logs.

## 9. After Any Switch

Within 15 minutes:

- Confirm the disabled feature is actually blocked.
- Confirm unaffected app paths still work.
- Check function invocations/errors.
- Check Firestore reads/writes.
- Check support messages.
- Record the exact flag/env var, deploy time, and reason in the release notes.

## 10. Re-Enable Checklist

Before turning a feature back on:

- Root cause is known.
- Fix is deployed or risk is accepted by Carter.
- Relevant tests pass.
- Monitoring is open.
- Carter has a short user-facing explanation ready.

Re-enable one feature at a time.
