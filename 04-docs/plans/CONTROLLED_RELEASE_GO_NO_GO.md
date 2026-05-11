# Controlled Release Go / No-Go

Date: 2026-05-09
Release target: 25-50 controlled users.
Status: **YELLOW / conditional GO**.

## Decision

The app is **not a paid-public launch candidate** yet.

The app is a **conditional GO for 25-50 controlled testers** if Carter completes the manual release actions below and deploys Hosting, Functions, and Firestore rules together from one tested commit.

## Go Conditions

- [ ] `npm --prefix functions test` passes.
- [ ] `npm run test:rules` passes.
- [ ] `npm run test:functions:emulator` passes.
- [ ] Signed-in Playwright smoke passes if local storage states are available.
- [ ] Production deploy uses `firebase deploy --only hosting,functions,firestore:rules`.
- [ ] Post-deploy smoke passes.
- [ ] Budget alerts or active manual billing monitoring are in place.
- [ ] Firebase and Lemon dashboards are open during first tester wave.
- [ ] Support inbox/process is ready.
- [ ] Kill switch playbook is open.
- [ ] Lemon checkout remains test mode.

## No-Go Conditions

Do not invite 25-50 users if:

- functions or rules tests fail,
- deploy cannot include Functions/rules/Hosting together,
- app does not load,
- signed-in account state is broken,
- feedback still throws Firestore permission errors in normal signed-in use,
- free cap or premium route gates fail,
- Lemon checkout is live,
- Carter cannot monitor Firebase/Lemon during the first wave.

## P0 Stop Conditions After Launch

Stop invites and pause affected features immediately if:

- blank app or fatal app boot failure,
- auth/session/account leakage,
- Lemon live mode appears,
- incorrect Premium grants/removals,
- webhook loops or entitlement corruption,
- runaway route/geocode calls,
- cost spike,
- direct security bypass for entitlement, leaderboard, or free cap,
- support reports show widespread mobile blocker.

## P1 Fix Before Expanding Beyond 25-50

- Budget alert screenshots captured.
- App Check staged or deliberately deferred with documented risk.
- Lemon test-mode cancellation/refund/expired path re-skimmed after deploy.
- Feedback/support path verified with real tester account.
- Public GitHub/internal docs cleanup decision made.
- Mobile-ish smoke clean on at least one iOS and one Android or Android-like browser.

## Paid Public Launch Blockers

- Lemon live mode is intentionally locked.
- Carter has not approved final live-mode RC switch.
- No real live transaction/refund/cancel smoke has been run.
- Legal/privacy/terms/refund/support drafts need review.
- Trademark/data-source/public GitHub exposure decisions remain.
- App Check/budget/monitoring needs final production proof.

## Final Recommendation

Proceed with 25-50 controlled users only after the manual checklist is complete. Keep messaging controlled, keep Lemon in test mode, and watch Firebase/Lemon/support dashboards closely for the first 24 hours.
