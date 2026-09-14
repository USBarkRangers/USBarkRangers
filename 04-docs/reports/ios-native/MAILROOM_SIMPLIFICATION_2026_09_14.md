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

Implementation and backend deployment complete; physical-iPhone installation is blocked by the device being unavailable to this Mac. Runtime Swift **28,924 → 25,701 (−3,223)**; cumulative **−2,990** from baseline. **27 runtime files deleted**, with genuinely shared location/proximity code retained in its own file. Native guest drafts, recording files, account isolation and the single active editor remain. The old blob store/schema, cloud listeners/readers, sync engine, repositories, provider deletion path, DEBUG fallback and old-format models/importer are gone. No owner/beta account or on-device data was deleted.

One combined clean-trip cache budget is 100 trip identities / 64 MiB, including notes and clean editor copies. Active, dirty and pending-dependent content is protected separately; the old read-count corruption sentinels were removed. Tests cover more than 100 cached trips, byte pressure, failed-commit rollback, reopen and actual note footprint.

Initial broad app run: **267 passed, 12 failed, 27 explicitly opt-in checks skipped**. Corrected retired-fixture assumptions (old catalog target, raw UID vs native scope, invalid one-character profile fixture, old trip preimage and auth-only directory cleanup). The profile-notification assertion intentionally changes: adding trip work now updates the all-feature Pending Changes count once, while the note checkpoint still does not mutate profile data. The final clean broad run passed **279 tests, zero failures, 27 opt-in skips**. Parameterized executions are not inflated into additional distinct tests.

Obsolete storage/provider emulator tests and unused old JSON fixtures were retired with their implementation, not weakened to keep the dead code. Relevant map/trip/settings/account tests were ported to the native writer. Historical web-fixture UI paths are retired; current native account/adventure UI suites and independent guest/visual tests remain. This is why test-source counts also decrease; test deletion is not included in runtime savings. Source searches find no remaining references to the retired LocalStore, SyncEngine, PersonalState/PersonalSnapshot, CloudUserClient or old account-emulator switch in iOS Swift.

### Source counts at every checkpoint

Physical lines include comments and blanks. Runtime includes only app and BarkDomain source Swift; tests are Swift in the app, UI and domain test targets. The two app documents are README and ARCHITECTURE, counted separately from this report and the plan. Fixtures, resources, generated files and backend JavaScript are excluded from the runtime figure.

| Checkpoint | Runtime files / lines | Runtime change | Test files / lines | App docs lines |
| --- | ---: | ---: | ---: | ---: |
| Baseline `5596034` | 317 / 28,691 | — | 141 / 18,229 | 710 |
| 1 `521e4be` | 318 / 28,524 | −167 | 142 / 18,271 | 710 |
| 2 `0c03d15` | 322 / 28,924 | +400 | 144 / 18,485 | 710 |
| 3 `e870e44` | 296 / 25,701 | −3,223 | 130 / 15,884 | 727 |

Net runtime reduction: **2,990 lines (10.4%)**, independent of the **2,345-line test-source reduction**. Checkpoint 3 deletes 27 runtime files and adds the retained shared LocationFix file. Small typed feature adapters remain intentionally; delivery, backoff and scheduling are shared, while server validation and feature-specific acknowledgments are not forced into a generic rules framework.

The final evidence/fixture-cleanup commit does not change runtime or test Swift counts. README/ARCHITECTURE finish at **728 lines** after correcting the current ownership list; this report and the 43-line approved plan are additional documentation, not runtime savings.

### Final verification and deployment evidence

These runs overlap; do not sum them as unique coverage. Temporary logs/result bundles are local verification artifacts, not committed credentials.

| Check | Result | Local evidence |
| --- | --- | --- |
| Broad app unit suite | 279 passed, 0 failed, 27 opt-in skips | `/tmp/BarkStableAnchor/Logs/Test/Test-BarkRanger-2026.09.14_05-25-52--0400.xcresult` |
| Domain suite after unused-fixture cleanup | 46 passed | `/tmp/bark-mailroom-step3-domain-final.log` |
| Backend unit / integration | 11 / 27 passed | `/tmp/bark-mailroom-step3-backend-unit.log`, `/tmp/bark-mailroom-step3-backend-integration.log` |
| Old/native project guards | 2 / 2 passed | `/tmp/bark-mailroom-step3-isolation.log`, `/tmp/bark-mailroom-step3-native-isolation.log` |
| Native profile, pending and cache checks | 21 passed | `/tmp/bark-mailroom-step3-native-profile.log` |
| Native visits/walks | 24 passed | `/tmp/bark-mailroom-step3-native-adventures.log` |
| Native trips | 31 passed | `/tmp/bark-mailroom-step3-native-trips.log` |
| Account screens, including Pending Changes | 4 passed | `/tmp/bark-mailroom-step3-ui-account.log` |
| Visit/walk screens | 2 passed | `/tmp/bark-mailroom-step3-ui-adventures.log` |
| Real-cloud iOS SDK persistence/retry | 1 passed, no skips | `/tmp/bark-mailroom-step3-cloud-sdk.log` |
| Real-cloud command/security smoke | Passed | `/tmp/bark-mailroom-step3-cloud-smoke.log` |
| Signed device Debug / optimized simulator Release | Both built successfully; device signature verified | `/tmp/bark-mailroom-step3-device-build.log`, `/tmp/bark-mailroom-step3-release-build.log` |

The live native backend accepted a valid **44-day-old** change, rejected a **46-day-old** change, preserved independently overwritten profile fields, enforced Authentication/App Check and paid access, denied direct entitlement forgery, and preserved trip/note persistence and exact retry replay. The real iOS SDK also verified reopening saved data and delivering a pending note. These are simulator-to-real-cloud checks, not a claim of physical-iPhone airplane-mode testing.

Deployment used the native-only wrapper, `firebase.native.json` and explicit `bark-ranger-ios` project. Both functions are ACTIVE in us-east1, updated September 14 at approximately 09:31 UTC; all five composite indexes are READY. Rules deployed successfully. Existing min/max instances (0/2) remain unchanged: this development deployment is not a 100,000-user load certification. Evidence: `/tmp/bark-mailroom-step3-native-deploy.log`, `/tmp/bark-mailroom-step3-deployed-state.log`.

Disposable cloud QA access was retired after verification: its account was disabled, development grant revoked, debug App Check registration removed and private local credential fixture deleted. Synthetic evidence documents remain; the owner's account and device registration were untouched. The narrowly guarded `retire-native-cloud-fixture.cjs` makes this cleanup repeatable. Evidence: `/tmp/bark-mailroom-step3-cloud-retirement.log`.

Build **0.5.17 (76)** is signed at `/tmp/BarkMailroomDevice/Build/Products/Debug-iphoneos/BarkRanger.app`. The physical iPhone is still reported unavailable; installation and owner-device airplane-mode/reconnect acceptance remain unverified. No uninstall or device-data reset was attempted. Apple enrollment/payment activation and launch migration support remain separate prerequisites, not silently implemented in this change.

### GitHub checkpoints and handoff

Baseline and checkpoints 1–3 are pushed to `USBarkRangers/USBarkRangers`, branch `codex/ios-native-setup`, with exact remote heads verified. The final evidence/fixture-cleanup checkpoint contains this report and is pushed after verification. Scoped commits contain no changes to the old web application, old functions, old rules, root Firebase configuration or project selection. Unrelated pre-existing working-tree changes remain untouched.
