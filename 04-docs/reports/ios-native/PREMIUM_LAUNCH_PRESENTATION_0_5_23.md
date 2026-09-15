# Native Premium and Apple offer codes — 0.5.23 (82)

September 15, 2026. Scope: the iOS app and `bark-ranger-ios` only. The existing web app, its backend, users and payments were not changed.

## Approved commercial terms

- Normal U.S. plan: **$19.99/year**, **7-day introductory free trial** where Apple says eligible, auto-renewing.
- **Code-only offer:** one year free, then **$19.99/year with automatic renewal** unless canceled. It does not make Premium free for everyone. The normal 7-day trial does not stack with this offer.
- Family Sharing off. Apple billing grace off. No separately priced discount offer created; its price/duration still require an owner decision.
- App Store Connect saved **Bark Ranger Welcome Year 2026**, offer ID `d700e288-aaab-4797-9fd4-07dd4a2c20c7`, on `swarm.USBARKRANGERS.premium.annual`. U.S. only; new, existing and expired subscribers eligible. Zero production codes generated or distributed.

## Shipped implementation

- Premium explains the features actually present in iOS: Passport/points, saved places, trip stops/notes/directions, walks/expeditions and offline saved data. It does not advertise future journal, cloud photos or multiple dogs.
- Price and trial eligibility come from StoreKit. An account-server error no longer hides an otherwise available Apple price. No fake purchasable price is shown when Apple cannot supply the product.
- Removed placeholder account totals and unfinished-development wording. The owner's authorized temporary grant was revoked with a version-checked update; the account and saved data were preserved. Release does not accept development grants. Membership labels now also respect the effective access decision.
- Native **Redeem offer code**, Restore Purchases and Manage Subscription. Apple discloses and confirms offer/payment terms; the app never handles payment details or issues its own access codes.
- Explicit Bark-account confirmation before linking an unassigned Apple offer. StoreKit owns unfinished delivery; the existing purchase coordinator, NativeStore writer and entitlement publisher remain the only pipeline. No new grant database, queue or reconciliation job.
- The native verifier accepts missing Apple account tokens only through verified offer ownership rules. First linkage requires a signed Apple offer-code transaction and explicit consent, plus current Apple status. Atomic existing ownership prevents two accounts claiming the same subscription. Later tokenless renewals/refunds use that durable owner. Forged and Xcode-local signatures remain rejected in the live verifier; genuine sandbox remains labeled sandbox.
- Native bundled terms/privacy now describe the iOS service and Apple subscriptions. These are factual implementation updates, **not legal approval**; owner/legal review remains a release requirement.

## Verification and cost

- Native backend: **81 unit tests**, **50 Auth/Firestore-emulator integration tests**, all passing; isolated-project guard checks **2/2**. Backend commit `19b1f86` pushed; its isolated native GitHub backend workflow passed. All six native functions deployed successfully in `us-east1`; existing native rules/indexes deployed without schema changes.
- iOS purchase coordinator: **17 tests** passing, including account-switch, lost-reply, duplicate-delivery, cancellation, failed verification and explicit offer-link races.
- Real StoreKit testing on the Mac's iOS 26.1 simulator: annual price/trial, purchase, retained transaction, restore, renewal and refund test passed. This is Apple's local test environment, not proof of live purchases or production offer redemption.
- Measured native purchase verification: ordinary accepted purchase **9 reads / 4 writes / 1 function / 1 Apple status request**; first tokenless offer claim **10 / 4 / 1 / 1**; tokenless replay **10 reads / 2 writes**. Ordinary app startup gains no new read; the extra owner lookup is limited to tokenless purchase proofs.
- Premium's original navigation/legal/unavailable-product/sign-in test and opening-screen contrast, clipping, hit-region and description audit passed at normal and Accessibility XXXL text sizes (**75.525 seconds**). The same run passed all **17 purchase tests**. Final normal/large-text screenshots were visually reviewed; account content wraps without truncation. Evidence: `AcceptanceUI.xcresult` and `acceptance-screenshots/`, outside Git at `/tmp/BarkPremiumRelease.N8XSo1`.
- Additional diagnostic: a second whole-screen accessibility audit after scrolling/back-navigation reported text-clipping on fully rendered text and contrast on content behind the translucent navigation bar; at the largest size it left the List blank. Vertical text sizing did not resolve that extra audit. The original strict opening-screen audit is unchanged; the extra audit is **not claimed as passing** or filtered to hide individual failures. `FullAuditUI.xcresult` preserves the failures. Scrolled content is separately checked visually at both text sizes and by the original navigation assertions. Investigate the repeat-audit/List behavior before calling accessibility acceptance complete.

Implementation commits: backend `19b1f86`, iOS `3d4b397`, both pushed to `usbarkrangers/codex/ios-native-setup`. Swift formatting lint and whitespace checks pass for the changed files. The final phone build is made from a clean Git archive of `3d4b397`, with only the exact native Firebase registration added; no local emulator/account overrides or unrelated working-tree changes are included.

Phone result: Release build succeeded, strict code-signature verification passed, native Firebase project/bundle and production App Attest configuration were checked. Installed **0.5.23 (82)** over the existing app on **cjs15pm**; device inventory confirmed both version numbers. This is a developer-signed phone install, not an App Store distribution. Existing app data was not erased. Remote launch was denied because the phone was locked; iPhone Mirroring also requires the owner to unlock/approve. Visual evidence above is from the simulator, not a claimed hands-on phone launch or purchase. Current iOS GitHub run `34998196199` is pending; native catalog checks for `3d4b397` passed.

## Remaining release gates

1. App Store Connect currently shows the Paid Apps Agreement and bank information **Processing**, W-9 **Active**. Apple must finish processing.
2. Complete the App Store listing/privacy declarations/build submission and obtain app/subscription approval. Apple explicitly blocks production one-time code generation until the subscription is approved and the app is **Ready for Distribution**. No workaround grant was created.
3. Verify a real Apple sandbox purchase and code redemption against the deployed backend, including restore/renewal and account ownership. Local StoreKit plus emulator tests do not replace this acceptance.
4. Complete owner hands-on acceptance and the separate outstanding full iOS CI follow-up. This report does not claim that the earlier account UI CI failure is resolved.

After Apple approval, create private one-time-use codes under the saved offer, choose the code redemption deadline/batch size, and send individual codes to selected people. In-app redemption is under Premium → Redeem offer code; recipients see Apple's exact free period and renewal terms before confirming. Do not publish the full code batch or put codes in Git.

Apple reference: [Set up subscription offer codes](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes).
