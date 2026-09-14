# Native mailroom implementation

September 14, 2026. Approved plan: `04-docs/plans/IOS_MAILROOM_ONE_PAGE_PLAN_2026-09-14.md`.

## Baseline checkpoint

Source at implementation start (includes the previously completed foreground-refresh fixes):

- iOS app plus BarkDomain runtime Swift: **28,691 lines** (physical lines, including comments/blank lines; excludes tests, docs, generated code and resources).
- Four delivery workers: **389 lines** across profile (119), trips (78), visits (103), walks (89).
- Existing shared job/scheduler code: **199 lines** (NativeSyncJobs 93, NativeFeatureSync 106).
- Data/User: **2,380 lines**, mixed legacy storage/cloud code and still-used policies; deletion targets must be traced, not assumed from the directory name.

The baseline GitHub checkpoint preserves the native app changes and the approved/superseded plans. Unrelated web/backend changes in the working tree are excluded. No implementation, deployment or test-data reset has happened at this checkpoint.

## Checkpoint 1 — shared delivery

In progress. Existing test expectations will remain unchanged during this structural checkpoint.

## Checkpoint 2 — policy and pending changes

Not started.

## Checkpoint 3 — retention, legacy deletion and deployment

Not started. Obsolete runtime code must be deleted, not retained as a second implementation. Counts and test/deployment evidence will be recorded here.
