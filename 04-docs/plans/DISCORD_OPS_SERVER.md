# US BARK Rangers Discord: internal operations server

Server: **US BARK Rangers** (private, invite only)
Owner: `usbarkrangers`
Guild ID: `1535082492741165089`

Core principle: **dashboard for analysis, Discord for coordination and alerts.**
The website admin dashboard keeps the detailed charts and the history. Discord's only
job is to say when something needs attention, and to be where the team responds.

This is an internal workspace, not a customer community. A public customer Discord, if
we ever want one, gets its own separate server. Combining the two would wreck
moderation, privacy, and organization.

---

## Structure

### 📌 START HERE
| Channel | Purpose |
| --- | --- |
| `read-me-first` | Server purpose, rules, alert levels, how to use it |
| `team-announcements` | Major decisions, launch updates, release notes |
| `daily-briefing` | Automated summary of sales, users, errors, support, priorities |
| `team-calendar` | Launches, Facebook posts, meetings, deadlines, events |

### 🚦 LIVE OPERATIONS
| Channel | Purpose |
| --- | --- |
| `system-status` | Uptime, Firebase health, API status, errors, unusual activity |
| `sales-and-billing` 🔒 | Purchases, renewals, cancellations, failed payments, refunds |
| `support-inbox` 🔒 | Customer emails and in-app support requests in one place |
| `incident-response` | Urgent problems, one thread per incident |
| `launch-monitoring` | Real-time traffic, signups, conversions, reads/writes, load |

### 🛠️ PRODUCT AND DEVELOPMENT
| Channel | Purpose |
| --- | --- |
| `development-updates` | What was changed, deployed, or fixed |
| `bugs` | Confirmed bugs and investigation threads |
| `feature-requests` | Requests from the app or the team |
| `testing-and-qa` | Test builds, browser and device testing, release approval |
| `release-planning` | Upcoming versions, launch checklists, priorities |

### 👥 CUSTOMERS AND COMMUNITY
| Channel | Purpose |
| --- | --- |
| `customer-feedback` | Useful comments and recurring themes |
| `early-access` | Onboarding and communication for early-access customers |
| `facebook-group` | Important group posts, reactions, growth, issues |
| `content-and-marketing` | Announcements, tutorials, Zoom walkthroughs, promo plans |

### 📊 REPORTING
| Channel | Purpose |
| --- | --- |
| `daily-metrics` | Daily users, visits, reads, writes, sales, support volume |
| `weekly-report` | Cleaner weekly performance summary |
| `growth-and-conversion` | Member growth, traffic, paid conversions, retention, churn |
| `admin-dashboard` 🔒 | Links and automated summaries from the website dashboard |

### 💬 TEAM
`general-team-chat`, `ideas-and-planning`, `questions`

---

## Roles and access

| Role | Permissions | Use |
| --- | --- | --- |
| **Admin** (red) | Administrator | Leadership. Sees the 🔒 channels. Pinged on critical alerts. |
| **Team** (green) | Default | Regular team members. |
| **Bot** (blue) | Default | Assigned to the integration bot when it exists. |

🔒 channels are private, restricted to **Admin** plus the server owner:
`sales-and-billing`, `support-inbox`, `admin-dashboard`. Money and customer personal
data. Add people individually rather than widening the role.

---

## Alert levels

Do not dump every event into Discord. Three tiers, and every integration must pick one
per event type:

| Tier | Behavior | Examples |
| --- | --- | --- |
| 🟢 **Routine** | Summarize on a schedule. Never event by event. | Page views, normal read/write volume, routine signups |
| 🟡 **Important** | Post immediately in the relevant channel. No ping. | New purchase, cancellation, new bug report, deploy finished |
| 🔴 **Critical** | Ping the **Admin** role and open a thread in `incident-response`. | Site down, Firebase quota spike, payment provider failing, failed deploy on prod |

This is what keeps the server useful instead of noisy. When in doubt, drop a tier.

---

## Integrations

No bot application and no bot token. Every feed below is either a Discord channel
webhook (a URL that accepts a POST) or an existing Cloud Function posting to one.
A real bot is only needed for things a webhook cannot do: slash commands, reading
messages, opening threads automatically. Nothing here needs that yet.

### Routing

| Source | Events | Destination | Tier |
| --- | --- | --- | --- |
| Any payment-critical function failure | charged-but-not-upgraded risk | `incident-response` | 🔴 pings Admin |
| Any other server fault | unexpected crash, upstream down | `system-status` | 🟡 |
| Browser error reports | uncaught errors, freezes | `bugs` | 🟡 |
| In-app feedback | bug / idea / support / general | `bugs`, `feature-requests`, `support-inbox`, `customer-feedback` | 🟡 |
| Lemon Squeezy | subscription and payment events | `sales-and-billing` | 🟡, 🔴 on failed or refunded payment |
| Daily error digest | 24h client-error rollup | `daily-briefing` | 🟢 |
| GoatCounter + Firestore | traffic, feedback, errors, billing volume | `daily-metrics`, `weekly-report` | 🟢 |
| GitHub | pushes, deploys, failed checks | `development-updates` | 🟡 |

### How it is wired

`01-code/functions/opsDiscord.js` is the transport. It formats an embed, colors it by
tier, pings the Admin role on 🔴 only, clamps everything to Discord's embed limits, and
never throws. A Discord outage cannot change payment, feedback, or error-reporting
behavior.

`01-code/functions/opsMetrics.js` gathers the routine rollup: GoatCounter traffic plus
Firestore counts. Every count is an aggregation query, so the daily post costs roughly
one read per collection rather than one per document.

Delivery hangs off the alert subsystem that already existed in `index.js`:

- `deliverPaymentAlert()` now posts to Discord *and* emails, behind a single
  `alertEmailAllowed()` decision. An error loop therefore floods neither the inbox nor
  the ops server. If Discord fails, the email still goes.
- `handleSubmitFeedback()` posts after the Firestore write.
- `handleLemonSqueezyWebhook()` posts on the processed path, wrapped so a Discord
  hiccup can never make Lemon Squeezy retry an entitlement change that already worked.
- `runDailyErrorDigest()` posts the same summary it emails.
- `dailyOpsMetrics` (08:00 ET) and `weeklyOpsReport` (Mondays 08:05 ET) are new
  scheduled functions.

Identity is masked (`c***@example.com`) everywhere except the Admin-only channels,
because `#bugs` and `#customer-feedback` are visible to the whole team. Firestore keeps
the full record.

### Configuration

One secret, `DISCORD_WEBHOOKS_JSON`, holds every webhook URL plus `adminRoleId`:

```json
{ "adminRoleId": "…", "systemStatus": "https://discord.com/api/webhooks/…", "…": "…" }
```

Channels left out are skipped at runtime, so it is safe to start with a few. A
malformed secret degrades to "Discord disabled" rather than crashing a payment
function. Set it with `05-tools/scripts/set-discord-secret.sh`; the URLs live only in
`discord-webhooks.local.json` (gitignored) and in Secret Manager.

`GOATCOUNTER_API_TOKEN` is the second secret, and only the metrics rollup needs it.
Without it the daily post still goes out with traffic shown as `n/a`.

---

## Status

**Live as of 2026-08-08.** `DISCORD_WEBHOOKS_JSON` is set (11 channels + `adminRoleId`)
and these functions are deployed with it: `getPremiumRoute`, `getPremiumGeocode`,
`createCheckoutSession`, `redeemAccessOrPromoCode`, `getCustomerPortalUrl`,
`restorePremiumPurchase`, `cancelPremiumSubscription`, `lemonSqueezyWebhook`,
`syncLeaderboardScore`, `submitFeedback`, `deleteAccount`, `reportClientError`,
`dailyErrorDigest`. Delivery was smoke-tested end to end into `#system-status`.

The GitHub repo webhook is live and pinging green: push events go to the
`developmentUpdates` Discord webhook with `/github` appended, content type
`application/json`.

## Known gaps

- `dailyOpsMetrics` and `weeklyOpsReport` are **not deployed yet**. They declare the
  `GOATCOUNTER_API_TOKEN` secret, and Firebase refuses to deploy a function whose
  secret does not exist. A read-statistics token named "Discord ops rollup" is already
  created in GoatCounter; it just needs uploading, then these two deploy:

  ```
  npx firebase functions:secrets:set GOATCOUNTER_API_TOKEN
  npx firebase deploy --only functions:dailyOpsMetrics,functions:weeklyOpsReport
  ```
- Channel topics are set on 14 of 25 channels. Discord rate-limited the rest; every
  purpose is in `read-me-first` and in this file. Missing: `testing-and-qa`,
  `release-planning`, `customer-feedback`, `early-access`, `facebook-group`,
  `daily-metrics`, `weekly-report`, `growth-and-conversion`, `general-team-chat`,
  `ideas-and-planning`, `questions`.
- One unused webhook named "Spidey Bot" is left on `#read-me-first`, and a stray
  `@Admin` test message is in `#general-team-chat`. Both are safe to delete.
- Discord's auto-created `Text Channels` (empty) and `Voice Channels` / `General`
  categories are still present. Right click → Delete Category to remove them.
- No invites have been created. Nobody else is in the server yet.
- `#launch-monitoring`, `#growth-and-conversion`, `#team-calendar`, `#early-access`,
  `#facebook-group`, and `#content-and-marketing` have no automated feed yet. They are
  manual channels for now.
