# iOS shared mailroom and dependable offline saving

Status: **SUPERSEDED — do not implement this version.** Replaced in full by [the one-page plan](/Users/carterswarm/BarkRangerMap/04-docs/plans/IOS_MAILROOM_ONE_PAGE_PLAN_2026-09-14.md). September 14, 2026.

This document is a plan, not an implementation or deployment record. Approval should cover the scope and proposed defaults below; implementation starts only after the owner explicitly approves it. No app, backend, tests, Firebase resources or production comments were changed while preparing this plan.

## 1. Outcome and boundaries

Replace repeated iOS synchronization machinery with one small, account-scoped implementation. Preserve offline work, simplify harmless personal edits, explain pending changes, retain more useful data automatically, and prove reuse by connecting saved pins to the native backend.

Four implementation checkpoints, each ending with a source review, verification, a removed/remaining-code inventory and an owner-facing report. A checkpoint is not a promise about hours or a fixed number of messages. Do not start a later checkpoint while an earlier acceptance gate is failing.

In scope:

- Native iOS app, its domain package, `01-code/functions-native`, and necessary native-only rules/indexes/configuration.
- Shared delivery machinery; account-lifetime ownership; directly related NativeStore responsibilities and inactive iOS legacy wiring.
- Forty-day offline support, editing grace, queue admission, Pending Changes UI, automatic local retention.
- Account-owned saved-pin synchronization, including the yellow pending marker and safe handling of existing device-only pins.

Not in scope:

- Another database/project rewrite, new services or microservices, a general-purpose synchronization framework, or an account-wide data blob.
- The old web app, its backend/database/users/payments/secrets, or any JDDM resources. Their retirement remains a separate owner-led action after native acceptance.
- Full journal, cloud photos, permanent GPS-track archive, multiple dogs, repeat-visit product behavior, additional rewards or new routing/basemap functionality. Add concise roadmap comments only at the relevant boundaries.
- Changing the five-row leaderboard or current navigation/feature UI, except the approved pending/status/warning/saved-pin additions.
- Activating Apple sign-in or purchases. Existing Apple/provider gates remain; this work must not present a development grant as a purchase.

This plan refines the mailroom/offline portion of the earlier rebuild plans. It does not claim that all remaining app architecture, service or launch issues are fixed.

## 2. Current source findings that justify the work

Source inspection, not test counts, established these starting points:

| Current fact | Why it matters | Source |
| --- | --- | --- |
| One pending-operation table and shared job coordination already exist | Reuse these foundations rather than introduce a second queue | [NativeLocalSchema](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeLocalSchema.swift:39), [NativeSyncJobs](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeSyncJobs.swift:7) |
| Four workers repeat delivery loops, retry calculations and error handling | Consolidate mechanics while retaining their different dependency/confirmation rules | [NativeProfileSync](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeProfileSync.swift), [NativeTripSync](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeTripSync.swift), [NativeVisitSync](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeVisitSync.swift), [NativeExpeditionSync](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeExpeditionSync.swift) |
| AccountSession constructs features and owns detailed profile retry scheduling alongside identity transitions | Keep identity/lifetime coordination; move construction and delivery details to their proper owners | [AccountSession](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/AccountSession.swift) |
| NativeStore includes feature policies, projections, persistence and all queue families | Extract misplaced decisions; keep necessary atomic persistence together, not just cosmetically split files | [NativeStore](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeStore.swift), [Trip actions](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeStore+TripActions.swift) |
| The common backend executor already performs access checks, transaction handling and receipt-based replay | Keep this useful structure and add small typed handlers | [Executor](/Users/carterswarm/BarkRangerMap/01-code/functions-native/commands/executor.js) |
| Admission and multiple readers assume at most 128 operations; dirty trips separately cap at 20 | Raising admission alone can make a larger valid queue appear corrupt or leave another offline limit | [Trip list reader](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeStore+TripLists.swift:22), [Trip drafts](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeStore+TripDraft.swift:27) |
| First acceptance currently expires after 30 days; Premium is checked at upload time | Longer offline use and delayed uploads after expiry need coordinated iOS/backend changes | [Envelope](/Users/carterswarm/BarkRangerMap/01-code/functions-native/commands/envelope.js), [Access](/Users/carterswarm/BarkRangerMap/01-code/functions-native/commands/access.js:25) |
| Profile Pending changes currently counts only profile operations | The new screen must represent all feature changes accurately | [NativeAccountDetails](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Account/NativeAccountDetails.swift:43) |
| Clean trip detail retention is 24 items / 12 MiB | Increase automatic retention without increasing routine cloud downloads | [Cache retention](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Native/NativeStore+CacheRetention.swift:6) |
| SavedPlaceStore uses one device-wide directory, without account ownership | Existing pins can appear after switching accounts; fix before declaring saved-pin delivery complete | [AppComposition](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/App/AppComposition.swift:83), [SavedPlaceStore](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/SavedPlaces/SavedPlaceStore.swift) |

The code map's file-link counts are not acceptance criteria. Extension files are not independent consumers, some name-matched edges are false positives, and inactive legacy references do not prove live calls to the old backend.

## 3. Policy contract for approval

### 3.1 Offline time, retention and recovery

- **Owner-selected supported offline period: 40 days.** No offline-mode toggle.
- **Proposed automatic command acceptance: 45 days from creation**: 40 supported days plus five days for a late reconnect/retry. This is a technical safety margin, not another five days of Premium editing.
- No age-based deletion of unsynced work. After automatic acceptance ends, retain it and offer explicit recovery; never silently regenerate operation IDs and replay old effects.
- Keep current 60-day operation receipts and 90-day deletion markers if boundary verification confirms they cover the proposed window. Do not shorten durable activity/reward identity protection. A stale change cursor requires bounded reconciliation, not resurrection of deleted records.
- Age and queue size are separate policies. Increasing either must not change reward uniqueness, account ownership or payload validation.

### 3.2 Premium editing grace and delayed upload

- **Owner-selected editing grace: 40 days after verified paid membership expiry**, for an established paid account. This is Bark's editing policy, not a claim that an Apple subscription remains active.
- Store an explicit editing deadline derived from server-verified membership evidence. Do not reuse an ambiguous cache-expiry field or restart grace when the app opens/reconnects.
- After that deadline, new paid edits become read-only. Reading, safe discard/export and reconciliation of previously retained work remain possible.
- If a walk was already recording when the deadline passed, checkpoint and finish its local capture safely; do not erase it or strand the recorder. Starting another paid recording is blocked. Upload/credit eligibility is evaluated separately rather than inferred from the fact that Finish succeeded locally.
- **Proposed delayed-upload rule:** an operation claiming a creation time within an eligible paid/grace interval can be considered for acceptance while it is within the 45-day command window, even if membership has since expired. Retain sufficient server-side access history to check that interval; do not require current Premium merely to drain retained work.
- Example: membership ends on day 0; a personal edit saved on day 39 can upload on day 43. An operation saved at the end of grace has a latest automatic upload boundary around day 85. New editing still stops at day 40. Beyond the applicable window, preserve and recover rather than discard.
- **Trust tradeoff requiring approval:** the server cannot perfectly prove the creation time of an offline edit on a modified phone. Server-known paid intervals and a finite upload window bound this accommodation; device timestamps never establish purchase ownership or award eligibility. Do not add a speculative cryptographic system claiming to solve offline time proof.
- Account locks/deletion and explicit access revocation remain distinct from normal expiry. Preserve local work even when upload is not permitted. Existing restricted development grants remain separately scoped; this plan does not automatically extend them by 40 days.
- Exercise clock rollback, clock-forward mistakes, expired credentials and access changes. Reject unsafe claims without erasing the retained local record.

### 3.3 Queue limit and protected captures

- **Proposed ordinary queue limit: 1,000 pending operations; warning starts at 800.** These are initial candidates for a realistic 40-day workload, not a claim of measured capacity. If measurements require materially different limits, report the reason before changing the approved values.
- **Single admission exception:** new visit captures and finishes of locally recorded walks bypass the ordinary count ceiling. They stay in the same durable outbox and are visible in Pending Changes.
- The exception does not apply automatically to bulk imports, edits/deletes, profile changes or award-claim requests. Classify eligible actions in code, not from a client-controlled priority flag. Record evidence first; server validation/credit remains separate.
- Existing payload bounds and real device-storage safeguards remain. No claim that saving is possible on a full/failing disk. Warn on storage pressure, reclaim only replaceable cache, retain existing recordings and report a failed disk save honestly.
- Disk accounting includes unsealed intent bytes, sealed command bytes, drafts and recording files, not just the number of queue rows. Read summaries lazily so larger local storage does not imply an equally large in-memory working set.
- Do not introduce a second overflow queue. Read/process queued work in bounded batches; unrelated blocked work must not stop eligible captures from uploading. One shared mailroom does not mean one globally blocking FIFO line.
- Remove the separate 20-dirty-trip business ceiling in favor of storage-aware durable drafts and paged readers. Drafts are not automatically submissions, and must not be evicted to satisfy a clean-cache target.
- A shared count limit can still block ordinary edits behind other pending work. This is the owner's chosen simplicity tradeoff; the warning and safe-discard UI make it understandable. Do not add per-feature capacity allocation in this scope.

### 3.4 Automatic caching

- **Proposed clean trip-detail cache: up to 100 recently used trips or 64 MiB**, whichever target is reached first. Protect the active trip and authored/unsynced work separately; protected content is not corruption merely because it exceeds a clean-cache target.
- Keep lightweight saved-pin metadata and current progress locally, with indexed/paged access. Keep existing summary-first loading: retaining more downloaded content is not permission to prefetch all route/note/history bodies.
- No manual offline toggle. Make never-downloaded or evicted details clear. Forty-day saving support does not promise the entire remote archive, photos, routing or basemaps are available offline.
- Automatic sync runs on eligible foreground/reconnection opportunities; it is not a promise that a terminated or suspended iOS app can always send immediately. Local durability does not depend on background execution.

### 3.5 Policy locations and comments

During implementation, use one small named policy location in iOS and one in the backend, with a contract-parity check for shared values. Swift and Node have different packaging; avoid a remote configuration service or code-generation framework just to share several constants.

Comments must explain: why 40 days and the retry allowance differ; why uploads and editing have different access checks; why visit/walk capture bypasses the ordinary cap; which reader/retention assumptions must change together; and what evidence warrants raising a limit. Add a plan reference, not scattered unexplained numbers or future implementation stubs.

## 4. Intended ownership: shared mechanics, small feature rules

Keep the existing SwiftData/local-command and native callable architecture for this bounded refactor. Do not also introduce Firestore SDK writes for the same records. A switch of delivery technology would require its own demonstrated deletion/security/migration benefit; it is not necessary to consolidate the current copies.

| Owner | Responsibilities | Must not own |
| --- | --- | --- |
| Account lifetime / composition | Build one account scope; clear presentation on identity change; stop admission, drain old tasks, close old resources | Per-feature retry loops or feature editing policies |
| Shared delivery coordinator | Scheduling, bounded concurrency, transient retry/backoff, cancellation, common operation status and account scope checks | Trip editing, visit scoring, journal merging, whole-archive loading |
| Small typed feature handlers | Select dependency-ready work; validate/encode a command; interpret its outcome; request only necessary confirmation data | Another scheduler, independent retry system, duplicate account cleanup |
| Local transaction writer | Atomically preserve drafts/intents, apply confirmed state and publish targeted changes | Remote requests, UI dialogs, payment verification |
| Feature/domain policies | Field updates, trip/note preimages, activity identity, feature-specific validation | Owning network state or another copy of saved account data |
| Read/cache owners | Bounded summaries, detail-on-demand, exact version/cursor tracking and clean retention | Controlling whether authored work may be discarded |
| Pending Changes UI | Local status projections and explicit safe actions | Becoming a second queue or guessing whether the server accepted a command |

Three rule families guide handlers; they are not a new configurable rules engine:

1. Simple personal field/membership changes: latest accepted change to that field, preserving unrelated fields; normally no conflict dialog.
2. Protected edits: preserve genuinely competing trip/note work and respect deletion/version boundaries. Existing trip/note behavior remains unless a specific change is explicitly listed here; no speculative automatic route-order merging.
3. Validated captures/actions: stable identities, server-owned validation and duplicate-safe credit. A server rejection must not destroy captured personal evidence.

Profile name/map appearance will demonstrate the first policy. Saved pins extend it. Trips/notes and visits/walks exercise the existing other policies. Journal-specific merge UI/logic waits for actual journal requirements.

## 5. Checkpoint 1 — One mailroom; unchanged behavior

1. Record the actual working-tree baseline, including earlier uncommitted refresh fixes. Preserve unrelated edits. Trace save -> local commit -> submit -> acknowledgment -> refresh -> presentation for all four current families.
2. Establish current behavior and failures without editing existing tests. Record any pre-existing failure separately; do not relabel it as a regression or quietly weaken an assertion.
3. Consolidate the four delivery loops and duplicated retry/lifecycle mechanics into one implementation. Reuse/correct NativeSyncJobs and existing scheduling helpers where appropriate. A tiny compatibility facade is acceptable if it only delegates and preserves a needed interface; it must not retain its own scheduler or parallel implementation.
4. Keep actual differences explicit: per-trip dependencies, overlapping visit groups, activity/run dependencies, accepted-but-unconfirmed outcomes and feature-specific confirmation reads. Preserve exact bytes and IDs of sealed operations. Cancellation is not proof that the server did not commit.
5. Give the account scope explicit ownership of transports, workers and the shared writer. Close each resource once after its consumers drain. Remove detailed profile retry scheduling from AccountSession; move feature construction into composition/scope construction.
6. Move pure decisions out of NativeStore into existing feature/domain owners where source tracing identifies a real responsibility boundary. Atomic storage helpers may remain extensions. Do not create an actor/database per feature or a protocol per method just to lower file sizes.
7. Inventory inactive legacy iOS paths and their remaining callers. Remove obsolete runtime wiring where safe. Preserve a narrow old-device draft importer and required local formats; do not delete on-device data. Move necessary harness-only composition outside shipping runtime without changing test assertions.
8. Capture policy constants at their current values if useful, but do not yet activate higher limits, grace, new conflict behavior or a new wire contract.

Acceptance:

- Current behavior tests pass unchanged; added checks may expose regressions. If a necessary change conflicts with the unchanged-test constraint, report it before editing an existing test. Do not retain a duplicate live implementation merely to satisfy it.
- One implementation owns delivery scheduling/backoff/cancellation. Old copies are deleted or reduced to stateless delegation; no shadow queue or second authority.
- Source walkthrough proves account A cannot publish/send as account B, and unrelated work progresses past a feature conflict.
- Existing refresh, lazy-history, stale/deleted-trip and note-only improvements remain; no regression in per-action remote reads/writes relative to the recorded baseline.
- Report connected paths, files/logic removed, justified remaining feature differences and verification evidence. Stop for owner review.

## 6. Checkpoint 2 — Offline policies, simpler profile edits and Pending Changes

1. Activate the approved policy contract in iOS and backend. Implement editable-until versus upload-eligible access explicitly. Preserve current restricted development-account rules and Apple activation gates.
2. Update all queue admission/read/validation/recovery assumptions together. Add indexed/paged work selection and pending projections where larger queues need them; keep full payloads out of ordinary list reads. Preserve cross-operation dependency ordering and fair progress.
3. Add the protected capture exception to new visits and recorded walk finishes. Keep capture and durable enqueue atomic where they share storage; keep the existing recoverable recording handoff where storage differs. A failed save never removes the source recording.
4. Safely coalesce never-submitted repeated simple-field edits. Do not collapse distinct visits/walks, rewrite sealed commands or lose the latest UI edit when an older acknowledgment arrives.
5. Give profile name/map appearance field-level updates so unrelated changes do not trigger profile conflict review. Keep validation and leaderboard-name projection consistent on the server; clients cannot patch entitlement/score fields.
6. Introduce new semantics through an explicit compatible wire version/kind. Previously sealed commands retain their bytes and old interpretation until settled. Do not silently re-encode pending v1 operations or retire required server compatibility immediately.
7. Make Profile -> Pending Changes clickable and account-scoped. List meaningful changes grouped by item/feature, age, waiting reason and available action. Include an existing recorder's unfinished handoff when relevant, without creating another submission store.
8. Use consistent states: saved locally/waiting, sending/awaiting confirmation, needs attention, confirmed. Keep pending-yellow visit/pin semantics and accessible text; never mark the newest visible change confirmed merely because an older submission succeeded. Remove confirmed items from the pending list; no permanent local receipt-browser feature is needed.
9. Provide Sync now and item retry through the existing shared scheduler. Neither forces every detail/history page to download. Opening the pending list itself is local and works offline.
10. Safe discard: cancel only provably never-sent work and explain dependent changes affected. An uncertain command remains awaiting confirmation; cancel cannot claim to undo a possible server commit. Known completed/conflicted outcomes may be reconciled explicitly. Discarding an edit, unbookmarking and deleting an item are distinct actions. No blanket destructive Clear all button.
11. Add the early queue/storage warning, useful failure wording and policy comments. Remove superseded profile conflict machinery for the new simple-field path, retaining only required old-command recovery compatibility.

Acceptance:

- Forty-day offline boundaries, the retry margin, Premium day-39 edit/day-43 upload, day-40 read-only transition and maximum delayed-upload boundaries behave as specified.
- Full ordinary queue still accepts a valid small visit/recorded walk finish; it survives relaunch/account switching and receives no duplicate credit. Bulk imports/ordinary edits do not accidentally inherit the exception. A recording that spans the editing deadline remains locally recoverable and finishable.
- Larger valid queues/draft libraries never become false corruption. Pending lists and scheduling remain responsive with captures above the ordinary ceiling.
- Pending UI accurately covers every current family, is local-only to open, and does not erase unknown outcomes or dependent work.
- New policy checks are added. Changes to any old behavior expectations are specifically listed and justified by this approved policy, not hidden among structural edits.
- Source review confirms no new common-core feature switches or duplicated delivery loops. Report and stop.

## 7. Checkpoint 3 — More useful data retained automatically

1. Apply the approved clean-cache targets and remove old small-cache/reader assumptions coherently.
2. Keep active trip content, dirty drafts, queued edits and recording recovery files protected. Evict only reconstructible clean data. Preserve consistent content/note revision stamps when cleaning or restoring rows.
3. Keep overview metadata cheap and indexed; paginate large local lists instead of decoding the entire archive. Do not bootstrap unseen activity/journal details because a cache is larger.
4. Let normal navigation download necessary content and retain it automatically. Clearly distinguish unavailable/not-yet-downloaded detail from deleted or empty data. No new offline toggle or download-manager screen.
5. Measure cache churn, disk bytes, peak memory and re-opening costs on realistic large local libraries. Retention should reduce re-downloads; it must not introduce background polling or eager whole-account downloads.

Acceptance: downloaded active/recent content works in airplane mode and after relaunch; dirty/pending work survives pressure; never-downloaded content is honest; cache cleanup cannot corrupt trip/note version tracking. Show measured before/after costs and limits, not just increased constants. Report and stop.

## 8. Checkpoint 4 — Saved-pin sync proves reuse; deliver the reviewed build

### 8.1 Narrow saved-pin product slice

- Signed-in saved pins belong to that native account; keep a separate explicit guest/device-only scope. Clear old map projections immediately on identity changes, before asynchronous loads complete.
- Use stable official/provider/custom place identity, reusing the domain identity encoding. Do not infer ownership or merge nearby coordinates/names. Preserve existing supported pin UI; official-place identity support must not replace current visited-marker behavior.
- Proposed backend shape: `users/{uid}/savedPlaces/{placeID}` is a lightweight bookmark-membership projection referencing the existing private `places/{placeID}` identity. It contains only bounded marker/display metadata, membership state, revisions and timestamps. Any duplicated marker display fields are a rebuildable summary, not a second editable journal/place authority.
- Save/remove membership through a small typed native-command handler. Ensure the private place reference exists when needed, without overwriting existing notes/place content. Unbookmark does not delete the place, trip links or journal content.
- Use bounded initial/change pages and a local spatial index. Persist pages and cursors coherently; process removals so old bookmarks do not reappear. Use deletion/removal retention compatible with the 40-day policy, and explicit bounded bootstrap when a cursor ages out.
- Keep direct private writes denied unless a separately reviewed rule change is required. Owner checks, field/size validation, query allowlists, indexes and delete/export inventory must include the new namespace. Do not expose arbitrary collection names or whole-account reads.
- Pending save is pale yellow until the server confirms the corresponding current change; add accessible status text. Cached pin taps/region queries do not trigger Firestore reads. No detailed journal or photo payload in marker metadata.

### 8.2 Existing device-only pin safety

- Existing device files lack reliable account ownership. Do not automatically assign/upload them to whoever signs in next.
- Offer an explicit, account-named import choice; preserve the source files until the import is durably recoverable and its disposition is clear. A restart must resume the same claimed import, not upload into another account. Do not automatically copy the same claimed set into every account.
- Existing reserved local notes remain preserved; do not quietly turn them into trip notes or discard them during migration. Ambiguous identities require an explained recovery path, not fabricated identity or an empty-success result.
- Replace the shared device-wide runtime path for account pins. A rebuildable spatial index may remain, but it is account-scoped and is not a second authored source of truth.

### 8.3 Reuse and delivery acceptance

- New feature code is limited to records, validation/identity, small persistence/backend handlers, query/index projections, UI wiring and migration. **No new scheduler, retry loop, account cleanup system, delivery-state machine or generic pending screen.** If common-core changes are needed, identify whether they fix a genuinely shared omission; do not build speculative extensibility.
- Verify create/save/remove/re-add, offline relaunch, lost response, another-device change, account switch, deletion/cursor recovery and large-library paging. Unbookmarking never deletes related content. Old device pins never appear in another signed-in account automatically.
- Review the final source feature by feature. Record deleted duplicate logic, remaining compatibility code and specific responsibilities still in NativeStore/AccountSession. Do not declare success from line counts alone.
- Prepare scoped Git commits of the approved iOS/native-backend work, after inspecting staged paths. Never stage unrelated web changes. Push the scoped branch only as authorized by implementation approval; do not merge or publicly release automatically.
- Recheck Firebase ownership and deployment identity. Deploy native backend compatibility before installing a client that needs it, using `firebase.native.json` and explicit `--project bark-ranger-ios`. Preserve root configuration, guards, aliases and every other project.
- Verify the deployed native contract with the designated authorized test account and install a versioned, signed iPhone build when credentials/device access permit. Do not claim physical-device verification from a simulator run.
- Owner checks the build: sign in -> save visit/walk/pin -> see pending -> reconnect/Sync now -> see confirmed -> relaunch -> change accounts -> confirm isolation. Obtain owner acceptance before any separate retirement discussion.

## 9. Verification and cost gates across all checkpoints

Do not run load tests against real users or wait 40 actual days. Use isolated synthetic fixtures and injectable time for policy boundaries, plus representative real-device offline/relaunch checks. Never change the system clock or production entitlements to fake evidence.

| Risk | Required proof |
| --- | --- |
| Lost response after server commit | Same saved ID/bytes retried; one effect and one award; latest local edits remain visible |
| Cancel, termination, account switch | Faults before/after disk commit, send, response and local acknowledgment; retained work and no cross-account publication |
| Full queue | Ordinary limit/warning boundaries; protected capture above the limit; other ordinary edits clearly blocked; bounded list/processing cost |
| Multiple pending dependencies | One conflicted trip/site/run cannot stall unrelated items; dependents cannot overtake their prerequisites |
| Expiry/revocation | Before/at/after 40-day edit cutoff and 45-day upload boundary; renewal, normal expiry, revoked/locked account and retained-work recovery distinguished |
| Offline cache pressure | Clean content evicted coherently; dirty drafts/recordings/uncertain submissions retained; failed disk writes never reported saved |
| Personal field changes | Name and map appearance do not conflict with each other; server-owned fields remain protected |
| Migration and compatibility | Upgrade with queued and sealed current-format work; interruption during migration/import; old clients/commands handled by explicit compatibility policy |
| Detail cost | Cached pin taps and local Pending Changes opening cause zero remote reads/writes; warm overview/detail reuse and note-only saves retain earlier efficiency improvements |
| Large archives | Per-account synthetic large histories and dense saved-pin metadata; bounded payload decoding, memory, cursor/index behavior and no whole-account blob |
| Architectural simplification | Trace each current feature through one delivery implementation; name each remaining feature-specific rule and deleted duplicate path |

Record per-action call/read/write counts, payload bytes, local rows/bytes touched, peak memory, retry behavior and cold/warm distinctions. Increasing local capacity is not evidence of lower cloud cost. Do not add an extra callable/receipt pair for a single save just to support the shared UI. Measure protected captures and saved pins, including rejection/retry costs.

The 100K-user goal remains a workload/capacity question: do not infer readiness from a local queue refactor. Keep per-account data and limits; no global hot document. Use the existing $25 monthly native budget alert and $10 development/load-test ceiling, check remaining allowance before cloud work, and request authority for larger runs. Alerts are not a hard cap. Public launch/load capacity is not certified by this plan.

## 10. Migration, rollout and rollback rules

- Preserve existing native account stores and pending work. Version schema changes; test upgrade from the actual current schema. No reset-to-empty or deletion/recreation as migration.
- Keep sealed command IDs/bytes stable. New clients may use new semantics; old in-flight commands retain their original contract. Compatibility code is narrow and has a documented retirement condition, not a duplicate live architecture.
- Retirement of an old wire handler requires evidence about supported clients and pending-command age, not merely completion of this refactor.
- Use separate commits/checkpoints and record the installed build/backend versions. Rollback is code/compatible deployment rollback, not destructive database or local-store reset.
- If a new schema is not readable by an older binary, use a compatible forward fix or a verified reversible migration; never install an older build over pending work on the assumption that Git rollback reverses data.
- Never claim migration, deployment, owner testing or Apple activation complete while a required gate is outstanding. List exact blockers and what is already usable.

## 11. Approval and implementation handoff

Owner approval is requested for this four-checkpoint scope and the proposed defaults: 40 supported offline days, a five-day command retry allowance, 40-day editing grace with bounded delayed uploads and its explicit offline-time trust tradeoff, 1,000/800 ordinary queue thresholds with the capture exception, 100-trip/64-MiB clean retention, and saved pins as the first reuse proof.

Implementation will stop and report after each checkpoint. The report must say: what is connected, what duplicate code was removed, what behavior intentionally changed, what passed/failed, measured resource effects, whether anything was pushed/deployed/installed, and what remains.

Final acceptance means the specified flows work through the real native backend and owner-tested iPhone build, with the shared implementation actually replacing its copies. It does not mean full journal, photos, multiple dogs, Apple activation, every historical architecture issue or old-system retirement is complete.
