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

Not started.

## Checkpoint 3 — retention, legacy deletion and deployment

Not started. Obsolete runtime code must be deleted, not retained as a second implementation. Counts and test/deployment evidence will be recorded here.
