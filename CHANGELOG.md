# Changelog

Version history for the US BARK Rangers web app.

Versions are strings starting at `0.1` (early access). Before `0.1`, production
used an internal integer build counter (…57, 58, 59); those older builds are not
re-numbered here. The current number lives in `01-code/app/version.json` and is
shown in Settings. Beta (GitHub Pages) shows the same number with a `-beta`
suffix; the account and backend are identical to production either way.

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
