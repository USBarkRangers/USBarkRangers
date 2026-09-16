# Native configuration

Current target: **bark-ranger-ios** only. Do not restore old account/provider configuration.
Bundle ID: `swarm.USBARKRANGERS`; iOS 18.4 minimum, Swift 6 with complete concurrency
checking. Xcode 26.6 / Swift 6.3.3 is the locally verified toolchain.

## Registration and signing

Download the exact Firebase iOS registration
`1:360077919845:ios:cd94b1ea6899f95da6e88c` from `bark-ranger-ios` and place its
`GoogleService-Info.plist` in `BarkRanger/`. The plist and all `*.local.xcconfig`
overrides stay out of Git. The build guard and AccountAssembly validate the exact
project, app and bundle. Wrong configuration fails the build; absent configuration
blocks Release and leaves Debug accounts unavailable, with public discovery intact.

`BARK_DEVELOPMENT_TEAM` or ignored `Signing.local.xcconfig` controls device signing.
The owner reports paid Apple enrollment approved on September 14. Verify the paid
team and provisioning before changing the current local signing configuration.
Simulator SDK tests need ad-hoc signing (`CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES`).

## Accounts and App Check

Firebase 12.19.1 is pinned. GoogleSignIn, AppAuth and GTMAppAuth are removed;
Firebase-required Google dependencies remain. Auth, Firestore, Functions and
App Check are linked, not Analytics. Email/password is enabled in the new project.
Native Auth enforces an eight-character minimum for new/reset passwords, matching
the app. Existing users are not forced to upgrade their password at sign-in.
Email-enumeration protection remains on. Firebase owns linked providers; removing
one requires fresh confirmation of the remaining method, and Apple removal also
requires a verified password email. There is no Firestore identity mirror or
automatic app-written account merge.
Native composition does not use existing users, Lemon Squeezy or old web API keys.
Firestore uses memory cache; the account-scoped native store owns durable data and
pending writes.

NativeAppCheck configures the SDK provider before Firebase construction. Debug uses
privately registered device tokens; never commit them or share raw logs. Release
uses App Attest and still requires paid-team registration, entitlement and device
verification. `-ObjC` ensures Firebase components register. The SDK test-token
environment variable is **AppCheckDebugToken**, not FIRAppCheckDebugToken.

Cloud functions and Firestore are in us-east1. Under Node 22, deploy from the repository
root with `node 05-tools/scripts/deploy-native-ios.cjs bark-ranger-ios`. This uses the
native-only impersonated deployer, firebase.native.json and exact-target guard.
Never use root firebase.json or a default alias. Functions require Authentication
and App Check; direct client entitlement writes are denied.

Temporary development access is an administrator-issued, UID-bound grant limited to
14 days, accepted by Debug only, never represented as an Apple purchase. The grant
helper requires an explicitly authorized verified account:
`node 05-tools/scripts/grant-native-development-access.cjs bark-ranger-ios EMAIL 14`.
There is no callable that grants access.

Accounts support Apple and email/password only. Google Maps directions are unrelated
and remain available. Apple sign-in, revocation on deletion, StoreKit purchasing and
server verification are implemented; real Apple account actions require interactive
device acceptance, not merely simulator test success. Never reuse the retired web
project registration or Google OAuth callback files.

The current [Phase 6 plan](../../../04-docs/plans/ios-native-2026-09-09/prompts/PHASE_6_PURCHASES_INTEGRATION.md)
is Apple-subscriptions-only; it supersedes the earlier multi-provider billing plan.

## Catalog and email

The native manifest is
`https://storage.googleapis.com/bark-ranger-ios-public-catalog/native-catalog/v1/manifest.json`.
Only reviewed public catalog assets belong in this bucket, never account/journal/photo
data. The initial 393-park snapshot has verified length/checksum. Automated native
catalog publication is not yet connected. The app conditionally checks the manifest
and atomically saves changes for offline browsing. Use `https:/$()/host/path` in
xcconfig so the slash pair is not parsed as a comment.

Firebase hosts the native verification handler at /__/auth/action. Real links must
contain Firebase-generated mode, action code and API key. The console's dummy preview
link is not usable for verification. The separate sender
`noreply@ios.usbarkrangersmap.com` is owner-approved. On September 15, both this
sender and `noreply@bark-ranger-ios.firebaseapp.com` were registered in Apple's
private-email relay settings with green SPF verification. This is not a guarantee
of inbox placement or an end-to-end private-relay delivery test.
Never overwrite the existing web sender's root SPF/DKIM records.

## Testing

Ordinary tests use inert accounts. Native emulator checks explicitly select
demo-bark-native on loopback through test-ios-accounts.py. Release ignores test flags.
Keep BARK_DEVICE_ACCOUNT_HOST empty for the normal cloud-connected build.

native-cloud-smoke.cjs performs one explicitly authorized, small live QA run. It
creates a private disposable fixture and refuses to overwrite an existing one.
test-ios-accounts.py --native-cloud-fixture PATH opts into iOS SDK cloud checks with
credentials injected through a temporary mode-0600 manifest, removed after testing.
Never automate with the owner's password. Confirm a nonzero test count and zero
failures/skips; a zero-test exit is not acceptance. Retire disposable accounts and
debug registrations after use.

See [cloud acceptance](../../../04-docs/operations/IOS_NATIVE_CLOUD_ACCEPTANCE.md)
for evidence and remaining device/release gates.
