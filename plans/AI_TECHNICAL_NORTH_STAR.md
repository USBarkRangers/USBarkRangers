# B.A.R.K. Ranger Map - AI Technical North Star

Created: April 29, 2026
Status: Living technical guide for future AI agents, refactors, bug fixes, and feature work
Audience: AI coding agents, future developers, and the solo maintainer

## 0. Essential AI Summary - Read This First

If you are an AI agent working on this app, follow these rules before touching code:

1. This app is already feature-rich. Do not add major new product surface just because it is easy to code. The current priority is stability, clean ownership, payment readiness, and preserving the official map trust.
2. The core product is the trusted B.A.R.K. map plus a personal B.A.R.K. Passport/trip notebook. Do not turn it into a generic route planner, a social network, or a photo app before the architecture is ready.
3. Official B.A.R.K. data, user visit data, private memories, public tips/reviews, trip data, custom pins, and events must stay separate. Never mix personal notes/photos/reviews into the official park record.
4. The hot map path must stay fast. Do not load user photos, private notes, public reviews, or large trip objects during marker rendering, map panning, search filtering, or CSV data polling.
5. Do not use "logged in" as a permanent stand-in for "premium." Future payment work requires a central entitlement boundary with guest, free account, premium account, and admin states.
6. `window.BARK` is the current module system. Do not attempt a big-bang rewrite to ES modules during normal bug fixes. Improve boundaries incrementally.
7. Keep the good patterns: `syncState()` batching, marker reuse through `MarkerLayerManager`, trip overlay ownership through `TripLayerManager`, settings through `settingsStore`, DOM refs through `domRefs`, scoring through `scoringUtils`, and check-in through `checkinService`.
8. Services should own network/data persistence. Renderers should render. Engines should own domain behavior. State stores should own state. Avoid putting Firebase writes, business rules, and large HTML templates in the same function.
9. Every bug fix should be the smallest safe fix that preserves current behavior. Every feature should define its owner, data model, entitlement rule, render path, and verification checklist before implementation.
10. Before finishing any meaningful code change, manually or automatically verify: app boot, map data load, marker click panel, search, visit tracking, login/logout, trip add/remove, saved route save/load/delete, and low graphics mode when relevant.

The guiding sentence:

> Make every future change reduce the web of hidden coupling, or at least avoid making it worse.

## 1. Why This Document Exists

The app has reached the point where future work can easily damage maintainability if agents keep adding code into the nearest existing file. The codebase currently works because of careful patches, defensive guards, and a lot of global state discipline. That is not enough for payment, passport, journals, photos, public reviews, events, or real scale.

This document is a long-term technical guide so future AI agents can:

- Understand the product direction without rereading every chat.
- Know what must stay clean.
- Know which files are safe patterns and which are danger zones.
- Know what to refactor before adding paid features.
- Track phased work over time.
- Mark technical milestones as complete.
- Avoid tangling new features back into the old web.

Related documents:

- `plans/CURRENT_FEATURE_MAP.md`: current feature inventory and popularity/product ranking.
- `plans/FUTURE_ROADMAP.md`: product, monetization, and feature roadmap.
- `plans/PRODUCTION_AUDIT_REPORT.md`: production-grade architecture audit.
- `docs/audits/GLOBAL_STATE_INTERACTION_ANALYSIS.md`: detailed dependency and state map.
- `docs/audits/REFACTOR_OPINION_REPORT.md`: practical refactor ordering and risks.
- `docs/audits/BARK_LOGIC_BUG_TRIAGE.md`: known and fixed logic bug tracker.
- `CLAUDE.md`: engineering workbook and historical fix queue.

## 2. Product North Star For Technical Decisions

The product should become:

> The trusted B.A.R.K. Ranger map plus a personal B.A.R.K. Passport, route notebook, memory journal, and Facebook-ready sharing engine.

The app should not become:

- A generic itinerary planner.
- A full social network.
- A replacement for the Facebook group.
- A generic dog travel app.
- A photo gallery app disconnected from visits.
- A points game where the map is secondary.

Technical implication:

Every new technical decision should protect the official map, then strengthen personal tracking, then support route/memory/share workflows.

## 3. Current Technical Truth

Stack:

- Frontend: Vanilla JavaScript, no bundler.
- Module pattern: classic script tags and `window.BARK`.
- Map: Leaflet plus leaflet.markercluster.
- Data: Google Sheets published CSV, parsed by PapaParse.
- Auth and database: Firebase Auth and Firestore compat SDK.
- Backend: Firebase Cloud Functions v1 style.
- Hosting: Firebase Hosting from repo root.
- Analytics: GoatCounter.

Runtime truth:

- `<script>` tag order in `index.html` is the dependency graph.
- `core/app.js` runs initialization on `DOMContentLoaded`.
- Most modules register functions or services on `window.BARK`.
- Some legacy globals still exist and are mirrored.
- Firebase `onSnapshot` on `users/{uid}` is the primary account hydration path.
- The map, marker manager, render heartbeat, and settings store are central to performance.

Important current global/state layers:

- `modules/barkState.js`: legacy bootstrap state and `window.BARK` accessors.
- `state/settingsStore.js`: canonical settings store with localStorage and legacy mirrors.
- `state/appState.js`: runtime app state mirrors.
- `config/domRefs.js`: lazy DOM lookup registry.

Do not casually reorder script tags. Load order changes can break the app in subtle ways.

## 4. Existing Good Patterns To Preserve

These are not tech debt. Protect them.

### 4.1 Render Heartbeat

Owner: `modules/renderEngine.js`

Good pattern:

- `window.syncState()` batches work through `requestAnimationFrame`.
- Marker visibility uses fingerprints to avoid no-op work.
- Expensive marker/class updates are coalesced.

Preserve:

- Do not add synchronous heavy work inside every heartbeat.
- Do not add Firestore writes directly from every heartbeat.
- Do not compute photos, notes, reviews, or large route summaries in marker filtering.

### 4.2 Stable Marker Lifecycle

Owner: `modules/MarkerLayerManager.js`

Good pattern:

- Markers are keyed by stable park UUID.
- Marker instances can be updated instead of recreated.
- Park lookup is maintained centrally.
- Marker clicks route to the panel renderer.

Preserve:

- Do not rebuild all markers for simple filter/search/visited changes.
- Do not attach user memories/photos to marker objects.
- Do not let custom personal pins pollute official marker cache.

### 4.3 Dedicated Trip Overlay

Owner: `modules/TripLayerManager.js`

Good pattern:

- Trip badges live in their own layer group.
- Trip markers are not clustered or viewport culled.
- Trip markers are diff-synced.
- Official park pins can be visually hidden beneath trip markers without changing official marker data.

Preserve:

- Do not merge trip markers into the official marker manager.
- Do not let trip-specific notes alter official place data.
- Do not use cluster behavior for trip stop badges.

### 4.4 Central Settings Registry And Store

Owners:

- `modules/settingsRegistry.js`
- `state/settingsStore.js`
- `modules/settingsController.js`

Good pattern:

- Settings are declared in one schema.
- Settings have storage keys, cloud keys, defaults, UI elements, and impact categories.
- Low graphics mode has a preset.

Preserve:

- New settings must go through the registry.
- Avoid one-off `localStorage` settings outside the store.
- Avoid direct DOM checkbox syncing from unrelated services.

### 4.5 Check-In Service Boundary

Owner: `services/checkinService.js`

Good pattern:

- GPS check-in validation is in a service.
- Visit mutation logic is not buried entirely in the panel renderer.
- Check-in radius lives in config.

Preserve:

- Future verification methods should extend this service boundary.
- Do not move check-in rules back into UI rendering code.

### 4.6 Scoring Utilities And Gamification Engine

Owners:

- `utils/scoringUtils.js`
- `gamificationLogic.js`

Good pattern:

- Scoring is deterministic and centralized.
- Badge evaluation is class-based.
- Session-stable timestamps avoid achievement flicker.

Preserve:

- Do not duplicate scoring formulas in profile, leaderboard, or payment code.
- Do not make badge logic depend on DOM layout.

### 4.7 ORS Service Boundary

Owner: `services/orsService.js`

Good pattern:

- Geocoding and directions have a dedicated transport boundary.
- Callers do not build ORS requests directly.

Preserve:

- Future rate limiting or proxying should happen behind this service.
- Do not scatter ORS API calls across UI files.

## 5. Current Danger Zones

These areas need careful work. Do not use them as dumping grounds.

### 5.1 `services/authService.js`

Risk:

- Auth lifecycle, user doc hydration, settings hydration, admin rendering, profile updates, premium gating, saved route loading, expedition syncing, and logout reset are still tightly connected.

Rule:

- Future work should extract small handlers from auth, not add new responsibilities.
- Auth should decide "who is the user?" and broadcast/hydrate account state.
- Auth should not own every feature's UI update.

### 5.2 `modules/profileEngine.js`

Risk:

- Profile stats, achievements, manage portal, leaderboard, ranking, and UI rendering are mixed.

Rule:

- Future Passport work should not simply add another large section here.
- Extract a Passport/memory owner before adding journal/photos.

### 5.3 `renderers/panelRenderer.js`

Risk:

- The marker panel is the natural place everyone wants to add features.
- It already bridges official data, visit tracking, directions, trip add, and UI behavior.

Rule:

- Do not turn the panel into a monster card.
- Future card system should separate:
  - Official place card.
  - Personal memory card.
  - Trip stop card.
  - Public tips card or section.

### 5.4 `engines/tripPlannerCore.js`

Risk:

- Trip UI, trip state, route generation, optimization, inline search, and some HTML rendering are mixed.

Rule:

- Keep trip planner stable.
- Future route notebook features should first define a trip data model and route note owner.
- Do not let search, panel, and route renderer write trip state directly without a controlled API.

### 5.5 `modules/expeditionEngine.js`

Risk:

- Virtual trails, GPS walking, manual miles, overlays, rewards, and walk logs are complex.

Rule:

- Do not expand this before core Passport/payment stabilization.
- If touched, keep changes small and verify walk lifecycle carefully.

### 5.6 Backend Functions

Risk:

- API keys, AI extraction, Google Sheets sync, leaderboard generation, and route proxy behavior need hardening before scale.

Rule:

- Before public write-heavy features, add rules, rate limits, App Check where appropriate, and admin audit trails.

## 6. Non-Negotiable Data Boundaries

The future app must keep these data categories separate.

### 6.1 Official Data

Purpose:

- Trusted B.A.R.K. place facts.
- Program availability.
- Swag info.
- Dog rules.
- Official links.
- Admin-verified notes.

Current source:

- Google Sheets published CSV.
- Admin Data Refinery feeds sheet updates.

Future shape:

```text
officialPlaces/{placeId}
  name
  lat
  lng
  state
  category
  swagTypes
  officialLinks
  dogRules
  lastVerifiedAt
  dataSource
```

Rules:

- Do not store user photos here.
- Do not store private notes here.
- Do not let public tips write directly here.
- Do not let custom pins count as official places.

### 6.2 User Visit Tracking

Purpose:

- Fast answer to "has this user visited this official place?"
- Powers pins, profile counts, achievements, free limits, and Passport.

Current shape:

```text
users/{uid}.visitedPlaces[]
```

Future scalable shape:

```text
users/{uid}/visits/{placeId}
  placeId
  visitedAt
  verified
  verificationMethod
  createdAt
  updatedAt
```

Rules:

- Keep visit records compact.
- Do not put photo metadata in the visit record.
- Do not put long journal text in the visit record.
- If free tracking limits are added, enforce limits server-side or through rules/cloud function, not only in UI.

### 6.3 Private Memory / Journal Data

Purpose:

- Private user-owned notes and photos for official places.
- Loaded only when needed.

Future shape:

```text
users/{uid}/placeMemories/{placeId}
  placeId
  note
  privateRating
  photoCount
  coverPhotoPath
  createdAt
  updatedAt
```

Photo metadata:

```text
users/{uid}/placeMemories/{placeId}/photos/{photoId}
  storagePath
  thumbnailPath
  caption
  width
  height
  contentType
  createdAt
  moderationState
```

Rules:

- Lazy-load only after user opens a memory/passport card.
- Never load all photos on map boot.
- Never show photos on marker hover/pan by default.
- Keep private memories private unless user explicitly exports/shares.

### 6.4 Public Tips / Reviews

Purpose:

- Community-submitted park advice.
- Moderated improvement path for official data.

Future shape:

```text
placeTips/{tipId}
  placeId
  uid
  displayName
  tipText
  category
  status: pending | approved | rejected
  createdAt
  reviewedAt
```

Rules:

- All public content starts pending or admin-only.
- Official data and public tips must be visually separate.
- Useful tips can be promoted into official data only after admin verification.

### 6.5 Trip Data

Purpose:

- Planning and route notebook.
- Facebook advice starter.
- Post-trip recap source.

Current shape:

- `users/{uid}/savedRoutes/{routeId}` with trip days, stops, colors, and notes.

Future shape:

```text
users/{uid}/trips/{tripId}
  name
  status: draft | planned | completed | archived
  createdAt
  updatedAt

users/{uid}/trips/{tripId}/days/{dayId}
  dayIndex
  color
  notes

users/{uid}/trips/{tripId}/stops/{stopId}
  placeId
  customPlaceId
  name
  lat
  lng
  status: planned | visited | skipped | future
  plannedNotes
  outcomeNotes
```

Rules:

- Trip notes do not update official place data.
- Trip stop status does not automatically equal official visited unless user marks/ verifies visit.
- Town/custom stops are not official B.A.R.K. stamps.

### 6.6 Custom Personal Pins

Purpose:

- User-created non-official locations.
- Towns, hotels, personal dog stops, side quests.

Future shape:

```text
users/{uid}/customPlaces/{customPlaceId}
  name
  lat
  lng
  type
  notes
  createdAt
  updatedAt
```

Rules:

- Must look visually distinct from official places.
- Must not affect official Passport stats.
- Must not enter official park search results without a separate personal search mode.

### 6.7 Events

Purpose:

- Organize scattered Facebook event information.

Future shape:

```text
events/{eventId}
  title
  placeId
  lat
  lng
  startsAt
  endsAt
  sourceUrl
  host
  status: pending | approved | rejected | expired
  createdBy
  createdAt
```

Rules:

- Events expire.
- Events need source URLs.
- User-submitted events require moderation.
- Event browse can be free; event reminders/favorites can be premium later.

## 7. Architecture North Star

The target architecture does not need to be academically perfect. It needs to be boring, traceable, and hard to tangle.

### 7.1 Current Accepted Module System

For now:

- Keep classic scripts.
- Keep `window.BARK`.
- Add clearer service/store/engine boundaries.
- Add pub/sub and narrow APIs where useful.
- Avoid big-bang ES module conversion until after payment/passport basics are stable.

### 7.2 Ideal Ownership Model

Use these roles:

- `services/*`: Firebase, ORS, storage, payments, backend calls. No DOM generation.
- `state/*`: app state, settings, entitlements. No DOM generation, no map rendering.
- `engines/*`: domain behavior such as trip planning or route math. Minimal DOM.
- `renderers/*`: build DOM for a surface. No Firestore writes.
- `modules/*`: feature modules where the app still uses legacy ownership. Keep responsibilities clear.
- `utils/*`: pure helpers.
- `config/*`: constants and DOM refs.

### 7.3 Rule For New Features

Before implementing, answer:

1. What is the data owner?
2. What is the UI owner?
3. What service owns persistence?
4. Is it official, personal private, public moderated, trip, custom, or admin data?
5. Is it guest, free account, premium, or admin?
6. Does it touch the hot map path?
7. What existing feature can it break?
8. What smoke test proves it works?

If those answers are unclear, do not start coding.

### 7.4 Rule For Bug Fixes

Bug fixes should:

- Be as narrow as possible.
- Add guards at the ownership boundary.
- Avoid moving unrelated code.
- Preserve behavior unless the bug requires a behavior change.
- Update the relevant doc if it changes architecture or product boundaries.

## 8. Entitlements And Payment Readiness

Payment should wait until the app has a central entitlement concept.

### 8.1 Required Account States

Future code should distinguish:

- Guest: no account.
- Free account: signed in, limited personal features.
- Premium account: paid or founding supporter entitlement.
- Admin: operational/admin privileges.

Do not write new feature checks like:

```text
if (firebase.auth().currentUser) unlock premium feature
```

Instead, future code should use a central entitlement service such as:

```text
window.BARK.entitlements.canUse('savedRoutes')
window.BARK.entitlements.canTrackMoreVisits(currentCount)
window.BARK.entitlements.canUploadPhoto(currentUsage)
window.BARK.entitlements.isAdmin()
```

The exact API can change, but the principle must not.

### 8.2 Entitlement Data Source

Future entitlement should come from a trusted source:

- Firestore subscription state.
- Stripe/Firebase extension metadata.
- Custom claims where appropriate.
- Cloud Function verification for sensitive writes.

Never rely only on:

- LocalStorage.
- Client-side booleans.
- Hidden DOM inputs.
- URL flags.

### 8.3 Payment Before Feature Expansion

Before real payment launch:

- Centralize entitlement checks.
- Add free/premium test accounts.
- Make limits visible and friendly.
- Add server-side enforcement for paid-only writes.
- Add billing status refresh after login.
- Add cancellation/refund behavior.
- Add support path for billing problems.
- Add budget alerts.
- Audit Firestore rules.

## 9. Performance Rules

The map is the app. If performance breaks, the product breaks.

### 9.1 Hot Path Rules

Hot path includes:

- App boot.
- CSV/data load.
- Marker creation/update.
- Search filtering.
- Map pan/zoom.
- Marker click.
- `syncState()` heartbeat.

Never add to hot path:

- Full user photo loads.
- Full journal loads.
- Public review queries.
- Large route history queries.
- All saved route loads.
- Unbounded Firestore reads.
- Heavy text fuzzy matching without budget/cancellation.

### 9.2 Marker Rules

Do:

- Reuse official markers by ID.
- Update marker data in place.
- Toggle classes for state/visibility where possible.
- Keep trip markers in `TripLayerManager`.

Do not:

- Recreate all markers for filter changes.
- Attach large user data to marker objects.
- Let trip/custom markers enter the official park marker cache.
- Add per-marker live Firestore listeners.

### 9.3 Photo Rules

When photos arrive:

- Compress client-side.
- Generate thumbnails.
- Store bytes in Firebase Storage.
- Store metadata in Firestore.
- Lazy-load thumbnails only in cards/lists.
- Never load full-size images by default.
- Enforce upload quotas.
- Add delete path from day one.

### 9.4 Firebase Cost Rules

Avoid:

- Real-time listeners on large collections without limits.
- Writes triggered by render loops.
- Reads triggered by map pan.
- Loading every subcollection at profile boot.
- Public unpaginated review/event/photo lists.

Prefer:

- Explicit fetch on open.
- Pagination.
- Cached summaries.
- Debounced writes.
- Small documents.
- Server-side aggregation where needed.

## 10. Security And Rules Principles

Before adding payment, public content, photos, or events, review Firestore and Storage rules.

Baseline principles:

- A user can read/write their own private data only.
- Admin-only data refinery and moderation tools require admin claim or protected user flag.
- Public content writes should create pending records, not approved records.
- Storage uploads require auth and quota enforcement.
- Premium-only writes should be enforced by trusted server/rules, not UI only.
- Public reads should be limited, paginated, and indexed.
- Admin actions should be auditable where possible.

Specific high-risk areas:

- Photo uploads.
- Public tips/reviews.
- Event submissions.
- Payment entitlement changes.
- Admin spreadsheet sync.
- AI extraction functions.
- ORS routing key usage.

## 11. Refactor Phases And Technical Checklist

Use this section as the long-term technical checklist. Update status as work is completed.

Status legend:

- Not started: no intentional work yet.
- In progress: work started but not fully verified.
- Done: implemented and verified.
- Deferred: intentionally postponed.

### Phase A - Stabilize Current Beta

Goal:

Make current beta reliable without adding major new product surface.

Checklist:

- [x] Boot failure recovery exists.
- [x] Map unavailable fallback exists.
- [x] Trip route pins survive bubble/cluster mode.
- [x] Check-in logic has a service boundary.
- [x] Saved route rendering has been moved out of Firebase service.
- [x] Marker lifecycle has `MarkerLayerManager`.
- [x] Trip overlay has `TripLayerManager`.
- [ ] Finish remaining lower-priority bug triage items in `docs/audits/BARK_LOGIC_BUG_TRIAGE.md`.
- [ ] Add a repeatable smoke-test checklist to the repo.
- [ ] Verify mobile low graphics mode on a real or emulated low-end viewport.
- [ ] Verify login/logout does not leave stale account state.
- [ ] Verify saved route save/load/delete after account switch.
- [ ] Verify no route/trip UI controls disappear in edit mode.

Exit criteria:

- A beta tester can browse, search, click pins, track visits, generate/load trips, and use the profile without major breakage.
- Known bugs are either fixed or explicitly documented.

### Phase B - Add Smoke Tests / Verification Harness

Goal:

Give future AI agents a way to prove refactors did not break the app.

Recommended tests:

- App boots without uncaught exceptions.
- Map container renders.
- Data loads and markers appear.
- Search returns local result.
- Marker click opens panel.
- Manual visited toggle works for a signed-in test user.
- GPS check-in path handles denied permission gracefully.
- Trip add/remove works.
- Town/custom stop popup works.
- Start/end inline search works.
- Save/load/delete route works for test user.
- Settings modal opens/closes.
- Low graphics mode applies expected body/classes.
- Logout clears private state.

Checklist:

- [ ] Create manual smoke checklist in `docs/` or `plans/`.
- [ ] Add browser-based smoke test path if tooling exists.
- [ ] Add data fixture strategy or mocked small dataset for tests.
- [ ] Add test account instructions that do not expose secrets in docs.

Exit criteria:

- Future agents can run or follow a clear verification path before claiming work is done.

### Phase C - Auth And Account Boundary Cleanup

Goal:

Break up auth service so login state does not own every feature.

Target extraction:

- `handleAuthSignedOut()`
- `handleAuthSignedIn(user)`
- `hydrateUserDocument(user, data)`
- `handleCloudSettingsHydration(data)`
- `handleVisitedPlacesSync(placeList)`
- `handleAdminState(data, user)`
- `handleLeaderboardHydration(data)`
- `handleExpeditionHydration(data)`
- `resetGuestRuntimeState()`

Rules:

- Each handler catches its own errors or returns structured errors.
- One broken profile feature should not prevent visited places from loading.
- Logout must clear private state and subscriptions.
- Account switch must not reuse stale cursors or cached private data.

Checklist:

- [ ] Document current auth lifecycle before changing it.
- [ ] Extract one handler at a time.
- [ ] Add error boundary around each handler.
- [ ] Verify login/logout after each extraction.
- [ ] Verify saved routes and visited state after account switch.
- [ ] Remove stale global pagination state where possible.

Exit criteria:

- `authService.initFirebase()` becomes orchestration, not a monolith.
- Auth failures degrade individual features instead of killing the app.

### Phase D - Entitlement Foundation

Goal:

Separate login from premium before payment.

Target owner:

- New `services/entitlementService.js` or `state/entitlementStore.js`.

Core concepts:

- `guest`
- `free`
- `premium`
- `admin`
- Feature gates.
- Usage limits.

Possible API:

```text
canBrowseOfficialMap()
canTrackVisit(currentVisitCount)
canUseVisitedFilter()
canUseMapStyles()
canUseGlobalSearch()
canSaveRoute(currentSavedRouteCount)
canUseTripNotes()
canCreateJournalNote(currentNoteCount)
canUploadPhoto(currentPhotoUsage)
canSubmitTip()
canSubmitEvent()
isAdmin()
```

Checklist:

- [ ] Inventory every current `logged in` gate.
- [ ] Decide which gates remain free account and which become premium.
- [ ] Add central entitlement service/store.
- [ ] Replace scattered `firebase.auth().currentUser` premium checks.
- [ ] Add free test user.
- [ ] Add premium test user.
- [ ] Add admin test behavior.
- [ ] Add UI messaging for locked features.
- [ ] Add server/rules enforcement plan.

Exit criteria:

- Free and premium test accounts behave differently without payment.
- No feature treats login as premium by accident.

### Phase E - Official/Personal Card Architecture

Goal:

Prepare for Passport, notes, photos, tips, and trip stop details without bloating the current park panel.

Card model:

- Official place card: trusted B.A.R.K. data and directions.
- Visit/passport card: visit date, verified status, personal stamp.
- Private memory card: notes/photos, loaded on demand.
- Trip stop card: trip notes, planned/skipped/visited state.
- Public tips card: moderated community tips.

Checklist:

- [ ] Define card responsibilities.
- [ ] Decide where card routing state lives.
- [ ] Extract official place panel rendering from action wiring where practical.
- [ ] Keep current marker click behavior intact.
- [ ] Add lazy-load hook for future memory data, but do not load memories yet.
- [ ] Ensure official card can render without user account.

Exit criteria:

- Future notes/photos can be added without stuffing everything into `panelRenderer.js`.

### Phase F - Passport MVP Technical Prep

Goal:

Turn visited tracking into a scalable Passport foundation.

Checklist:

- [ ] Decide whether to keep `users/{uid}.visitedPlaces[]` short term or migrate to subcollection.
- [ ] If migrating, write migration plan before code.
- [ ] Add visit read/write service boundary.
- [ ] Add free tracking limit enforcement plan.
- [ ] Add Passport view owner, separate from generic profile if possible.
- [ ] Keep map marker visited state fast.
- [ ] Do not load journal/photos in Passport MVP.

Exit criteria:

- Passport can show official stamps, dates, verified/manual state, and progress without slowing the map.

### Phase G - Payment Integration

Goal:

Connect real payment only after entitlement architecture works.

Recommended provider:

- Stripe through Firebase-supported patterns or custom Cloud Functions.

Checklist:

- [ ] Create test products/prices.
- [ ] Payment success writes server-side entitlement.
- [ ] Cancellation removes or downgrades entitlement.
- [ ] Refund/dispute behavior is known.
- [ ] UI refreshes entitlement after payment.
- [ ] Firestore rules enforce premium-only writes where applicable.
- [ ] Billing support contact exists.
- [ ] Budget alerts exist.
- [ ] No payment status stored only in client.

Exit criteria:

- Test user can upgrade, refresh, logout/login, cancel, and see correct access state.

### Phase H - Private Journal

Goal:

Add text notes without photo cost or public moderation.

Rules:

- Notes are private by default.
- Notes are stored outside `visitedPlaces`.
- Notes are lazy-loaded.
- Notes have edit/delete.
- Free users may get a small sample limit.
- Premium users get broader access.

Checklist:

- [ ] Add memory service.
- [ ] Add private memory data model.
- [ ] Add card UI separate from official place data.
- [ ] Add entitlement checks.
- [ ] Add rules so only owner can read/write.
- [ ] Add delete path.
- [ ] Verify notes do not appear in map hot path.

Exit criteria:

- User can add/edit/delete a private note for an official place without changing official data.

### Phase I - Photo Memories

Goal:

Add emotional value with hard cost controls.

Rules:

- Premium or tightly limited sample only.
- Client-side compression.
- Thumbnail generation.
- Storage quotas.
- Delete path.
- Private by default.
- No auto-loading on map.

Checklist:

- [ ] Decide photo quota.
- [ ] Add compression path.
- [ ] Add thumbnail strategy.
- [ ] Add Firebase Storage rules.
- [ ] Add Firestore metadata model.
- [ ] Add upload progress UI.
- [ ] Add delete UI.
- [ ] Add abuse/rate limit plan.
- [ ] Measure storage and egress cost.

Exit criteria:

- Photos are useful, private, deletable, and cost-bounded.

### Phase J - Facebook-Ready Exports

Goal:

Complement Facebook instead of competing with it.

Export types:

- Passport progress card.
- Visit recap card.
- Route advice card.
- Post-trip recap card.
- Event reminder card.

Rules:

- Do not depend on automatic posting to Facebook Groups.
- Generate image and copyable caption.
- Let user manually post.
- Keep exports fast and mobile-friendly.

Checklist:

- [ ] Define export templates.
- [ ] Add copyable caption fields.
- [ ] Use existing share/download fallback pattern.
- [ ] Verify mobile Facebook feed appearance.
- [ ] Avoid exposing private notes/photos without explicit user action.

Exit criteria:

- User can create a useful Facebook-ready asset in under 30 seconds.

### Phase K - Events

Goal:

Organize scattered B.A.R.K. event information.

Rules:

- Start admin-only.
- Add user submissions later as pending.
- Events expire.
- Source URL required.
- Browse can be free.
- Favorites/reminders can be premium later.

Checklist:

- [ ] Add event model.
- [ ] Add admin event create/edit.
- [ ] Add expiration handling.
- [ ] Add list and map surfaces.
- [ ] Add near-me/date filters.
- [ ] Add moderation workflow before public submissions.

Exit criteria:

- Events are useful and trusted without becoming moderation chaos.

### Phase L - Public Tips And Reviews

Goal:

Allow community knowledge without corrupting official data.

Rules:

- Pending by default.
- Admin moderation.
- Report flow.
- Official data visually separate.
- Useful tips can be promoted after verification.

Checklist:

- [ ] Add tip model.
- [ ] Add submit UI.
- [ ] Add moderation queue.
- [ ] Add approved display under official card.
- [ ] Add report/delete flows.
- [ ] Add rate limits.

Exit criteria:

- Public content improves the map and does not damage trust.

### Phase M - Custom Pins

Goal:

Let users save personal non-official places without polluting official map data.

Rules:

- Private by default.
- Visually distinct.
- Separate from official search.
- Does not count toward Passport.
- Can be added to trips.

Checklist:

- [ ] Add custom place model.
- [ ] Add personal marker layer.
- [ ] Add entitlement checks.
- [ ] Add create/edit/delete.
- [ ] Add trip integration.
- [ ] Keep official marker manager separate.

Exit criteria:

- Users can use personal pins without confusing them with official B.A.R.K. places.

## 12. Feature Implementation Template

Copy this before starting a major feature.

```text
Feature:
User problem:
Product layer:
Data category:
Free/premium/admin rule:
Primary owner file:
Service owner:
State owner:
Renderer/UI owner:
Hot path impact:
Firestore/Storage paths:
Security rules needed:
Rollback plan:
Smoke tests:
Docs to update:
```

Required answers:

- What existing behavior can this break?
- How does it stay out of the map hot path?
- How does it avoid mixing official and personal data?
- How does it behave when logged out?
- How does it behave after logout/login?
- How does it behave offline or with failed network?
- What is the smallest useful version?

## 13. Bug Fix Template

Use this when fixing a bug.

```text
Bug:
Observed behavior:
Expected behavior:
Root cause:
Files touched:
Smallest safe fix:
Why this does not broaden scope:
Verification:
Follow-up debt:
```

Rules:

- Fix one bug at a time unless two bugs share the same root cause.
- Do not refactor unrelated code during a bug fix.
- Add guards where ownership boundaries are crossed.
- Keep user-facing behavior unchanged unless the bug is a behavior bug.
- Update bug tracker if the bug is part of a documented list.

## 14. Refactor Template

Use this when extracting or moving code.

```text
Refactor:
Current owner:
Target owner:
Behavior change intended: yes/no
Closure scope changes:
State reads:
State writes:
DOM reads/writes:
Network reads/writes:
Verification before:
Verification after:
Rollback plan:
```

Special rule:

When moving JavaScript out of a function, closure scope changes are real behavior changes unless proven otherwise. Make live references explicit.

## 15. Smoke Test Checklist

Run the relevant subset after any meaningful change.

### Boot And Map

- [ ] App loads without uncaught console errors.
- [ ] Loader dismisses.
- [ ] Map appears.
- [ ] If map fails, fallback appears.
- [ ] Park data loads.
- [ ] Markers appear.
- [ ] Map panning/zooming works.

### Search And Filters

- [ ] Search finds a known park.
- [ ] Clear search restores markers.
- [ ] Fuzzy/abbreviation search still works.
- [ ] Type filter works.
- [ ] Swag filters work.
- [ ] Visited/unvisited filter works when logged in.
- [ ] Global town search does not auto-add without selection.

### Panel And Visits

- [ ] Clicking official park marker opens panel.
- [ ] Town/custom trip marker opens popup.
- [ ] Manual mark visited works.
- [ ] Manual uncheck respects setting and verified lock.
- [ ] GPS check-in handles permission denied.
- [ ] Directions links open.
- [ ] Add to Trip works.

### Trip Planner

- [ ] Add official park stop.
- [ ] Add town/custom stop from dropdown selection.
- [ ] Start park selection works.
- [ ] End park selection works.
- [ ] Day edit mode works.
- [ ] Delete day button remains visible.
- [ ] Remove trip stop from list.
- [ ] Remove trip stop from marker popup.
- [ ] Generate route.
- [ ] Clear trip.

### Saved Routes

- [ ] Save route while logged in.
- [ ] Load route.
- [ ] Delete route.
- [ ] Load more saved routes.
- [ ] Account switch does not show stale routes.

### Profile

- [ ] Login works.
- [ ] Logout clears private state.
- [ ] Stats update.
- [ ] Achievement vault renders.
- [ ] Leaderboard renders or fails gracefully.
- [ ] Manage visited places works.
- [ ] Manage walks works if expedition code was touched.

### Settings And Performance

- [ ] Settings modal opens/closes.
- [ ] Low Graphics Mode applies.
- [ ] Cluster/plain marker toggles behave.
- [ ] Viewport culling behaves.
- [ ] Map gesture settings behave.
- [ ] Ultra-low reload path still works.

### Admin

- [ ] Non-admin cannot access admin page.
- [ ] Admin can access Data Refinery.
- [ ] Screenshot/text processing still queues review data.
- [ ] Sync guard asks before appending new site.
- [ ] Dev tools remain admin-only.

## 16. Definition Of Done

A code change is not done until:

- The implementation is complete.
- The relevant smoke tests have been run or explicitly skipped with reason.
- No unrelated user changes were reverted.
- No large new coupling was introduced.
- New data writes have a clear owner and rules story.
- New UI has a clear owner and does not overload an unrelated renderer.
- Performance hot paths were considered.
- Docs were updated if the change affects architecture, data model, entitlement, or product direction.

## 17. What To Do When Unsure

If the task is a bug:

- Reproduce or inspect the smallest path.
- Fix the boundary that allowed the bug.
- Avoid opportunistic refactor.

If the task is a feature:

- Start with data category and entitlement.
- Define owner files before coding.
- Build the smallest complete slice.
- Do not start with UI if the data model is unclear.

If the task touches payment, photos, public content, or events:

- Stop and check this document plus `plans/FUTURE_ROADMAP.md`.
- Do not implement without rules, limits, and moderation/cost plan.

If the task touches the map:

- Protect marker reuse.
- Protect `syncState()`.
- Protect low graphics mode.
- Test with clustering and plain markers.

## 18. Final Technical Direction

The next version of the app should not be a giant rewrite. It should be a series of clean extractions and thin new boundaries:

1. Stabilize current beta.
2. Add repeatable smoke tests.
3. Break auth into handlers.
4. Add entitlements.
5. Prepare separate card architecture.
6. Build Passport MVP.
7. Add payment.
8. Add notes.
9. Add photos with strict quotas.
10. Add Facebook-ready exports.
11. Add events.
12. Add moderated tips/reviews.
13. Add custom personal pins.

The winning technical strategy is not "perfect architecture." It is disciplined incremental cleanup so every future feature has a home and does not become another strand in the web.

