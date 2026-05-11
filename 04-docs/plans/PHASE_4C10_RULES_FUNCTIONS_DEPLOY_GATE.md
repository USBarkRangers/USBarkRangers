# Phase 4C.10 Rules And ORS Functions Deploy Gate

Status: planning only. Do not deploy Firestore rules or Functions in this phase. Do not edit runtime app code, Functions code, Firestore rules, payment provider code, payment buttons, checkout, or webhooks.

Deploy readiness verdict: NOT READY until the full gate below is re-run fresh, the correct Firebase target and secrets are confirmed, the working tree is clean, and the deploy is explicitly approved by the user/team.

## Goal

Create a reviewed deployment gate for the committed premium backend safety stack before any Firestore rules or ORS callable Functions are deployed.

Recent committed safety stack:

- `ea0cba1` Add Firestore entitlement rules tests.
- `fe76992` Add missing Firestore rules denial tests.
- `ba47595` Enforce premium entitlement on ORS callables.
- `98f8680` Add ORS callable emulator entitlement tests.

## Current Committed Backend Safety Stack

Firestore rules:

- A source-controlled rules baseline protects entitlement, premium/provider/payment, and admin fields from client writes.
- Client owner writes for current app data remain supported, including visits/settings/saved-routes style app data.
- Rules tests cover allowed owner behavior and denial cases for entitlement/admin/payment-sensitive fields.
- `npm run test:rules` has passed in prior Phase 4C verification.

ORS callable Functions:

- `getPremiumRoute` and `getPremiumGeocode` enforce premium entitlement server-side.
- The Functions read `users/{uid}.entitlement` with Admin SDK using `context.auth.uid`, not client-provided user IDs or premium flags.
- Effective premium requires `premium === true` and `status` of `active` or `manual_active`.
- Missing, malformed, free, canceled, expired, and past_due entitlements are rejected before ORS transport.
- Handler-level tests prove denied users do not call the mocked ORS transport and premium/manual users do.
- Callable emulator tests prove real Firebase client `httpsCallable(...)` requests flow through Auth, Firestore, and Functions emulators.
- The emulator suite uses a nock preload, a dummy `ORS_API_KEY=emulator-test-key`, local-only network allowance, and temp-directory ORS logs so tests do not call real ORS.

UI and smoke coverage:

- Prior smoke/entitlement/global-search verification has passed or skipped only when local E2E storage-state configuration was absent.
- This deploy gate requires the configured Playwright smoke command below to run and pass before deploy approval.

## Pre-Deploy Required Commands

Run these from the repository root immediately before deployment review.

```bash
npm run test:rules
npm --prefix functions test
npm run test:functions:emulator
```

Run the configured smoke suite with local storage states so it executes instead of skipping:

```bash
BARK_E2E_BASE_URL=http://localhost:4173/index.html \
BARK_E2E_STORAGE_STATE="$PWD/node_modules/.cache/bark-e2e/storage-state.json" \
BARK_E2E_STORAGE_STATE_B="$PWD/node_modules/.cache/bark-e2e/storage-state-b.json" \
BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/node_modules/.cache/bark-e2e/storage-state-premium.json" \
npm run test:e2e:smoke
```

Run final repository hygiene checks:

```bash
git status --short
git diff --check
```

Expected command result:

- Every rules/functions/emulator test passes.
- The Playwright smoke suite passes with real configured storage-state files.
- No storage-state files, debug logs, emulator temp files, or generated artifacts are staged.
- `git diff --check` is clean.

## Pre-Deploy Manual Checks

Before running any deploy command, confirm:

- The correct Firebase project is selected.
- The production or staging target is explicitly named and understood.
- If aliases/targets are used, the alias maps to the intended project.
- `ORS_API_KEY` secret/config exists for deployed Functions and is not a dummy test value.
- No real ORS key is present in source control, test fixtures, logs, or command history intended for commit.
- No Playwright storage-state files are committed or staged.
- No `firebase-debug.log`, `firestore-debug.log`, emulator export, or test result artifact is committed or staged.
- The premium test user entitlement in Firestore is a map with `premium: true` and `status: "active"` or `"manual_active"`.
- The free test user remains free and does not have a premium/manual entitlement.
- No payment provider, checkout flow, webhook, customer portal, money collection, or payment button work has been added.
- The deploy owner and user/team explicitly approve deploying Firestore rules and the two ORS callables.

## Candidate Deployment Commands

Do not run these in Phase 4C.10. They are documented for the later reviewed deploy step only.

If the project uses Firebase aliases:

```bash
firebase use <correct-project-alias>
```

Deploy Firestore rules:

```bash
firebase deploy --only firestore:rules
```

Deploy only the protected ORS callable Functions:

```bash
firebase deploy --only functions:getPremiumRoute,functions:getPremiumGeocode
```

Recommended sequencing for the later deploy:

1. Confirm target with `firebase use` or the Firebase console.
2. Deploy Firestore rules first.
3. Run post-rules validation.
4. Deploy `getPremiumRoute` and `getPremiumGeocode`.
5. Run post-functions validation.

## Post-Deploy Validation

After Firestore rules deploy:

- Verify normal signed-in app writes still work, especially visit lifecycle and settings persistence.
- Run the visit lifecycle smoke coverage.
- Confirm owner-only app data remains writable for the signed-in user.
- Confirm client entitlement/admin/payment-sensitive writes are denied if practical through a local/manual test.
- Watch Firestore client errors for unexpected permission-denied failures in normal workflows.

After ORS Functions deploy:

- Verify free-user global search is blocked in the UI before paid ORS behavior.
- Verify premium/manual user global search UI is allowed.
- If practical, call `getPremiumGeocode` or `getPremiumRoute` directly as a free user and confirm `permission-denied`.
- If practical, call a premium callable as a premium/manual user and confirm success with minimal ORS spend.
- Avoid broad route/geocode sweeps in production validation; use one or two small representative calls.
- Monitor Functions logs for expected `permission-denied` denials versus unexpected ORS errors, auth errors, or secret/config failures.

Useful post-deploy observation commands:

```bash
firebase functions:log --only getPremiumRoute,getPremiumGeocode
firebase functions:list
```

## Rollback Plan

Preferred rollback path:

1. Stop additional deploys and pause any paid launch activity.
2. Identify the last-known-good commit before the failing deploy.
3. Revert the problematic rules/functions changes locally or check out a rollback branch at the known-good commit.
4. Re-run the same pre-deploy required commands that are relevant to the rollback.
5. Redeploy the prior Firestore rules and/or prior Functions only after the rollback diff is reviewed.

Candidate rollback commands for a reviewed rollback branch:

```bash
git revert <bad-commit-sha>
npm run test:rules
npm --prefix functions test
npm run test:functions:emulator
firebase deploy --only firestore:rules
firebase deploy --only functions:getPremiumRoute,functions:getPremiumGeocode
```

Functions version rollback:

- Check `firebase functions:list`, `firebase functions:log`, Firebase console, and GCP console for the deployed revision/version state.
- If the deployed runtime exposes rollback or revision traffic controls, use the console or supported CLI path to return to the prior known-good revision.
- Do not assume a `firebase functions:rollback` command exists without verifying CLI support in the incident environment.

Emergency enforcement posture:

- If backend enforcement is broken in a way that could spend ORS quota for free users, prefer redeploying a prior known-good Function or a reviewed emergency Function that denies the premium ORS callables closed.
- Keep UI premium gating enabled while backend behavior is repaired.
- Do not collect payments, enable checkout, or market paid access if backend entitlement enforcement is broken.
- If Firestore rules break normal app writes, roll back rules quickly while keeping entitlement/payment/admin field protections reviewed before any paid launch.

## Go / No-Go Checklist

GO only if:

- `npm run test:rules` passes.
- `npm --prefix functions test` passes.
- `npm run test:functions:emulator` passes.
- The configured `npm run test:e2e:smoke` command passes.
- `git diff --check` passes.
- `git status --short` is clean except explicitly approved untracked local-only files.
- Correct Firebase project/alias is selected and confirmed.
- `ORS_API_KEY` deployed secret/config is confirmed and not a dummy value.
- Storage-state files, debug logs, and test artifacts are not staged.
- Premium and free validation users have the intended Firestore entitlement state.
- Deploy approval is explicit.

NO-GO if:

- Any rules, Functions, callable emulator, or smoke test fails.
- Project target or alias is uncertain.
- `ORS_API_KEY` is missing, dummy, or uncertain.
- Storage-state files, debug logs, emulator artifacts, or test results are staged.
- The deploy diff includes runtime app code, unrelated Functions, Firestore rules changes outside the reviewed baseline, payment code, checkout, webhooks, or payment buttons.
- Payment provider work is not ready but someone wants to collect money.
- The team cannot commit to immediate post-deploy validation and rollback monitoring.

## Remaining After Deploy

After this gate is satisfied and a later deploy is completed, remaining paid-launch work includes:

- Payment provider design.
- Checkout and customer portal implementation.
- Webhook verification and entitlement writes.
- Payment test-mode smoke tests.
- Refund, cancel, past_due, expired, and revoke behavior.
- Paid launch release smoke, logs review, and support playbook.

## Post-Gate Status For Phase 4D

Phase 4D context records that this deploy gate has since been completed outside this planning file:

- Firestore rules are deployed.
- `getPremiumRoute` and `getPremiumGeocode` are deployed.
- Rules tests passed.
- Function handler tests passed.
- Callable emulator tests passed.
- E2E smoke passed after deploy.
- Payment provider work has not started.
- Checkout buttons have not been added.
- The ORS key was exposed in terminal/chat and must be rotated before public or paid launch.

Phase 4D payment provider and paywall UX planning is captured in `plans/PHASE_4D_PAYMENT_PROVIDER_PAYWALL_PLAN.md`.

Payment implementation remains stopped until a separate test-mode provider/backend phase is approved.
