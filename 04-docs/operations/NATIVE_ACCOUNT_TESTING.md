# Native account testing — Phase 3

Use synthetic accounts only. This setup runs Firebase Auth, Firestore and Functions locally in **demo-barkranger-ios**. The original web app and `barkrangermap-auth` production services are unaffected. No production native Firebase configuration is required.

## Start local services

From the repository root, install pinned dependencies once (Node 22; Java 21 recommended):

```sh
npm ci --ignore-scripts
npm ci --prefix 01-code/functions --ignore-scripts
```

Keep this running in one terminal:

```sh
node_modules/.bin/firebase emulators:start --config firebase.ios-emulators.json \
  --project demo-barkranger-ios --only auth,firestore,functions
```

In a second terminal, seed the fixed test accounts, then leave the catalog fixture running:

```sh
GCLOUD_PROJECT=demo-barkranger-ios FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 \
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098 node 05-tools/scripts/seed-ios-emulators.cjs
node 05-tools/scripts/serve-ios-catalog.js
```

Do not start another copy if these ports are already serving this project. Restart emulators after changing backend modules outside the emulator entry-point folder; hot reload does not reliably cover those external imports. The emulator UI is [localhost:4008](http://127.0.0.1:4008). Password-reset and verification links appear in the local Auth log; no message is emailed. Provider/billing actions are labeled test actions and never call Apple, Google or Lemon Squeezy.

Open `01-code/ios/BarkRanger.xcodeproj`. Choose **BarkRanger Local Accounts → iPhone 17 Pro → Run**. This separate shared scheme supplies a stable disposable account/catalog/preferences scope and loopback endpoints. Ordinary **BarkRanger** Run keeps normal development data separate. Account shows a prominent local-test label. Do not install this fixture scheme as a customer build.

This Mac is set to the local-account scheme and iPhone 17 Pro simulator. Its per-user Project Settings put build products under `/tmp/BarkStableAnchor`; Xcode adds its workspace-named subfolder, while the command-line verification products are at the root. The superseded default-location cache was removed after confirming it was no longer in use. This local setting is ignored by Git and does not affect another developer.

## Test accounts

All use password **BarkTest123!**.

| Email | Expected membership |
|---|---|
| ranger-a@example.test | Active Premium, simulated Lemon provider |
| ranger-b@example.test | Free |
| ranger-expired@example.test | Expired |
| ranger-manual@example.test | Manual Premium |
| ranger-code@example.test | Temporary access-code Premium |

The seed has two preserved visit records (including a retired and an unresolved identity), one saved route with ordered days/notes/custom stops, historical fields, completed expedition data and two achievement representations. Seeding resets only these fixed synthetic accounts and their receipts. Never seed while an app test is modifying them. Restarting emulators without import starts fresh; seed them again for a fresh test, or use emulator export/import for the offline round trip below.

## Your testing loop

1. Sign into A in Account. Confirm Premium, saved counts and the retained-record notice. Change the display name. “Saved on this iPhone” means the local transaction succeeded; Sync separately shows whether it reached the server.
2. Home → Settings: Standard/Satellite sync for Premium. Offline overview, search, grouping, camera and units remain device preferences. Return to Map and check the previous Phase 2 interactions.
3. For an offline round trip, export emulators to a disposable folder using `firebase emulators:export /tmp/bark-account-offline --config firebase.ios-emulators.json --project demo-barkranger-ios`. Stop the emulator terminal, leaving the catalog server running. Change name/eligible appearance, close and reopen the app. The local edit and pending count must remain. Restart emulators with the same start command plus `--import /tmp/bark-account-offline`; do **not** reseed this test. Tap Sync now. Pending should clear after acceptance.
4. Sign out, sign into B, then return to A. A's name/entitlement/pending work must never appear in B. Failed sign-out must retain the current account. Free/expired access must not erase saved local history. A fresh free account cannot download routes protected by the existing Premium rule.
5. For a conflict, save an offline name, change A's `displayName` **and** `username` through the local emulator UI, reconnect and sync. Review local/server values and choose which to keep. No silent overwrite is expected.
6. Exercise reset, verification, a newly created synthetic account and deletion. Deletion requires re-confirming identity and typing DELETE. Existing-provider management/recovery/cancellation is explicitly simulated. Real Apple/Google sign-in needs the separate prerequisites below.
7. Stop emulators and relaunch while signed in. Public parks must still open and the remembered account's local copy must remain available. Network/server errors must not claim a fresh cloud copy or silently replace saved records with empty data.

Automated tests cover dropped responses, stable retries, altered payload reuse, permanent rejection, read/write cancellation, low-storage failure, account switching, late reads, provider UID checks and exact transactions. There is no debug toggle pretending to drop a real provider payment response.

## Reproduce automated checks

With the local services running and fixtures seeded:

```sh
GCLOUD_PROJECT=demo-barkranger-ios FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 \
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098 node --test 03-tests/ios-native-emulators.test.cjs

xcodebuild -project 01-code/ios/BarkRanger.xcodeproj -scheme BarkRanger \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -derivedDataPath /tmp/BarkPhase3Check CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build-for-testing
python3 05-tools/scripts/test-ios-accounts.py --products /tmp/BarkPhase3Check/Build/Products \
  --destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5'
```

Simulator builds use an ad-hoc signature because Firebase Auth needs the Keychain entitlement. `CODE_SIGNING_ALLOWED=NO` is appropriate for an unsigned device compile check, not the simulator Auth tests. Warnings-as-errors is set for app/test targets in Base.xcconfig; do not impose it on third-party packages globally.

Ordinary Product → Test keeps the hosted app isolated and skips the two explicit emulator tests. The helper adds their opt-in flag to a temporary generated test-run configuration, then removes only that copy. CI runs both ordinary and emulator-backed paths and has no deployment step.

## Live provider and release prerequisites

Read-only inspection during Phase 3 found only a web Firebase app registered in `barkrangermap-auth`. No native app was created. Later, with explicit authorization:

- Register the actual iOS bundle `swarm.USBARKRANGERS` in that project; use its genuine GoogleService-Info.plist and enable the required providers.
- The currently selected personal Apple development team cannot provision Sign in with Apple. Use the simulator for this handoff; real provider testing needs the appropriate registered developer team/capability.
- Configure the matching Apple team/app identifier and Sign in with Apple capability/provisioning; confirm token revocation on a physical device.
- Set the genuine Google reversed client ID in ignored Accounts.local.xcconfig; verify callback/link/cancellation flows with the registered iOS client.
- Review and deploy only the new native callable entry points/rules after the later rollout plan, provision receipt TTL, and verify native field/access contracts against approved test accounts. Local emulator functions/configuration are blocked from deployment.
- Complete real-device and minimum-iOS verification, privacy/account-deletion review and later StoreKit integration. Build success is not App Store readiness.

Never copy a web app ID into the native app, connect to JDDM, use current paying customers as fixtures or enable the production wrappers just to make local testing pass.
