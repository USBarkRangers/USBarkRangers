# Firebase project ownership

Reviewed September 9, 2026. Bark Ranger owns `barkrangermap-auth`. Just Dee Dee Music owns `just-dee-dee-music-map` and is maintained in the separate `Just-Dee-Dee-Music-Map` repository.

All Bark hosting, functions, authentication, payment records and Firestore rules stay in `barkrangermap-auth`. Deploy from this repository with explicit `--project barkrangermap-auth` and only the intended resources. The predeploy checks in `firebase.json` cover functions, hosting and Firestore rules, rejecting missing or different project IDs. Run `node --test 03-tests/firebase-project-isolation.test.cjs` to verify these checks. Privileged direct API/console changes or alternate configurations can bypass CLI hooks; separately scoped deployment credentials would further reduce that risk.

## JDDM separation

On September 8 the live JDDM bridge, calendar venue review and morning/nightly activity functions moved to the JDDM Firebase project with a dedicated JDDM service account. JDDM callers and the spreadsheet permissions were updated. All 24 Bark functions outside that migration retained their original deployed configurations. Bark's application source already had no active JDDM endpoints; this was principally a cloud deployment separation, not an application rewrite.

Final JDDM retirement completed September 9 at 08:20 America/New_York after the nightly September 8 report was sent and the morning September 9 report was intentionally skipped. Both executions succeeded in JDDM. The four old JDDM functions, two paused schedules and their topics, 135 unchanged backed-up documents and six unused JDDM secret copies were removed from Bark. The explicit retirement allowlist is now absent.

Bark's 24 production functions and five remaining scheduler configurations were verified unchanged, as were its ORS secret metadata and versions. The Bark public site remained available. All 11 JDDM schedules retained their settings and the JDDM bridge/calendar checks passed. Private source archives, document backups, deletion receipts and `retirement-complete.json` remain in the JDDM repository under `work/project-separation/`. Do not restore obsolete JDDM endpoints or schedules to Bark.

The ORS provider credential was copied into JDDM's own secret store; external provider quota is still shared. Bark actively uses its ORS key, which must remain intact. JDDM routing is disabled. Its calendar schedules were separately changed to hourly, and its separate efficiency release preserves five-minute inbox and booking monitoring. These JDDM changes do not modify Bark's routing or database.

The current JDDM ownership guide is `docs/FIREBASE_PROJECT_OWNERSHIP.md` in its repository. Dated audit reports preserve earlier configurations as history; use these ownership guides for new work.
