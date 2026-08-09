# Release Flow & Environments

## The one rule

**Everything ships to BETA first. Production only moves when Carter says so.**
There is no path that puts a change in front of paying users without a beta pass
first. Production carries real paying customers, so a bad promote costs money and
trust, not just face.

> This file is served publicly by GitHub Pages at
> `usbarkrangers.github.io/USBarkRangers/04-docs/`. Keep customer counts, revenue,
> credentials, and anything else you would not post publicly out of `04-docs/`.

## Environments

**Beta** is GitHub Pages, served from `main` at
<https://usbarkrangers.github.io/USBarkRangers/>. Every push lands here.

**Production** is Firebase Hosting, project `barkrangermap-auth`. Canonical URL is
<https://usbarkrangersmap.com>. The Firebase-assigned
<https://barkrangermap-auth.web.app> keeps working and stays an authorized origin,
so anyone with it bookmarked or installed as a PWA is unaffected.

`usbarkrangers.com` is a **separate GoDaddy marketing site**, not the app. The app
links into it at `01-code/app/index.html` for `/safety-tips` and `/meet-the-team`.
Do not repoint that apex at Firebase without rebuilding those pages first, or the
app's own links break.

Both environments share **one backend**: the same Firebase project, Firestore,
Auth, Cloud Functions, and LemonSqueezy store. A user moving between beta and
production sees the same account, premium status, visited data, and payments. Only
the frontend build and the version label differ.

**Consequence:** only client/frontend changes can be tested on beta in isolation.
Cloud Functions, Firestore rules, and written data shapes deploy globally and hit
everyone at once. Keep those changes backward/forward compatible.

## Versioning

`01-code/app/version.json` holds a string version. The app appends `-beta` to the
**display** label when the host ends in `github.io` (`window.BARK.isBetaHost` and
`getDisplayVersion` in `barkState.js`).

**Pre-launch (where we are now).** Beta and production run the same `0.x` numbering
line, with beta ahead of production because it gets every push. Production sits at
whatever was last promoted.

**At launch.** When beta is close to release we cut a release candidate. That RC
becomes **1.0** and is promoted to production.

**After launch, the lines split.** Production carries the `1.x` line. Beta moves to
`2.x` and stays a major version ahead, so the number alone tells you which
environment a bug report came from. The same rule repeats: beta `2.x` matures into
an RC, promotes to production as `2.0`, beta moves to `3.x`.

Per release, bump the number in `version.json` **and** the `?v=` cache-buster on
every changed script in `01-code/app/index.html`. These are independent per-file
integers, not a global number.

> `05-tools/scripts/update_version.py` does NOT do this correctly. It still does
> integer math on what is now a string version, and rewrites only two of the ~40
> cache-busters. Bump by hand until it is fixed or deleted.

The pre-`0.1` production builds used an internal integer counter (…57, 58, 59) and
are not renumbered.

## Promote beta → production

1. Land and test the change on `main`. Pages auto-serves it to beta.
2. **Wait for Carter's explicit go.** This step is not optional.
3. From the tested commit, deploy hosting only:
   `firebase deploy --only hosting`
   Do **not** deploy functions or rules unless that is the intended change.
4. Verify <https://usbarkrangersmap.com/version.json> and the script `?v=`
   fingerprints match the repo.
5. Tag the release: `git tag prod-<version> && git push origin prod-<version>`.

## Adding a new origin (do all three, or sign-in breaks)

Google sign-in needs the origin registered in **three separate places**. Missing
any one breaks auth for real users:

1. Firebase Console → Authentication → Settings → **Authorized domains**
2. Cloud Console → Web OAuth client `564465144962-m32aoi…` → **Authorized
   JavaScript origins**
3. That same client → **Authorized redirect URIs**

Number 3 is the one people forget. The iOS standalone (home-screen PWA) sign-in
path uses a top-level redirect and dies on `redirect_uri_mismatch` without it.
Google warns changes take 5 minutes to a few hours to propagate.

Currently registered: `localhost`, `barkrangermap-auth.firebaseapp.com`,
`barkrangermap-auth.web.app`, `usbarkrangers.github.io`, `outswarming.github.io`,
and `usbarkrangersmap.com`.

## Email and domain

Auth emails (verification, password reset) send from
**`noreply@usbarkrangersmap.com`**, not the shared `firebaseapp.com` sender that
was landing in spam. Configured in Firebase Console → Authentication → Templates →
Customise domain, backed by SPF, DKIM, and DMARC on the domain.

`support@usbarkrangersmap.com` is the public support address, forwarded by
Cloudflare Email Routing. There is no mailbox on the domain; who reads it is a
routing rule, so changing readers never needs an app release.

> **SPF trap.** Cloudflare Email Routing's "Add missing records" button
> **overwrites** the root SPF record instead of merging, silently dropping the
> Firebase include and breaking Auth email deliverability. After touching Email
> Routing settings, always confirm exactly one SPF record survives:
>
> ```bash
> dig +short @1.1.1.1 usbarkrangersmap.com TXT | grep -c spf1
> ```
>
> That must return `1`, and the record must read
> `v=spf1 include:_spf.firebasemail.com include:_spf.mx.cloudflare.net ~all`.

## Backup

The pre-consolidation history (78-commit May-27 durability fork, unrelated to the
current `main` history) is preserved on branch `backup/local-may27-durability`.
