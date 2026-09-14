# iOS mailroom simplification — one-page plan

**Approved for implementation September 14.** Replaces the longer plan completely. Scope: iOS and `bark-ranger-ios` only; leave the old web app/data untouched.

## Decisions

- **One mailroom:** shared scheduling, retries, account isolation and status; small feature-specific validation/conflict rules, not a universal rules engine.
- **40 days offline:** automatic local saving, no toggle. Set automatic first acceptance to **45 days old**: 40 days plus retry margin. Never delete older unsynced work; retain it for review. Preserve acknowledgment replay for already-accepted submissions.
- **Premium:** editing stops 40 days after verified expiry. The server accepts otherwise-valid paid changes through expiry + 45 days, using server time. Later arrivals await renewal; renewal does not reset operation age. No historical-subscription tracking.
- **One ordinary queue limit:** proposed default 1,000, warning at 800. New visit captures and recorded-walk finishes bypass that count limit. A failed disk save must never display “Saved.”
- **Test data can reset:** only identified native iOS test data; no old-format compatibility or import screens. Migration support is a separate prelaunch requirement.

## Implementation — three checkpoints

### 1. Delete the duplicate mailrooms

Consolidate the four delivery implementations. Preserve behavior, ordering, stable IDs and duplicate-safe server processing. Conflicts must not block unrelated work. Delete replaced machinery and unnecessary code in these paths. Add complexity only to remove real duplication or protect required behavior; no speculative framework.

Existing tests pass unchanged during this structural step. Add needed checks; report pre-existing failures without weakening assertions.

### 2. Apply policies and make pending work visible

Centralize limits per runtime, with comments explaining why and what changes together. Fix all queue/read assumptions: 128/129, the trip-list 45-row assumption and the 20-unsaved-trip cap.

Implement Premium grace, simple profile-field updates, warnings and clickable Profile → Pending Changes for every feature. Show plain descriptions/status, one **Sync now**, and **Discard for never-sent changes**, safely handling dependencies. No Open or per-item Retry. Never discard uncertain submissions. Keep yellow pending indicators accurate.

Separate saved pins by account **locally**, resetting unowned test pins if needed. No cloud collection. Add policy checks; explain intentionally changed old expectations.

### 3. Retain more automatically and verify

Clean cache: 100 trips or 64 MiB. Protect active/unsynced content; retain detail-on-demand loading. Delete the obsolete iOS storage/sync path and its unused wiring, retaining only genuinely used guest/local behavior. During approved implementation, the agent may deploy **only to `bark-ranger-ios`**, using `firebase.native.json` and explicit `--project bark-ranger-ios`, then verify the backend/iPhone build.

## Must-pass checks

- Offline save/relaunch/reconnect preserves work; retries never duplicate effects or points.
- Account switches never mix pins, pending work or acknowledgments.
- Full queues permit visit/walk capture; larger valid lists never appear corrupt.
- Pending Changes covers all features locally; never-sent changes discard safely; uncertain submissions cannot be discarded.
- Forty-day offline use, 45-day acceptance, Premium cutoffs and renewal retries work; older work remains retained.
- Cache cleanup preserves unsynced work; cached pin taps/Pending Changes cause zero cloud reads.
- One delivery implementation replaces the copies; current features still work.

Report after each checkpoint and continue; stop for blockers or significant new decisions. Each report includes before/after runtime line counts, files removed and verification results, with tests/docs counted separately. Push scoped GitHub checkpoints before, during and after implementation. **Saved-pin cloud sync and the journal are separate future work.**
