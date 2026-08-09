# Changelog

Version history for the US BARK Rangers web app.

Versions are strings starting at `0.1` (early access). Before `0.1`, production
used an internal integer build counter (…57, 58, 59); those older builds are not
re-numbered here. The current number lives in `01-code/app/version.json` and is
shown in Settings. Beta (GitHub Pages) shows the same number with a `-beta`
suffix; the account and backend are identical to production either way.

Everything ships to **beta first**; production moves only on an explicit call.
Beta therefore runs ahead of production on the `0.x` line. When beta is close to
release we cut a release candidate, which becomes **1.0** in production; beta then
moves to `2.x` and stays a major ahead, so the number alone identifies the
environment a report came from. Full detail in
[`04-docs/RELEASE_FLOW.md`](04-docs/RELEASE_FLOW.md).

This file tracks **production promotions**, not every beta build, which is why it
jumps (production was at `0.16` while beta was at `0.29`).

## 0.1 — 2026-08-05 (first early-access version)

First semantic version. Promoted to production from beta after testing.

### Fixed
- Visited-place deletes and date edits no longer roll back after a **successful**
  server write when the client render step fails (e.g. `renderEngine.js` did not
  load, leaving `window.syncState` undefined). Previously the thrown error hit
  the rollback path and resurrected a visit that was already deleted on the
  server, causing visible flip-flopping. The write-path `syncState()` calls are
  now guarded, and `removeVisitedPlace` / `updateVisitDate` rollbacks are
  commit-aware (they only roll back when the server write itself failed).

### Changed
- Version scheme moved from an integer build counter to string versions,
  starting at `0.1`. Beta builds display a `-beta` suffix.

### Internal
- Added `03-tests/firebaseService-commit-aware-rollback.test.js` covering the
  rollback fix in both directions (committed delete survives a render failure; a
  genuine write failure still rolls back). Full unit suite: 86 pass / 0 fail.
