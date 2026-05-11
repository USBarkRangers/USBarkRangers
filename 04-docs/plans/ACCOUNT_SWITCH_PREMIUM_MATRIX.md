# Account Switch Premium Matrix

Date: 2026-05-03
Branch: main
Scope: New premium/internal app only.

## Status Legend

- PASS
- PARTIAL PASS
- FAILED
- PENDING MANUAL QC
- BLOCKED BY STORAGE STATE
- BLOCKED BY RULES DEPLOY

## Matrix

| ID | Start State | Action | End Account | URL State | Refresh? | Expected Result | Actual Result | Severity | Status | Test Coverage |
|---|---|---|---|---|---|---|---|---|---|---|
| A01 | Signed out | Sign in with Google free account | Free | normal URL | No | Free signed in, premium locked, no verifying state. | Automated with saved free state: free UID/account UI match, `premiumService.isPremium()` false, paywall `free`, premium controls/trails/clustering locked. | P1 | PASS | `account-switch-premium-matrix.spec.js` |
| A02 | Signed out | Sign in with Google premium account | Premium | normal URL | No | Premium signed in, Premium active, premium controls unlocked only after entitlement loads. | Automated with saved premium state: premium entitlement settled, Premium active, filters/styles/trails/clustering unlocked. | P1 | PASS | `account-switch-premium-matrix.spec.js` |
| A03 | Google premium account | Switch Account, then Google free account | Free | normal URL | No | Chooser appears, app shows free account, premium locks, premium state cleared. | App-side chooser prompt is automated; free/free and free/premium distinct-account storage-state smoke passes. Real Google chooser and true same-browser Google Account A-to-B flow still need manual browser QC. | P0 | PARTIAL PASS | `account-auth-smoke.spec.js`, `phase3a-account-switch-smoke.spec.js`, `phase3a-premium-gating-smoke.spec.js`; manual checklist pending |
| A04 | Google free account | Switch Account, then Google premium account | Premium | normal URL | No | Chooser appears, app shows premium account, premium unlocks after entitlement loads. | App-side chooser prompt is automated; premium storage state unlocks only after entitlement and distinct account smoke passes. Real Google chooser and true same-browser Google free-to-premium flow still need manual browser QC. | P0 | PARTIAL PASS | `account-auth-smoke.spec.js`, `phase3a-account-switch-smoke.spec.js`, `phase3a-premium-gating-smoke.spec.js`; manual checklist pending |
| A05 | Google Account A | Switch Account, choose brand-new Google Account B | Brand-new Google account | normal URL | No | New user profile initializes safely, premium locked, no stale account data, no stuck verifying. | Not automated yet because a real new Google account flow requires manual browser/OAuth confirmation. Missing-entitlement/free behavior is covered by saved free state. | P1 | PENDING MANUAL QC | Manual browser QC needed |
| A06 | Google premium account | Sign Out | Signed out | normal URL | Yes | Signed-out state, premium locked, no stale Premium active state. | Automated: premium account starts active, sign-out clears `currentUser`, refresh stays signed out, premium controls/trails/clustering locked, no Premium active text. | P0 | PASS | `account-switch-premium-matrix.spec.js` |
| A07 | Google free account | Open fake checkout success URL | Free | `?checkout=success&provider=lemonsqueezy` | No | No unlock, fallback/verification message does not get stuck forever. | Automated with free state and zero-delay fallback: no unlock, premium controls locked, paywall reaches `verification-delayed` with `Still verifying premium`. | P0 | PASS | `account-switch-premium-matrix.spec.js`, `phase3a-premium-gating-smoke.spec.js` |
| A08 | Google premium account | Open checkout success URL after valid entitlement | Premium | `?checkout=success&provider=lemonsqueezy` | No | Premium active. | Automated with premium state: entitlement settles active, `premiumService.isPremium()` true, Premium active UI shown. | P1 | PASS | `account-switch-premium-matrix.spec.js` |
| A09 | Email/password free account | Sign in with Google premium account | Premium | normal URL | No | Account switches cleanly, no stale data. | Saved storage states prove free and premium accounts do not leak entitlement, but mixed email/password-to-Google transition is not automated. | P1 | PENDING MANUAL QC | Manual/browser or credential-driven E2E needed |
| A10 | Google premium account | Sign in with email/password free account | Free | normal URL | No | Premium locks, no stale premium UI. | Premium-to-free entitlement isolation is covered with saved states; mixed Google-to-email/password transition is not automated. | P0 | PENDING MANUAL QC | Manual/browser or credential-driven E2E needed |
| A11 | Same browser remembered Google session | Switch Account, then Sign in with Google | Selected Google account | normal URL | No | Google account chooser appears because `prompt: select_account` is used. | App-side provider configuration is automated and passes. Real Google chooser visual confirmation is pending. | P1 | PARTIAL PASS | `account-auth-smoke.spec.js`; manual checklist pending |
| A12 | Free account with premium localStorage settings | Refresh | Free | normal URL | Yes | Sanitized to free-safe defaults. | Automated: seeded terrain/visited/premium clustering are sanitized to default/all/false, premium locked. A startup settings autosave `no-app` console bug was reproduced and fixed as BUG-014. | P1 | PASS | `account-switch-premium-matrix.spec.js` |
| A13 | Premium account with premium settings | Refresh | Premium | normal URL | Yes | Premium settings preserved. | Premium account unlock and existing signed-in settings persistence smoke pass. Exact map style plus premium clustering preservation remains a focused follow-up. | P2 | PARTIAL PASS | `phase3a-settings-persistence-smoke.spec.js`; focused style/clustering test pending |
| A14 | Brand-new Google account | Open profile/achievements/trip/profile render | Brand-new Google account | normal URL | No | No runtime console errors; missing user doc initializes safely. | Not automated with a brand-new Google account. Achievement write runtime is blocked by BUG-001 until Firestore rules deploy. | P1 | BLOCKED BY RULES DEPLOY | Manual new-account QC after rules deploy |
| A15 | Account switch during checkout success verifying state | Switch account while verification is pending | New selected account | `?checkout=success&provider=lemonsqueezy` | Optional | No stale verification, no premium leak, helpful message. | Free fake-success and premium success states pass independently. True switch-during-verification flow needs manual/browser QC. | P1 | PARTIAL PASS | `account-switch-premium-matrix.spec.js`, `phase3a-premium-gating-smoke.spec.js`; manual flow pending |

## Findings

- BUG-014 was reproduced by A12: settings autosave could call `firebase.auth()` before Firebase initialized when premium localStorage settings were sanitized at boot.
- BUG-014 fix: `settingsController` now treats “Firebase app not initialized yet” as no cloud-save context and waits for auth instead of throwing.
- Focused matrix smoke passed 4/4 after the BUG-014 fix, covering A01, A02, A06, A07, A08, and A12.
- `playwright/.auth/free-user-b.json` was replaced with a distinct non-premium free account on 2026-05-03. Current UIDs: free `LkevgscKPvPqRg9c5YKKXVqtwv02`, free-B `iZ4liMaO4denEB6swhua3KnbGli2`, premium `6vrN6hQ8VQSzxvKRLuVdxWM2mpD2`.
- Required full e2e smoke with `free-user.json`, `free-user-b.json`, and `premium-user.json` now passes 16/16, including true free/free account-switch isolation.
- Non-fatal production connectivity console noise was observed from the optional Google Sheets data poll and occasional Firestore offline warning. These did not change account/premium state and remain part of the broader BUG-006 console-cleanup sweep, not this auth/premium ownership slice.
- Real Google account chooser behavior cannot be fully automated in Playwright; BUG-013 app-side provider configuration passes, but visual chooser confirmation is still manual.

## Manual QC Checklist

1. Sign in with Google Account A.
2. Click Switch Account.
3. Click Sign in with Google.
4. Confirm Google account chooser appears.
5. Choose Google Account B.
6. Confirm the app shows Account B email and UID.
7. Confirm premium state belongs to Account B and Account A premium state does not leak.
8. Repeat from free-to-premium and premium-to-free.
9. Repeat once from `?checkout=success&provider=lemonsqueezy`.

## Next Cases

- After Firestore rules deploy for BUG-001, run a brand-new account profile/achievement/trip smoke.
- Add a focused A13 premium settings preservation test for map style, visited filter, and premium clustering.
