# Offline editing 0.145 — implementation and handoff

User authorized a targeted fix: valid saved offline access after the existing one-second park grace, and removals using that same access. Preserve storage/confirmation behavior. Production hosting remains unchanged. Do not include unrelated dirty workspace files.

Implementation: new immutable app/auth/firebase/premium 145 assets, HTML and manifest. Early bootstrap activates cached Premium with the remembered UID; premium rejects mismatched UID before activation and retains existing expiry/freshness checks. Offline removals use the same validated checkin offline session only while auth is unresolved, journal before changing UI, and do not issue cloud writes. Existing auth replay handles deletion confirmation. Previous release files remain immutable.

Validation completed September 6, 2026:
- Full local unit suite: 476 passed. Includes existing unrelated local test additions; only release-related test changes are committed.
- Current 145 premium tests cover expiry, account isolation, and expected UID rejection before activation. New early-offline-access tests cover one-second timing with both stalled setup and setup-ready/silent-auth, resolved sign-out, and entitlement UI failure without losing saved-pin recovery.
- `node 03-tests/offline-editing-startup-smoke.cjs`: four engine/scenario combinations passed (Chromium/WebKit, stalled initializer/setup-ready with silent auth). Uses a controlled clock advanced 1.5 seconds, real app services, local fake-account fixtures, blocked external requests, and service workers disabled. Both adds and removes become pending; baseline remains unchanged; deletion journal survives reload and its orange deletion state returns. This is not a physical-phone timing measurement.
- Six Playwright cases passed: installed cached shell, cached tile behavior, true hanging-socket cold startup, blue Reload, Sheets rejection, recovery, and stalled-file recovery. Chromium also exercises airplane-mode reload; WebKit cold recovery uses stalled sockets due to its offline service-worker simulation limitation.
- Reproduce browser cases with `BARK_E2E_BASE_URL=http://localhost:4173/index.v145.html npx playwright test startup-network-resilience.spec.js offline-shell-installed-pwa.spec.js`.
- No previous versioned release assets or Firebase production hosting configuration changed.

Remaining checks: physical phone, existing paid cached account, cold launch under poor service, add/remove immediately once pins restore, force-close and reopen, then reconnect and confirm. Test a second account and expired cached Premium. No new offline access is invented for first-time visitors, expired sessions, or resolved sign-out. The previously reported failed-sign-out remembered-pointer issue remains outside this two-fix scope.

Implementation detail: the 10-second cloud boot watchdog remains. Local editing no longer waits behind it; normal cloud initialization continues. The original journals and auth-triggered deletion replay still own durable storage and server confirmation. Local deletion does not call syncUserProgress until a real authenticated user is present. Entitlement activation failure cannot block saved-pin hydration.

Deployment: beta GitHub Pages is usbarkrangers remote main; root index targets versioned HTML. Firebase Hosting production is NOT part of this release. Prior beta commit 27671b3. Use explicit git add list; existing unrelated Google Apps Script/rules/audit work must remain untouched.
