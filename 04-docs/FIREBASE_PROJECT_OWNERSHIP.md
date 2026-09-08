# Firebase project ownership

Reviewed September 8, 2026. Bark Ranger owns `barkrangermap-auth`. Just Dee Dee Music owns `just-dee-dee-music-map` and is maintained in the separate `Just-Dee-Dee-Music-Map` repository.

All Bark hosting, functions, authentication, payment records and Firestore rules stay in `barkrangermap-auth`. Deploy from this repository with explicit `--project barkrangermap-auth` and only the intended resources. The predeploy checks in `firebase.json` cover functions, hosting and Firestore rules, rejecting missing or different project IDs. Run `node --test 03-tests/firebase-project-isolation.test.cjs` to verify these checks. Privileged direct API/console changes or alternate configurations can bypass CLI hooks; separately scoped deployment credentials would further reduce that risk.

## JDDM separation

On September 8 the live JDDM bridge, calendar venue review and morning/nightly activity functions moved to the JDDM Firebase project with a dedicated JDDM service account. JDDM callers and the spreadsheet permissions were updated. All 24 Bark functions outside that migration retained their original deployed configurations. Bark's application source already had no active JDDM endpoints; this was principally a cloud deployment separation, not an application rewrite.

Four old JDDM functions remain temporarily deployed in Bark: `jddmSpreadsheetBridge`, `jddmCalendarVenueReview`, `jddmAppActivityMorning`, and `jddmAppActivityNightly`. Public HTTP access is blocked and the two scheduled jobs are paused. Old JDDM data and unused secret copies are retained for rollback safety through one overnight reporting cycle. Their function status can still show ACTIVE; their presence does not mean they are serving JDDM traffic.

Retirement is gated on successful/intentional-skip nightly September 8 and morning September 9 report receipts in JDDM. The migration follow-up starts after September 9, 2026 at 08:10 America/New_York. The private allowlist, backups and rollback runbook are in the JDDM repository at `work/project-separation/RETIREMENT.md`. Update this status after retirement is verified. Do not prematurely delete the rollback artifacts through a broad functions deployment.

The ORS provider credential was copied into JDDM's own secret store; external provider quota is still shared. Bark actively uses its ORS key, which must remain intact. Firebase separation does not lower JDDM's own read volume or change its five-minute calendar schedules.

The current JDDM ownership guide is `docs/FIREBASE_PROJECT_OWNERSHIP.md` in its repository. Dated audit reports preserve earlier configurations as history; use these ownership guides for new work.
