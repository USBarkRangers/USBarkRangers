# Native cloud-connected acceptance — September 14, 2026

Owner authorized an iOS/backend GitHub checkpoint, deployment to `bark-ranger-ios`,
restricted temporary paid-feature testing, and a signed iPhone build. No changes to
the web app, existing production project, old users or old payments are authorized.

## Delivery order

1. Checkpoint the existing locally verified iOS/native backend source on the existing
   `codex/ios-native-setup` branch in `USBarkRangers/USBarkRangers`.
2. Configure native Authentication and deploy only native functions, rules and indexes
   with `firebase.native.json` and explicit `--project bark-ranger-ios`.
3. Install the exact native registration and configure App Check before Firebase starts.
   Debug device registrations must remain private; Release must not use a debug provider.
4. Grant expiring, administrator-controlled development access to the owner's verified
   new account. Do not label this as a verified App Store purchase or expose a grant endpoint.
5. Build, sign and install the app; verify cloud sign-in/save/note/relaunch/persistence,
   then offline editing and reconnect. Record the actual evidence and any incomplete step.
6. Push the integration changes and report the installed version and remaining gates.

## Current status — September 14, approximately 01:40 EDT

Native backend is deployed; **0.5.16 (75)** is signed, installed and launched on the
owner's connected iPhone 15 Pro Max. This is a first cloud-connected development build,
not full Phase 1, App Store, 100K-user or physical offline/reconnect acceptance.
The old web app and existing Firebase project were not modified or deployed.

- Initial iOS/native-backend checkpoint **1796b15** was pushed to
  `USBarkRangers/USBarkRangers`, branch `codex/ios-native-setup`. Integration changes
  receive a second checkpoint; use the branch log for its final identifier.
- Native Authentication is initialized (console reports Identity Platform), with
  email/password enabled and anonymous sign-in disabled. No users were imported.
- `nativeCommand` and `nativeRead` are ACTIVE in us-east1, running as the separate
  native-ios-runtime identity. Both have zero minimum and two maximum instances,
  concurrency ten. This is conservative development capacity, not launch sizing.
- Rules deployed and all five composite indexes READY. Command handlers require
  Authentication and App Check; direct client writes cannot grant Premium.
- Keyless deployment uses native-ios-deployer, not the owner's broad identity inside
  the Firebase CLI. Exact-target guards/configuration and old default alias remain intact.
  Artifact Registry cleanup is seven days. No hosting or old functions were deployed.
- The app bundles the exact new Firebase registration. Its Debug phone App Check
  token is privately registered. Release uses App Attest, whose paid-team setup is pending.
- The reviewed 393-park catalog is published in the native-only public catalog bucket
  and configured in the app. Length and SHA-256 were verified; public GET succeeds.
  Automated catalog publication remains unfinished. Private data must never enter that bucket.

## Evidence and its limits

- Small real-cloud backend QA passed account creation/bootstrap, missing-auth and
  missing-App-Check rejection, free-write rejection, denial of direct entitlement
  forgery, trip creation, note-only save, exact receipt retry and server readback.
- The actual iOS SDK/cloud test passed with **one test, zero failures/skips**, including
  app-bound Authentication/App Check, a trip with a custom pin and note, library/readback,
  durable queued note editing, close/reopen of local storage, then delivery through a
  replacement sync worker. It verifies note revision two and unchanged itinerary
  revision one. Final result:
  `/Users/carterswarm/Library/Developer/Xcode/DerivedData/BarkRanger-hklpzmwkhkpgbwfmlyvsmsibflcr/Logs/Test/Test-BarkRanger-2026.09.14_01-35-46--0400.xcresult`.
  This uses a disposable QA account in the simulator. A controlled worker pause is
  **not** physical airplane-mode testing, process relaunch UI acceptance, or the owner's trip.
- One keyboard UI test passed blank-space dismissal, input refocus and unchanged text:
  `/Users/carterswarm/Library/Developer/Xcode/DerivedData/BarkRanger-cqexjtvaftvyyngzpuwhdgmlgtoh/Logs/Test/Test-BarkRanger-2026.09.14_01-33-30--0400.xcresult`.
  Keyboard dismissal is scoped to the Account form; controls/text inputs keep their taps.
- All **37** native backend unit/integration/transport checks passed serially against
  isolated emulators, plus **four** old/native project-isolation checks. Release-domain
  development-access/expiry check passed. These are regression evidence, not load acceptance.
- Debug device build/install and the complete generic simulator Release build succeeded.
  A Debug simulator build with the native
  registration temporarily absent also succeeded with the expected warning, preserving
  inert local testing; the original private plist was restored immediately.
- Earlier false starts are not counted as passes: wrong device ID; SDK test runner using
  the wrong App Check environment name; zero-test stale bundle; UI fixture without an
  Auth provider; and an overly broad directory input that did not grant the build script
  read access to the plist. Fixed the runner/fixture/input and verified actual test counts.
- Disposable cloud QA and verification-probe accounts were disabled after acceptance,
  their refresh sessions invalidated and the QA App Check registration revoked. The
  owner's account/device registration were retained. Synthetic evidence documents
  remain in the new project; no owner data was removed.

## Owner access and email gates

The authorized test account is **junior.ranger423@gmail.com** (no dot before 423).
At the latest check its native account/profile exists but emailVerified is false.
**No owner development grant has been issued.** After genuine email verification,
run the exact-target administrator helper for this email, at most 14 days, then
refresh the app account. Never manually mark the owner's email verified or use their
private verification link. No owner password was requested or used in automated QA.

The existing app uses Account → Send verification email, followed by I verified my
email after opening the received link. Automatic verification-on-signup is not added.
The reported browser error remains unresolved for the owner's specific email: a real
generated link verified a disposable probe successfully, while Firebase's console
preview contains dummy `mode=action&oobCode=code` parameters that produce that exact
error. This is a possible explanation, not proof of what the owner clicked.

Owner approved **noreply@ios.usbarkrangersmap.com**. Firebase's native sender display
name/reply-to are configured; custom-domain DNS is **not added yet** because Cloudflare
requires the owner's sign-in. The wizard provided these exact new-subdomain records:

| Type | Name | Value |
| --- | --- | --- |
| TXT | ios.usbarkrangersmap.com | v=spf1 include:_spf.firebasemail.com ~all |
| TXT | ios.usbarkrangersmap.com | firebase=bark-ranger-ios |
| CNAME | firebase1._domainkey.ios.usbarkrangersmap.com | mail-ios-usbarkrangersmap-com.dkim1._domainkey.firebasemail.com. |
| CNAME | firebase2._domainkey.ios.usbarkrangersmap.com | mail-ios-usbarkrangersmap-com.dkim2._domainkey.firebasemail.com. |

Use DNS-only CNAMEs, check for existing exact-name records before adding, then verify
in the native Firebase wizard and confirm the resulting sender. Do not alter root
SPF/DKIM, existing Email Routing or the web project's templates. Authentication improves
sender legitimacy but cannot guarantee Gmail inbox placement. Do not redeploy a web app
to address Firebase's hosted verification handler.

## Remaining acceptance

1. Owner signs in to Cloudflare; add/verify native-only sender records.
2. Resolve the owner's received verification link, confirm verified identity, issue
   the authorized expiring grant, and confirm access is visible after account refresh.
3. On the actual phone, save a trip/note through the UI, relaunch and confirm persistence,
   then perform a real offline edit and reconnect. Not yet completed on the owner's account.
4. Apple sign-in/purchases, real StoreKit/server verification, native account deletion,
   support submission, automated catalog publication and full operational/release
   acceptance remain unfinished. Comments are not implemented Apple services.
   Keep current UI/product limits; do not call this all of Phase 1 complete.

The approved budget is a $25/month alert (not a spending cap), with a $10 development
ceiling. No large cloud load test is authorized. The phone was connected at this run's
initial inspection. Existing production and the web app remain untouched.
