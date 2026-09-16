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

Implementation and verification in progress. No new authentication database or
subscription transfer mechanism is planned. Existing 40-day editing grace and
45-day server acceptance rules remain unchanged; Apple billing grace remains off.
