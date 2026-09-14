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

In progress. Obsolete runtime code must be deleted, not retained as a second implementation. Counts and test/deployment evidence will be recorded here.
