# Saved places: Premium editing, free read access

Owner-requested policy correction, September 15, 2026. Implementation commit: `a77cde6`.

## Behavior

- Signed-in Premium accounts can save/remove searched-place bookmarks. The existing Apple offline editing/upload grace policy applies; no second entitlement policy was introduced.
- Free accounts can read, display and filter existing saved pins. Save/Remove is unavailable; the existing Premium screen is offered instead. Guests cannot create new bookmarks through the app.
- The native backend independently requires Premium. Older clients cannot bypass it. Direct Firestore writes remain denied by the unchanged rules.
- Existing pins and local notes are not deleted. Previously accepted operations remain replayable without another mutation after downgrade. Unaccepted pending work rejected for access is retained and resumes after renewal with the same operation ID/bytes.
- Adoption of existing account-owned files remains possible locally to avoid losing read access; its cloud upload still requires Premium. Guest/other-account files are never imported into an account.

## Scope and size

Five production files: **33 lines added, 7 removed (net +26)**. Six test files updated, primarily for the changed policy and downgrade/renewal coverage. No new storage, queue, entitlement, collection or rule system. The web app, legacy backend and unrelated working-tree changes were left untouched.

## Verification

- **126/126 backend checks passed**, no skips, against `demo-bark-native` Auth/Firestore/Functions with Node 22 and Java 21.
- **21/21 selected iOS checks passed**, no skips, on iPhone 17 Pro simulator / iOS 26.5 / Xcode 26.6. Includes actual SDK/model downgrade and account switching, offline pending persistence, storage failure rollback, Premium save/filter/relaunch/remove UI, and guest Premium entry UI.
- **5/5 project-isolation/CI-target checks passed**. Signed simulator build-for-testing succeeded; source diff reviewed.
- iOS evidence: `/var/folders/71/0jrgj85x78g562jhy30l4j600000gp/T/BarkAccountChecks-4lh96yrt/Acceptance.xcresult`.
- Backend evidence: `/tmp/bark-premium-pins-backend22-tests.log`.

The earlier cost audit modeled free bookmark editing because it was permitted then. That assumption is superseded: ordinary free users now make **zero accepted bookmark writes**. A new accepted Premium pin command measures **4 reads / 2 writes / 1 function call**, including the entitlement check. A free-account denial makes no writes. Read-only refresh costs are unchanged.

GitHub implementation push completed. Deployed **only `native-ios:nativeCommand`** using `firebase.native.json` and explicit project `bark-ranger-ios`. Post-deploy inspection confirms all six native functions ACTIVE, only nativeCommand's source hash changed, and runtime/identity/capacity settings unchanged. No rules/index changes were necessary.

Hosted backend workflow [34934458357](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34934458357) passed. Hosted iOS workflow [34934458333](https://github.com/USBarkRangers/USBarkRangers/actions/runs/34934458333) is still running; it is separate from the 21 passing local checks. The physical iPhone is unavailable; this change has not been installed there.
