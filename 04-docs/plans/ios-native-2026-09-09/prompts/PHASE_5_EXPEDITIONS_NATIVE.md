# Prompt 5 — Expeditions, tracking and native capabilities

## Activation and objective

On an explicit **“start phase 5,”** read [the shared execution contract](../IMPLEMENTATION_PHASES.md), accepted phase reports, [architecture](../ARCHITECTURE.md) and the file maps. Implement this phase only, fixing relevant earlier regressions as needed.

Build dependable user-started walk recording, local recovery and virtual expedition progress with native location APIs. Add a walk Live Activity, the mapped optional motion/workout-import features, and the existing sharing/support experience. This is a substantial phase and may require several implementation/test/fix sessions before the user accepts it.

## Source and platform behavior to preserve

Inspect `walkTracker.js`, `expeditionEngine.js`, the trail assets, current walk checkpoint/history handling, `watermarkTool.js`, `shareEngine.js`, feedback/support handlers and attachment tests. Read current official Core Location, ActivityKit, Core Motion and HealthKit documentation before choosing exact APIs/capabilities.

Keep current expedition access rules and history. New mileage grants zero mileage points; a completed expedition grants one completion point exactly once. Historical walkPoints/pointMiles adjustments stay intact. The old “15 miles per day” wording is inconsistent with a per-submission clamp: preserve actual behavior with accurate wording by default and flag the product decision; do not silently impose a new aggregate cap.

No watchOS app, cross-process interactive island controls, continuous Health collection, GPS cloud stream or custom background execution framework is in scope. Raw location/Health samples stay on the device by default. Filter counts remain in the map; only an actual active walk creates a Live Activity.

## File ownership

| Files | Operations for this phase |
|---|---|
| D09, D16–D17; extend D05/D18 | Feedback validation values, expedition arithmetic/completion/import rules, segmented walk-distance acceptance and concrete walk/award operations. |
| C05 and U13 | Bundled trail definitions/geometry/interpolation and protected append/checkpoint recording storage. Raw samples are files, not a SwiftData row/cloud write per fix. |
| U06; extend U01–U02/U10–U12 | Expedition repository, run/history/local completion state and durable sync operations. Add feedback draft storage only now. |
| E01–E06 | Expedition display/actions, recording display/actions, the one long-lived WalkRecorder, history/edit/import/recovery UI. |
| Extend P08; new P09–P11 | Core Location recording/background session; optional pedometer source; explicitly selected completed Health workout imports; LiveActivityService. |
| W01–W02 | Shared small ActivityAttributes contract and Live Activity extension UI. Only the attributes source is shared; no Firebase/user-store dependency in the extension. |
| P15; F08–F11 | Image preparation/rendering, photo watermark editor, passport/achievement/expedition cards, QR/park sharing and existing visits CSV export. No account archive export/import. |
| P07; F06–F07 | Feedback draft/submission/email fallback with attachment preparation and truthful receipt/delivery states. |
| A02–A04/A07, M06, T/V/Home/settings integration | Add recording lifetimes, deep links, trail/recording overlays, share/export/support entry points and privacy-safe status. |

Add the Activity target/plist/privacy declaration and actual location/motion/Health capability/usage descriptions only as the corresponding functionality becomes real. Bundle the existing trail definitions with geometry/source provenance and watermark resources. Add ADR 0003. Choose source libraries/SDKs already on the platform; no new general tracking/sharing service.

Backend: B11 validates summary operations, lifetime/history corrections and permanent run-award deduplication; B26/B27 preserve support categories/attachment checks and acknowledge durable report IDs. Use the existing dispatcher/current schema. Device location evidence is still submitted evidence, not a server-certified visit. Test support providers only: phase testing must not send real Discord/email messages.

## Implementation sequence and calls

1. `TrailRepository → ExpeditionPolicy` supplies trail geometry and pure progress arithmetic. Keep units in meters internally and convert current server fields at the transport boundary. Port historical corrections/completion fixtures before connecting the recorder.
2. `WalkRecordingModel → WalkRecorder.start → LocationClient` starts one explicit source/session after relevant permission. Retain the documented location/background session lifetime. Map locate/check-in reuses the same location owner rather than creating a second competing continuous session.
3. `WalkRecorder.consume → WalkDistancePolicy → RecordingStore` validates accuracy/gaps/speed, separates segments and persists bounded batches/checkpoints. Pauses, long gaps, restarts and rejected fixes reanchor rather than connecting a phantom straight line. Use monotonic elapsed time and store recovery timestamps/source/session identity.
4. `finish → ExpeditionRepository.commitWalk → LocalStore` durably saves summary/intent before clearing the recording checkpoint. Network failure leaves a recoverable local completion. Retry with the same operation ID does not add mileage or the award twice. Disk/protection failure is visible and cannot be reported as a successful save.
5. Recovery reopens the preserved checkpoint and explains what was recorded versus unavailable. Force-quit, revoked permission and device restart do not imply uninterrupted tracking. Sign-out/account switching first resolves/checkpoints the active walk and keeps it bound to its original scope; no recording is silently credited to another account.
6. Optional pedometer sessions and selected Health workouts use the same summary/import policy. Pick one credited source per interval; compare source ID and overlapping time intervals across GPS/motion/Health. Repeated import does not duplicate history. An inaccessible workout list is not conclusive proof of permission denial. Show the source and stale/missing measurements accurately.
7. `WalkRecorder → LiveActivityService` publishes bounded display updates and ends them when the walk ends. Reconcile leftover activities on relaunch. The extension renders lock-screen/compact/minimal/expanded views and deep-links to the app for controls. Disabled activities or their system lifetime limits must not stop recording.
8. `PhotoWatermarkModel/ExportModel → ImageExportService` downsample previews, preserve original orientation, render at deliberate export resolution and release temporary assets. Watermark position/scale use normalized image coordinates. Export visits from repositories/catalog, not map markers; preserve CSV escaping/formula safety. Support attachments strip location metadata and respect existing 3-image/per-image/total byte limits.
9. `FeedbackModel → FeedbackService` saves a recoverable local draft and uses a stable report ID. Distinguish accepted filing from downstream delivery and email-only fallback. The mail composer remains user-controlled. Preserve current categories, 2,000-character body and contextual park-correction/missing-location fields.

## AI verification

Run ExpeditionPolicy, WalkDistance, WalkRecorder, LiveActivity, SharingAndFeedback and corresponding UI tests. Add backend trip/expedition/award and feedback cases. Use synthetic noisy/stationary/teleport/gap/overlap tracks and temporary protected recording files. Test interruption before/after each durable boundary, duplicate finish/import/claim, account changes, permission loss, low storage, elapsed-time behavior and current historical point adjustments.

Use physical devices for an outdoor walk, locked screen, app switch, permission change and recovery whenever hardware/setup is available. Compare with a reference distance without pretending simulator playback establishes background accuracy or battery usage. Record duration/device/OS/location mode, gaps, measured distance and what actually ran. If physical tests are unavailable, label them pending in the report and give the user exact instructions.

Exercise disabled/ended/stale Live Activities and a phone without Dynamic Island. Check compact/expanded/lock-screen presentation and largest text. Motion/Health availability varies by device; show a supported unavailable state. Test the user selection/deduplication contract with fixtures separately from real Health-store authorization.

For sharing/support: large/rotated image, repeated selections/cancellation, watermark corner/free-position/resize, memory bounds, exported-card content, CSV safety, attachment rejection and retry. Use fake delivery so test reports stay local. Run prior catalog, account-isolation, visit/trip and scoring regression checks affected by these additions.

## User testing checklist

| User action | Expected result |
|---|---|
| Choose a trail and log/edit/remove manual mileage offline. | Progress/history remain consistent; new miles do not create mileage points. |
| Start a walk, lock the screen, switch apps, pause/resume and finish. | Supported background samples persist; pause/gap handling avoids phantom distance; completed walk saves locally. |
| Close/reopen during a walk or simulate interruption. | Recovery reports preserved data and gaps honestly; no unexplained reset or fabricated continuous distance. |
| Finish offline, reopen and reconnect; claim completion twice. | Summary syncs once and the completion award is issued once. |
| Try denied location, optional motion and selected Health import twice. | Clear availability/source state; overlapping or duplicate distance is not credited twice. |
| Observe lock screen/island and tap back to recording; disable Live Activities. | Display follows the real session; tracking remains usable when the display is absent. |
| Watermark/share a photo, export visits and share a passport card. | Output matches preview/content and user data remains local until explicitly shared. |
| Draft feedback with attachments, force a local delivery failure and retry. | Draft survives, limits are enforced, test receipt is clear and no real message is sent by the test setup. |

## Completion and stop

Deliver phase 5's report with recording/storage call map, actual device versus synthetic evidence, known OS limits, privacy/data-flow notes, example user-generated export locations when available and the complete testing checklist. Remove now-obsolete placeholders across trips/passport/Home. Fix recording/sharing/support findings within this phase. **Do not start purchases or phase 6 until instructed.**
