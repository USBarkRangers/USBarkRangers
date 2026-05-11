# BARK Ranger Map Budget Alerts Setup Checklist

Date: 2026-05-09
Status: manual Firebase/GCP console checklist.
Scope: budget guardrails for broader controlled release and paid-public readiness.

## 1. Why This Exists

Normal Firestore cost is expected to be low, but route/geocode, repeated function calls, webhook loops, or a viral tester post can create avoidable spend. Budget alerts are an operational guardrail, not a substitute for kill switches or rate limits.

## 2. Console Paths

Use these console areas:

- Firebase Console -> Project -> Usage and billing.
- Firebase Console -> Project -> Firestore Database -> Usage.
- Firebase Console -> Project -> Functions -> Metrics/Logs.
- Google Cloud Console -> Billing -> Budgets & alerts.
- Google Cloud Console -> Billing -> Reports.
- Google Cloud Console -> Monitoring -> Alerting.
- Google Cloud Console -> Logging -> Logs Explorer.

Direct generic URLs:

- `https://console.firebase.google.com/`
- `https://console.cloud.google.com/billing/budgets`
- `https://console.cloud.google.com/billing/reports`
- `https://console.cloud.google.com/monitoring/alerting`
- `https://console.cloud.google.com/logs/query`

Select the Firebase/GCP project that hosts BARK Ranger Map before creating alerts.

## 3. Required Budget Alerts

Create these before 25-50 testers.

| Alert | Type | Required? | Notes |
|---|---|---:|---|
| $1/day projected | Daily projected burn | Yes | Use Monitoring or Billing Reports if Budgets UI cannot express daily projected spend directly. |
| $5/day projected | Daily projected burn | Yes | Early warning for route/geocode or retry loops. |
| $10/day projected | Daily projected burn | Yes | Pause paid promotion until root cause is known. |
| $25/day projected | Daily projected burn | Yes | Trigger kill-switch review. |
| $50/day projected | Daily projected burn | Yes | Stop broader tester invites until resolved. |
| $50/month actual | Monthly actual spend | Yes | Minimum monthly guardrail. |
| $100/month actual | Monthly actual spend | Yes | Escalate to Carter before continuing public promotion. |

Google Cloud Billing budgets are commonly monthly-budget based. If the UI does not offer daily projected alerts directly, use one or both of these approaches:

1. Create monthly budgets with forecast thresholds that approximate daily burn, then review Billing Reports daily during beta.
2. Use Cloud Monitoring alerting with billing export/log metrics if available.

Do not delay private beta solely because the console labels differ. Do not expand to 25-50 testers without a practical alert path Carter can monitor.

## 4. Suggested Budget Setup

In Google Cloud Console:

1. Go to Billing -> Budgets & alerts.
2. Click Create Budget.
3. Scope it to the BARK Ranger Map billing account/project.
4. Create monthly actual budgets:
   - Budget name: `BARK Monthly Actual $50`
   - Amount: `$50`
   - Alert thresholds: 50%, 90%, 100%
   - Recipients: Carter plus any trusted ops email.
5. Create:
   - `BARK Monthly Actual $100`
   - Amount: `$100`
   - Alert thresholds: 50%, 90%, 100%
6. Create daily/projected policies using the closest available console feature.

For daily projected burn, if using manual reports:

1. Go to Billing -> Reports.
2. Filter to the BARK project.
3. Group by SKU/service.
4. Set date range to today.
5. Screenshot projected/actual daily spend each release day.
6. If spend exceeds a threshold in this checklist, use the kill-switch playbook.

## 5. What Carter Should Screenshot

Before 25-50 testers:

- Budgets & alerts list showing the active budgets.
- Each budget detail page showing:
  - budget name,
  - project/billing scope,
  - amount,
  - alert thresholds,
  - recipients or notification channels.
- Billing Reports filtered to the BARK project.
- Firebase Usage and billing page.
- Firestore Usage page showing read/write/delete graphs.
- Functions metrics page with the five critical functions visible.

Before paid public launch:

- All screenshots above, refreshed after the final RC deploy.
- Proof that alert emails or notification channels were received/tested.
- Proof that Lemon live mode was intentionally approved and tested, only after Carter approves the final RC switch.

## 6. Spend Response Thresholds

| Threshold | Action |
|---|---|
| $1/day projected | Check Firestore reads/writes and Functions invocations. |
| $5/day projected | Inspect `getPremiumRoute`, `getPremiumGeocode`, and `lemonSqueezyWebhook` logs. |
| $10/day projected | Pause new tester invites and disable expensive features if the cause is unclear. |
| $25/day projected | Disable route/geocode and leaderboard deep browsing until root cause is known. |
| $50/day projected | Disable checkout if payment/webhook loop is involved; stop promotion. |
| $50/month actual | Review usage trend and decide whether to continue broader beta. |
| $100/month actual | Carter decision required before any further expansion. |

## 7. Service-Specific Cost Checks

Firestore:

- Reads by hour.
- Writes by hour.
- Deletes by hour.
- Storage trend.
- Watch for huge `users/{uid}.visitedPlaces` growth.

Functions:

- Invocations/errors by function.
- External network calls.
- ORS route/geocode volume.
- Webhook retries.

Lemon Squeezy:

- Checkout starts vs subscription/payment webhooks.
- Coupon/discount failures.
- Refund/cancel/expired webhooks.

## 8. Before Broader Release Checklist

- [ ] $1/day projected alert or manual equivalent exists.
- [ ] $5/day projected alert or manual equivalent exists.
- [ ] $10/day projected alert or manual equivalent exists.
- [ ] $25/day projected alert or manual equivalent exists.
- [ ] $50/day projected alert or manual equivalent exists.
- [ ] $50/month actual alert exists.
- [ ] $100/month actual alert exists.
- [ ] Carter receives alert notifications.
- [ ] Screenshots saved outside the public repo.
- [ ] Kill-switch playbook has been reviewed.
