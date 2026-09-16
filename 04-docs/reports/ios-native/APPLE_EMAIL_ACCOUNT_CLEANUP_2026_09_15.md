# Apple/email account cleanup — September 15, 2026

Scope: native iOS and `bark-ranger-ios` only. Existing web code, database, OAuth
registration and users are not changed. Google Maps directions remain available.
Pre-existing workspace edits are excluded from these commits.

## Checkpoint 1 — Google sign-in removal

- Read-only native Auth preflight: seven accounts, zero Google-only or unsupported-only
  accounts; Apple is the only configured federated provider. No accounts were mutated.
- Removed the Google adapter, actions, composition/callback wiring, provider-list view,
  retired Apple capability flag and ignored Google callback configuration. Existing
  authentication/account-management permissions and emulator isolation remain.
- Runtime Swift: 101 lines removed, 16 added, **net 85 fewer lines** in the seven
  touched runtime files. Google-specific late-callback test/fake removed; Apple
  request-ID, cancellation and identity-change protections retained.
- Package resolution: **16 → 13** dependencies. GoogleSignIn, AppAuth and GTMAppAuth
  removed; Firebase's gtm-session-fetcher remains. Firebase version unchanged.
- Debug build-for-testing succeeded on Xcode 26.6 / iOS 26.5. Focused account/Apple,
  nonce transport and Apple/Google directions checks: **26 cases / 38 executions,
  zero failures or skips**. Local result bundle:
  `/tmp/bark-auth-cleanup.HiEDyU/Checkpoint1.xcresult`.
- Real Apple consent is not simulated by these tests; device interaction is a separate
  acceptance check. The historical web-project iOS registration is deliberately retained.

## Checkpoint 2 — Account and membership edge cases

### Implemented

- Explicit Sign in / Create account / Forgot password screens. Switching modes
  clears the password; reset replies do not disclose whether an account exists.
  Connected methods, confirmation steps and collision messages replace raw SDK errors.
- Firebase remains the identity owner. Apple linking preserves the signed-in UID;
  an Apple credential belonging to another account is rejected, never merged.
  Same-email sign-in follows Firebase's trusted-provider rules, not an app-written
  email lookup. Hide My Email users are told to link from their existing account.
- Removing Apple requires the remaining password and a verified password email.
  Removing email/password requires fresh confirmation with the linked Apple account.
  Removing the last method is refused. Unlinking does not delete data or cancel billing.
- Identity-changing Firebase requests are serialized until the SDK finishes, even
  if the view is canceled. Existing request-ID, nonce, UID and deletion-recovery
  guards remain. Apple-linked deletion uses Apple confirmation/revocation; other
  accounts use password confirmation.
- **Reproduced security bug in the pinned Firebase 12.19.1 SDK:** its async
  reauthentication bridge accepts a non-nil result before checking a simultaneous
  `userMismatch` error. The callback can supply both when the wrong Apple account
  is used. AccountService now checks the callback error first and verifies the
  returned UID. Regression checks cover both reauthentication and unlinking.
  No vendor package was patched or upgraded.
- **Reproduced Premium bugs:** paid expiry retained the active-plan label during
  editing grace; a delayed Free purchase-context reply could overwrite newer
  confirmed subscription presentation. The existing entitlement timer now publishes
  both expiry boundaries; purchase presentation honors the local writer's revision
  plus subscription check time. No second membership cache or reconciliation job.

Existing 40-day editing grace and 45-day server acceptance remain unchanged;
Apple billing grace remains off. Saved data stays readable after access ends.
Refunds/revocations and renewal ownership retain the existing server checks.

### Native settings and boundaries

- `bark-ranger-ios` Auth now enforces eight-character new/reset passwords, with no
  forced upgrade of existing users at sign-in. Email-enumeration protection stays on.
  Read-back confirmed; a seven-character disposable sign-up was rejected before
  account creation. No real user account was changed.
- Apple private-email relay settings show both native senders registered with
  valid SPF. This does not prove inbox placement or real relay delivery.
- No new collections, provider mirror, subscription transfer, callable, rules or
  indexes. Native functions required no code deployment. The web app/project,
  historical web OAuth registration, payments and users were not touched.

### Verification

- Native backend: **132 passed, zero failures/skips**, including purchase ownership,
  replay, renewal, refund/reversal, sandbox separation and 45-day upload acceptance.
- Domain: **50 passed**; project isolation: **5 passed**.
- StoreKit simulator: **1 passed**, exercising purchase, restore, renewal, refund
  and transaction redelivery. Local StoreKit is not live Apple sandbox acceptance.
- Latest focused account/Apple/expiry/purchase run: **35 cases / 48 executions,
  zero failures/skips**; offer-code ownership/redemption: **6 passed**.
- Auth emulator exercises real Firebase SDK linking, collisions, password reset,
  remaining-method confirmation, private-relay-shaped identity and same-email UID
  preservation. Its unsigned Apple fixtures do not prove Apple's signature verification.
- Two account-feature fixtures attempted sign-in synchronously while cleanup was
  `.checking`, producing no action. They now wait for the same readiness gate as
  the real disabled form; persistence assertions and deadlines are unchanged.
- UI automation explicitly declines Apple's real strong-password suggestion to
  enter the disposable fixture password. Password suggestions remain enabled in
  the app; no expectation was removed to bypass the system sheet.

- The broader native-profile run passed **50 of 51 cases**; the remaining UI case
  expected the signed-out email cell to exist without scrolling at accessibility
  XXXL. Its captured hierarchy shows the signed-out welcome text filling the first
  viewport. The test now scrolls to the lazy form cell and still requires it to be
  hittable. The final rerun passed **7 cases / 8 executions, zero failures/skips**:
  the four-appearance/text-size UI flow, both profile persistence cases, and all
  Auth lifecycle cases including new overlapping-sign-in coverage. Together the
  runs cover all **52 current native-profile cases** successfully; this is not a
  claim of a fresh single-run full-app CI pass.
  Final bundle: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-zl3n6ytz/Acceptance.xcresult`.

### Size and ownership

Checkpoint 2 runtime Swift: **311 added / 55 removed, net +256** in nine existing
files. Combined with checkpoint 1: **323 added / 152 removed, net +171**. This is
not an overall line-count reduction: explicit confirmation UI, security checks and
error explanations cost more lines than the removed Google adapter. No new runtime
files, generic provider framework, identity database or subscription owner was added.
AccountService is 243 lines; AccountModel 350; AccountForms 188. New files contain
regression tests only. Existing unrelated workspace changes remain uncommitted by
this task, including route-cache work and legacy web work.

Evidence directory: `/tmp/bark-auth-cleanup.HiEDyU`.

### Device delivery

Release **0.5.33 (93)** built with normal native configuration, passed signature
verification, and was installed/launched on `cjs15pm`. Device inventory confirmed
both version numbers. Installation did not uninstall the app or erase its data.
The device build retains pre-existing native working-copy changes; these task
commits deliberately exclude unrelated route-cache changes.

Checkpoint 1 is `cc789e1`; checkpoint 2 is the commit containing this report update.
Both are pushed only to the native `USBarkRangers/USBarkRangers` repository on
`codex/ios-native-setup`. Full GitHub Native iOS checks are a separate pending run
at handoff, not reported as green from local evidence.

Real Apple consent/link/unlink on the physical device and private-relay email
delivery still require the owner's interaction; automated success is not claimed
as completion of those live acceptance checks.
