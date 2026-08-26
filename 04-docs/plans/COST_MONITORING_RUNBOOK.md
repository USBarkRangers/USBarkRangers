# Cost monitoring runbook

Project: `barkrangermap-auth`
Timezone: `America/New_York`
Discord destination: private `#costs` channel

## What runs

`hourlyCostMonitoring` runs at 20 minutes past each hour with one instance at
most. Most runs are a small guard check. The first healthy run after 08:00 ET
also posts the daily cost summary and caches the latest snapshot at
`system/costStatus`.

The implementation is intentionally split:

- `01-code/functions/costMetrics.js` only reads and calculates cloud usage.
- `01-code/functions/costReporting.js` applies alert policy, formats Discord
  messages, and stores the small alert state.
- `01-code/functions/opsDiscord.js` remains the shared delivery transport.
- `01-code/functions/index.js` contains only the scheduled export.

Production was verified on 2026-08-26. The first run completed with zero metric
source errors and posted the new App Check risk alert to `#costs` plus its
critical summary to `#system-status`. Subsequent forced and scheduled runs
posted no duplicate. After the write-suppression regression fix, a further live
run left `system/costMonitoring.lastCheckedAtMs` unchanged, proving that a
suppressed alert no longer causes an hourly Firestore write.

The final production counter comparison was exact: reads rose by 10 (two
four-read monitor executions plus two explicit verification reads), while the
two writes were from the pre-fix suppressed runs. The post-fix execution added
no state write. There was no unexplained loop or fan-out.

## Daily Discord summary

The post contains:

- Google Cloud month-to-date actual and projected cost when the Standard Cloud
  Billing export is available; a conservative usage estimate while it is not.
- Estimated Lemon Squeezy base-fee run rate, clearly labeled as an estimate and
  not an invoice total.
- Registered, monthly-active, Premium, and Lemon-linked account counts.
- Firestore reads, writes, deletes, storage, PITR, and backup storage.
- Function executions, errors, egress, and the busiest functions.
- Hosting transfer/storage, log ingestion, reCAPTCHA assessments, and App Check
  invalid/denied traffic.
- ORS directions, snap, and geocoding quota use.
- Per-active-user Firestore operations and all-in monthly run rate.

## Alerts

| Signal | Important | Critical |
| --- | ---: | ---: |
| Firestore reads/day | 35,000 | 45,000 |
| Firestore writes/day | 14,000 | 18,000 |
| reCAPTCHA assessments/month | 8,000 | 9,500 |
| ORS directions/day | 1,400 | 1,800 |
| ORS snap/day | 1,400 | 1,800 |
| ORS geocoding/day | 700 | 900 |
| Function error rate/hour (minimum 20 calls) | 5% | 20% |
| App Check invalid/denied rate/hour (minimum 50 checks) | 5% | 15% |
| Projected Google Cloud cost/month | $10 | $25 |

Warnings repeat at most once every 24 hours unless their severity rises. A
recovery message is posted once when the signal returns below threshold.
Critical cost alerts are also copied to `#system-status`; only the `#costs`
message follows the normal critical Admin-ping behavior.

## Runaway-cost ceiling

A normal non-daily execution performs exactly:

- 6 Cloud Monitoring time-series queries;
- 1 Firestore alert-state read;
- 3 Firestore ORS-counter reads;
- 0 Firestore writes while state is unchanged;
- 0 Discord posts while healthy.

The daily execution adds 14 Monitoring queries, three Firestore aggregation
reads, one snapshot write, and one state write. It never scans the `users`
collection. The optional billing query has a hard 1 GiB scanned-data ceiling.

At 24 runs/day this is about 2,880 ordinary Firestore document reads/month,
plus roughly 90 billed aggregation index reads and about 60 writes in the
stable daily-report case. Even if alerts oscillated on every hourly run, the
code can perform at most 720 state writes plus 30 snapshot writes per month.
The monitor also
makes at most 4,740 Cloud Monitoring queries, 720 Secret Manager accesses, and
31 GiB of BigQuery-scanned data per 31-day month. Those ceilings remain inside
the applicable free allowances. This adds one Scheduler job and one active
Secret Manager version; the strict incremental upper bound is about $0.16/month
($0.10 Scheduler + $0.06 secret), and can be lower under billing-account free
tiers.

## Failure behavior

- A missing metric is shown as `n/a`, never zero.
- Billing-export lag or failure falls back to the usage estimate.
- Discord failure never affects payments, routing, account data, or other app
  functions.
- A failed daily Discord post is retried by the next hourly run; it is not marked
  complete until Discord accepts it.
- Customer clients cannot read either monitoring document under the existing
  Firestore default-deny rules.
- The `#costs` URL is held in the dedicated `DISCORD_COSTS_WEBHOOK` secret. It
  is never exposed to the browser client or stored in the repository.

## Launch response

For a critical read/write or cloud-cost alert, first confirm the trend in
Firebase/Google Cloud, then use the existing launch kill switches if the growth
continues. For ORS quota alerts, pause route/geocode generation before the
provider quota is exhausted. Do not enable broad Firestore Data Access logging
as a standing monitor; use a short sample only during an investigation because
the logging itself can add cost.
