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

## Acceptance status

In progress. Previous passing emulator checks are local regression evidence, not cloud
or physical-device acceptance. Apple purchases, Apple sign-in and final release
acceptance remain separate unfinished work. Keep the current UI and product limits.

The approved budget is a $25/month alert (not a spending cap), with a $10 development
ceiling. No large cloud load test is authorized. The phone was connected at this run's
initial inspection. Existing production and the web app remain untouched.
