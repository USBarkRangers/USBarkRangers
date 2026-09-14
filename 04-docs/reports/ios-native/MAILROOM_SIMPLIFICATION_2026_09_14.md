# Native mailroom implementation

September 14, 2026. Approved plan: `04-docs/plans/IOS_MAILROOM_ONE_PAGE_PLAN_2026-09-14.md`.

## Baseline checkpoint

Source at implementation start (includes the previously completed foreground-refresh fixes):

- iOS app plus BarkDomain runtime Swift: **28,691 lines** (physical lines, including comments/blank lines; excludes tests, docs, generated code and resources).
- Four delivery workers: **389 lines** across profile (119), trips (78), visits (103), walks (89).
- Existing shared job/scheduler code: **199 lines** (NativeSyncJobs 93, NativeFeatureSync 106).
- Data/User: **2,180 lines**, mixed legacy storage/cloud code and still-used policies; deletion targets must be traced, not assumed from the directory name.

The baseline GitHub checkpoint preserves the native app changes and the approved/superseded plans. Unrelated web/backend changes in the working tree are excluded. No implementation, deployment or test-data reset has happened at this checkpoint.

## Checkpoint 1 — shared delivery

Complete. Runtime Swift **28,691 → 28,524 (−167 lines)**; existing runtime files deleted: **0**. The feature-named files are now typed adapters, not separate delivery loops. Four send/backoff loops became one `NativeMailroom.drain`; retry persistence also has one implementation. All four features use `NativeFeatureSync` for scheduling, with account lifecycle coalescing/cancel-and-drain retained. Large legacy-path deletion belongs to checkpoint 3, not this count.

Existing test files/expectations were unchanged. Baseline profile/storage/lifecycle checks: **13 passed**. After refactor: **13 account/profile/storage/lifecycle**, **18 visits/walks/recovery/cost**, **31 trip/reconciliation/identity/cost** checks passed against the isolated emulator. Added two shared-delivery regressions for lost replies across relaunch and malformed acknowledgments; shared scheduling/cancellation checks run with these. Simulator build-for-testing succeeds.

Evidence: `/tmp/bark-mailroom-step1-profile.log`, `/tmp/bark-mailroom-step1-adventures.log`, `/tmp/bark-mailroom-step1-trips.log`, `/tmp/bark-mailroom-step1-core.log`. No backend policy change or deployment in this checkpoint.

## Checkpoint 2 — policy and pending changes

Complete locally. Runtime Swift **28,524 → 28,924 (+400 lines)**; cumulative from baseline **+233**. Runtime files deleted: **0**. This checkpoint adds the requested pending-list/discard UI, shared policy and account pin isolation; it is not the legacy-code deletion checkpoint.

- One ordinary 1,000-operation limit, warning at 800. New single visits and GPS/pedometer recording handoffs bypass count admission; manual/Health imports and edits do not. Removed the 128/129 reader sentinels, 45-draft reader assumption and separate 20-unsaved-draft cap.
- Production Premium editing ends at verified expiry + 40 days; first server acceptance allows operation age through 45 days, and paid acceptance ends at expiry + 45 days. Revocation disables editing immediately when confirmed. Administrative development grants retain their authorized hard expiry, not subscription grace. Renewal retries original bytes/IDs/dates; only one walk can be uncertain at once.
- Profile name/style use server-side field overwrites without clobbering unrelated fields. Existing genuine trip/visit/walk conflict rules remain.
- Pending count covers every feature; the opened list reads local descriptions only. One Sync now, no Open/per-item Retry. Never-sent Discard rechecks exact dependency IDs and refuses raced sends. Trip editor drafts survive cancellation of their queued save.
- Saved-pin files and index now use an account/project/guest namespace. Presentation clears on identity change and late old-account disk results cannot appear in the new account. Unowned test files are not imported or deleted.

Verification: **11 backend unit**, **27 emulator integration**, **61 domain**, **13 native account/profile**, and **14 local pending/saved-pin/storage** checks passed. Final pending-only run adds renewal/uncertain-walk coverage: **5 passed** (four overlap the local run). Larger valid queue test reopened **1,002 operations**; cross-account pin visibility and restoration passed. No skipped checks in these selected runs. Logs: `/tmp/bark-mailroom-step2-*`.

Intentional expectation updates: profile race outcomes now both accept and preserve unrelated fields; capacity is 1,000 instead of 128; production expiry tests exercise the 40/45-day cutoffs. Existing account isolation, malformed input, server validation, exact receipt replay and denied-source checks were retained. No live deployment yet; checkpoint 3 owns cloud/device verification.

## Checkpoint 3 — retention, legacy deletion and deployment

Implementation in verification. Runtime Swift **28,924 → 25,701 (−3,223)**; cumulative **−2,990** from baseline. **27 runtime files deleted**, with genuinely shared location/proximity code retained in its own file. Native guest drafts, recording files, account isolation and the single active editor remain. The old blob store/schema, cloud listeners/readers, sync engine, repositories, provider deletion path, DEBUG fallback and old-format models/importer are gone. No on-device or cloud user data was deleted.

One combined clean-trip cache budget is 100 trip identities / 64 MiB, including notes and clean editor copies. Active, dirty and pending-dependent content is protected separately; the old read-count corruption sentinels were removed. Tests cover more than 100 cached trips, byte pressure, failed-commit rollback, reopen and actual note footprint.

Initial broad app run: **267 passed, 12 failed, 27 explicitly opt-in checks skipped**. Corrected retired-fixture assumptions (old catalog target, raw UID vs native scope, invalid one-character profile fixture, old trip preimage and auth-only directory cleanup). The profile-notification assertion intentionally changes: adding trip work now updates the all-feature Pending Changes count once, while the note checkpoint still does not mutate profile data. Follow-up: 27 passed with one asynchronous fixture-readiness assertion still needing its correct wait; that wait is now fixed and the broad run is repeating. Domain checks: **46 passed** after removing old-format/provider policy tests. Backend unit **11**, integration **27**, project-isolation **2** passed.

Obsolete storage/provider emulator tests were retired with their implementation, not weakened to keep the dead code. Relevant map/trip/settings/account tests were ported to the native writer. Historical web-fixture UI paths are retired; current native account/adventure UI suites and independent guest/visual tests remain. Tests/docs are excluded from runtime savings. Final counts, clean-run evidence, native deployment and physical-device status follow after verification.
