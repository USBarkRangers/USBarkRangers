# In-app feedback modal: build plan

Goal: one Feedback button opens a modal. The user picks a park (or "General" /
"Missing location"), writes a short message, optionally attaches screenshots, and
presses Submit. That single press posts a structured report to Discord **and** opens a
prefilled email they can edit, add attachments to, and send.

Target: **beta only** for testing. See "Beta isolation" below, because part of this
cannot be beta-isolated.

---

## Feasibility

### The one thing that cannot be built as described

**You cannot attach a file to a `mailto:` link.** The mailto URI scheme (RFC 6068)
defines `to`, `cc`, `bcc`, `subject`, and `body`. There is no attachment parameter, and
no browser implements one. This is not a Safari quirk or a permissions issue; the
capability does not exist.

So "upload screenshots, attach them to the email" cannot happen automatically. Three
honest alternatives:

| Where photos go | How | Verdict |
| --- | --- | --- |
| Discord, via a Cloud Function relay | Browser posts images to a callable, the function forwards them to the channel webhook as multipart | **Recommended.** No Firebase Storage, webhook URL stays server-side |
| Discord, direct from the browser | Browser posts straight to the Discord webhook | **Rejected.** Requires the webhook URL in client JS, where anyone can extract it and spam or deface the channel |
| The email, manually | The email opens in their mail app, so they can attach photos there themselves | Free, but relies on the user doing it |

Recommendation: relay to Discord, and put a line in the email body saying how many
screenshots went with the report, so the two halves reconcile.

### Everything else is feasible, and most of it already exists

| Piece | Status |
| --- | --- |
| Fuzzy park search | `modules/searchEngine.js` already has `normalizeText`, `levenshtein`, `scoreSearchItem`, all exposed on `window.BARK` |
| Park list | `window.BARK.repos.ParkRepo` via `getParkRepo()` |
| Current park from a clicked pin | `marker._parkData` in `renderers/panelRenderer.js` gives `name`, `id`, `state`, `swagType`, `cost` |
| Modal pattern | Established: `*-overlay` + `*-modal`, `role="dialog"`, `aria-modal`, `aria-hidden` toggling. Match `paywall-overlay` or `account-management-overlay` |
| Backend intake | `submitFeedback` is complete: auth, 5-per-hour rate limit, type classification (`general`, `bug`, `idea`, `support`, `missing_location`, `other`), browser metadata, 2000-char message cap |
| Discord routing | Already wired and deployed: bug → `#bugs`, idea → `#feature-requests`, support → `#support-inbox`, rest → `#customer-feedback` |

The backend is done. This is mostly a frontend job plus an image relay.

---

## Decisions to make before building

1. **Signed-out users.** `submitFeedback` calls `requireAuthCallable`. Options: (a)
   signed in gets both Discord and email, signed out gets email only, or (b) open an
   unauthenticated path. Recommend (a): it avoids exposing an unauthenticated write
   endpoint, and the mailto still works for everyone, which is exactly today's
   behavior.

2. **Divergence.** Discord receives what was typed in the form. The email is whatever
   the user actually sends after editing. These can differ. Acceptable, but the Discord
   embed should say "email may have been edited before sending."

3. **Screenshot caps.** Recommend 3 images, downscaled client-side to 1600px on the
   long edge at JPEG 0.8 before upload. A typical phone screenshot lands around
   200-400KB after that, well inside both the callable request limit and Discord's
   per-file limit.

---

## Build plan

### Phase 1: backend (small, additive)

`01-code/functions/opsDiscord.js`
- Add `postDiscordWithFiles(message, files, options)`. Node 20 has native `FormData`
  and `Blob`, and axios handles multipart, so no new dependency. Posts `payload_json`
  plus `files[n]` to the channel webhook.

`01-code/functions/index.js`
- Extend `handleSubmitFeedback` to accept an optional `screenshots` array of
  `{ name, mimeType, dataBase64 }`.
- Validate hard: max 3 files, allow only `image/png`, `image/jpeg`, `image/webp`, cap
  each at ~1.5MB decoded, reject anything else. Never trust the declared mime type
  alone; check the magic bytes.
- Route through the existing `postFeedbackToDiscord`, using the files variant when
  screenshots are present.
- Screenshots are relayed and dropped. Nothing is written to Firebase Storage.

Tests: file validation (type, size, count, magic bytes), multipart shape, and that a
Discord failure still leaves the Firestore write intact.

### Phase 2: the modal (beta client)

`01-code/app/index.html`
- New `#feedback-overlay` / `#feedback-modal` block matching the existing dialog
  pattern.

Fields, deliberately short:
- **Title** at top
- **Subject dropdown**: a combobox over `ParkRepo` using the existing fuzzy scorer,
  with two pinned entries always at the top: `General feedback` and
  `Add a missing location`. Prefills the current park when opened from a pin, and stays
  changeable.
- **Type**: bug / idea / correction. Maps to the backend's existing types.
- **Message**: one textarea, ~6 rows, hard cap 2000 to match `cleanFeedbackText`, with
  a live counter.
- **Name** and **email**: prefilled from the Firebase profile when signed in, editable.
- **Screenshots**: file input, max 3, thumbnails with remove buttons.

`01-code/app/modules/feedbackModal.js` (new)
- Open/close, focus trap, Escape to close, matching the other dialogs.
- Client-side image downscale via canvas before upload.
- Submit flow:
  1. Validate.
  2. Call `submitFeedback`. Show a spinner.
  3. Build the mailto from the same values, including a `Screenshots: N attached to the
     Discord report` line.
  4. Navigate to the mailto.
  5. Show a success state with an explicit **Open email** button as a fallback.

Step 5 matters. After an `await`, a programmatic `mailto:` navigation is unreliable,
especially in the iOS standalone PWA, which already has a documented history of
swallowing navigations in this app. Firing it automatically *and* offering a button
covers both cases.

If the Discord call fails, still open the email. A backend hiccup must never eat
someone's feedback.

`01-code/app/renderers/panelRenderer.js`
- Point the existing `suggest-edit-btn` at the modal with the current park preselected,
  rather than straight to mailto.

`01-code/app/modules/barkState.js`
- Retire the `feedbackEnabled` copy at line 50: *"In-app feedback is paused for beta
  safety. Use the email suggestion option above for now."*

### Phase 3: verify on beta

- Signed in and signed out.
- Desktop Safari/Chrome, iOS Safari tab, **iOS standalone PWA** (the risky one).
- Screenshots: 0, 1, and 3. Oversized file rejected cleanly. Non-image rejected.
- Confirm the Discord post lands in the right channel per type, and that the email
  opens prefilled.
- Confirm the 5-per-hour rate limit returns a friendly message, not a stack trace.

### Phase 4: promote to production

Standard flow from the release notes: promote the tested commit to Firebase hosting.

---

## Beta isolation, and the part that is not isolated

Per the release flow, beta (GitHub Pages) and production (Firebase) **share one
backend**: same Firebase project, Firestore, Auth, and Cloud Functions. Only the
frontend differs.

So:
- **Phase 2 is beta-only.** The modal ships to the beta client and production never
  sees it.
- **Phase 1 deploys globally.** The `submitFeedback` change and the new file relay hit
  production the moment they deploy.

That is safe here because both changes are strictly additive and production's client
calls `submitFeedback` from nowhere. It is worth stating plainly rather than assuming:
the backend half is live everywhere from day one, and only the button is gated.

---

## Rough effort

| Phase | Size |
| --- | --- |
| 1, backend + tests | Small |
| 2, modal + combobox + image handling | The bulk of it |
| 3, cross-device testing | Medium, iOS standalone is the unknown |

The combobox is the fiddliest part: keyboard navigation, mobile behavior, and filtering
several hundred parks without jank. The existing search engine already solves the
scoring and debouncing, which removes most of the risk.
