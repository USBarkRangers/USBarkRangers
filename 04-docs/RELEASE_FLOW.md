# Release Flow & Environments

## Environments

- **Beta** — GitHub Pages, served from `main` at
  <https://usbarkrangers.github.io/USBarkRangers/>. Changes land here first for
  regression testing.
- **Production** — Firebase Hosting (project `barkrangermap-auth`) at
  <https://barkrangermap-auth.web.app/>. Real users.

Both share **one backend**: the same Firebase project, Firestore, Auth, Cloud
Functions, and LemonSqueezy store. A user moving between beta and production sees
the same account, premium status, visited data, and payments. Only the frontend
build and the version label differ.

**Consequence:** only client/frontend changes can be tested on beta in isolation.
Cloud Functions, Firestore rules, and written data shapes deploy globally and hit
everyone at once — keep those changes backward/forward compatible.

## Versioning

`01-code/app/version.json` holds a string version (e.g. `0.1`). The app appends
`-beta` to the **display** label when the host ends in `github.io`
(`window.BARK.isBetaHost` / `getDisplayVersion` in `barkState.js`). Per release,
bump the number in `version.json` and the `?v=` cache-busters on any changed
scripts in `01-code/app/index.html`.

## Promote beta → production

1. Land and test the change on `main` (Pages auto-serves it to beta).
2. From the tested commit, deploy hosting only:
   `firebase deploy --only hosting`
   Do **not** deploy functions/rules unless that is the intended change.
3. Verify <https://barkrangermap-auth.web.app/version.json> and the script
   `?v=` fingerprints match the repo.
4. Tag the release: `git tag prod-<version> && git push origin prod-<version>`.

## Backup

The pre-consolidation history (78-commit May-27 durability fork, unrelated to the
current `main` history) is preserved on branch `backup/local-may27-durability`.
