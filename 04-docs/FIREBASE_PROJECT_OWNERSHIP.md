# Firebase project ownership

Updated September 13, 2026. Bark Ranger owns existing production `barkrangermap-auth` and the newly owner-approved native rebuild project `bark-ranger-ios` (project number `360077919845`). The native project is under construction, not an accepted replacement. Just Dee Dee Music owns `just-dee-dee-music-map` and is maintained in the separate `Just-Dee-Dee-Music-Map` repository.

Existing Bark hosting, functions, authentication, payment records and Firestore rules stay in `barkrangermap-auth`. Existing-system deployments use explicit `--project barkrangermap-auth` and only the intended resources. The predeploy checks in `firebase.json` cover functions, hosting and Firestore rules, rejecting missing or different project IDs. Run `node --test 03-tests/firebase-project-isolation.test.cjs` to verify these checks. Privileged direct API/console changes or alternate configurations can bypass CLI hooks; separately scoped deployment credentials would further reduce that risk.

## Isolated iOS rebuild

The owner explicitly approved creation of `bark-ranger-ios` on September 13. The project was created under their signed-in Firebase account with optional Gemini and Analytics disabled. This authorizes building the new iOS-only system; it does not authorize modifications to existing projects or their users/data.

- Use only `firebase.native.json` with explicit `--project bark-ranger-ios` for native cloud deployment. Native functions live in `01-code/functions-native`; native rules/indexes live in `06-config/native-ios`.
- `05-tools/scripts/check-native-firebase-project.cjs` accepts exactly this project. Keep the existing guard and root Firebase configuration unchanged. Do not change the repository's default project alias.
- Local native integration uses the non-production `demo-bark-native` emulator project. Emulator IDs must not be accepted by the production deployment guard. A second real staging project requires its own owner-approved identity.
- Database location, paid billing linkage and material spending need owner approval before provisioning. Register only the native iOS app; no web application or imported user data belongs here.
- Native commands must not import the existing Functions entrypoint or depend on its providers/secrets. Publish only reviewed public catalog assets; no cross-project account conversion or synchronization.
- Before live deployment, restrict the deployment identity to the native target, verify the resolved target/configuration, and verify runtime destinations after deployment. CLI hooks are a safeguard, not a credential-isolation boundary.
- Retirement remains a separate owner-led decision after the new system is built, verified and accepted. Nothing here permits disabling any existing service.

## JDDM separation

On September 8 the live JDDM bridge, calendar venue review and morning/nightly activity functions moved to the JDDM Firebase project with a dedicated JDDM service account. JDDM callers and the spreadsheet permissions were updated. All 24 Bark functions outside that migration retained their original deployed configurations. Bark's application source already had no active JDDM endpoints; this was principally a cloud deployment separation, not an application rewrite.

Final JDDM retirement completed September 9 at 08:20 America/New_York after the nightly September 8 report was sent and the morning September 9 report was intentionally skipped. Both executions succeeded in JDDM. The four old JDDM functions, two paused schedules and their topics, 135 unchanged backed-up documents and six unused JDDM secret copies were removed from Bark. The explicit retirement allowlist is now absent.

Bark's 24 production functions and five remaining scheduler configurations were verified unchanged, as were its ORS secret metadata and versions. The Bark public site remained available. All 11 JDDM schedules retained their settings and the JDDM bridge/calendar checks passed. Private source archives, document backups, deletion receipts and `retirement-complete.json` remain in the JDDM repository under `work/project-separation/`. Do not restore obsolete JDDM endpoints or schedules to Bark.

The ORS provider credential was copied into JDDM's own secret store; external provider quota is still shared. Bark actively uses its ORS key, which must remain intact. JDDM routing is disabled. Its calendar schedules were separately changed to hourly, and its separate efficiency release preserves five-minute inbox and booking monitoring. These JDDM changes do not modify Bark's routing or database.

The current JDDM ownership guide is `docs/FIREBASE_PROJECT_OWNERSHIP.md` in its repository. Dated audit reports preserve earlier configurations as history; use these ownership guides for new work.
