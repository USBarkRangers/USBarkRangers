# Bark Ranger: iOS-only backend rebuild and architecture plan

Date: September 13, 2026  
Status: Phase 1 implementation in progress; not integrated or ready for owner acceptance. After source review of the partial implementation, use the [five sequential recovery prompts](/Users/carterswarm/BarkRangerMap/04-docs/plans/IOS_NATIVE_REBUILD_RECOVERY_PROMPTS_2026-09-13.md). Prompts 1–4 finish the build/integration scope below; Prompt 5 hardens and delivers it. See the [execution record](/Users/carterswarm/BarkRangerMap/04-docs/operations/IOS_NATIVE_REBUILD_PROGRESS.md) for verified work and remaining gates.  
Source basis: Production iOS and backend source in the current working tree, not test results.

## 1. Decision and boundaries

Build a new, independent Firebase project for the native iOS product. Design its data around the product's actual entities. Replace the iOS persistence and transport contracts that depend on account-wide raw records. Keep the useful native architecture and current screens.

This is a targeted replacement of the data foundation, not a rewrite of the entire app.

Execution order: **repair and connect account/profile → trips/map → visits/walks/progress → Apple and essential services → harden/deploy/deliver → owner acceptance.** The recovery-prompts document defines the five work batches and their acceptance gates. Section 10 retains the original build/hardening scope contract; it is not a promise of completion in two prompts. Section 9 contains later product milestones, not extra implementation phases for this release.

### Non-negotiables

- iOS only. Build and verify the new native system using new development/acceptance accounts and approved public reference assets.
- All infrastructure activity is restricted to the explicitly approved new native project/environment allowlist. Non-target systems are untouched.
- Current UI remains: five leaderboard entries, the separate personal-standing row, current navigation, map/planner presentation, passport, expedition screens, and existing feature limits.
- Apple purchases replace the old billing integration. No Lemon Squeezy, Gemini, Google Maps API, ORS, or JDDM resources in the new backend.
- Preserve essential native support, account management, catalog publishing, security, and operational monitoring. “Lean” does not mean deleting necessary safeguards.
- Future journal, multiple-dog UI, repeat-visit UI, cloud journal photos, archived trail maps, and related features are roadmap items. Do not implement hidden future screens, placeholder handlers, unused collections, or speculative frameworks during the foundation release. 
- During implementation, add concise future-extension comments at the boundaries listed in §12. This planning task does not edit source comments.
- No account conversion, migration tooling or cross-project synchronization is part of these two phases.
- Existing native sharing and visit export remain supported.
- The implementation ends with a complete native build, AI engineering verification, and the owner's acceptance testing. Separate retirement work appears only in §15.

The production-source audit identifies structural risks; it does not prove that every risk currently causes a crash. No test cases were inspected or run to produce the architecture findings or this revision. During implementation the AI must write/adapt and run appropriate tests, inspect production source, exercise the app, and measure resource use. Existing passing tests are not evidence that an architecture finding is fixed.

### Existing deployment policy must be changed deliberately

The owner has approved `bark-ranger-ios`, and the [ownership policy](/Users/carterswarm/BarkRangerMap/04-docs/FIREBASE_PROJECT_OWNERSHIP.md) and separate native deployment guard now identify that target explicitly. Project/database creation and billing linkage are already recorded; do not repeat them. Preserve the existing configuration/default alias and native/existing guard separation. Scoped deployment credentials and final native application composition remain required before deployment and handoff.

The AI handles project creation and configuration during Phase 1; the owner does not have to create the project first. Resolve the owner-controlled Google/Firebase login, propose/check an available project ID, and confirm the exact identity, region and spending decisions before creating resources. Update the repository policy for that explicit target and preserve all unrelated guards. A new Firebase project is the required isolation boundary; create a separate Google login only if the owner actually wants one.

### Execution ownership and computer control

The AI operates the computer for the implementation: browser/console setup, native project registration, configuration, coding, deployment to approved native targets, simulator/app interaction, engineering tests and delivery. Use reliable purpose-built tools or command-line interfaces where available and computer control for the remaining console/Xcode/App Store Connect steps.

The owner supplies credentials through the provider's secure interface, completes MFA/CAPTCHA or identity checks, approves legal/billing commitments and material product choices, and provides any required device access. Do not ask for passwords or payment details in source files or chat. Do not claim automation can bypass a provider restriction or perform a physical outdoor walk.

Do not turn ordinary build steps into repeated approval gates. Continue within the agreed phase until its outcome is achieved, pausing only for a genuine missing credential, external access, spending approval, or materially different product decision. Keep resumable progress notes; a session/context limit does not create another implementation phase. Public release/submission is not implicit in installing a build for owner testing.

## 2. Engineering judgment: what is good and what needs changing

The code has real strengths: explicit assembly, a pure domain package, actor-owned persistence, durable mutation receipts, bounded trip reads, native routing, and recording recovery. It also has structural inconsistencies that will become expensive as personal data grows.

The central problem is not “SwiftUI is bad” or “Firebase is bad.” It is that account-wide storage, raw legacy dictionaries, and overly broad state owners are being used for data that needs independent identity, lifetime, and loading.

### Keep, with focused adaptation

| Existing design | Evidence | Why retain it |
| --- | --- | --- |
| Explicit dependency assembly | [AppComposition](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/App/AppComposition.swift:85), [AccountAssembly](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/App/AccountAssembly.swift:7) | A clear place to select environment, construct SDK adapters, and create one shared editing owner. No service locator is needed. |
| Pure itinerary rules | [TripDayEdit](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/TripDayEdit.swift), [TripStopPolicy](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/TripStopPolicy.swift), [TripOptimizer](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/TripOptimizer.swift) | Stable targeting, constraints, and ordering belong outside views and Firebase. Adapt types, preserve behavior. |
| A shared active-trip session | [ActiveTripSession](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Itinerary/ActiveTripSession.swift), [TripDraftSession](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Itinerary/TripDraftSession.swift) | The correct ownership direction already exists. Preserve coalesced checkpoints and protection of edits made while a save is in flight. |
| Durable local write before success publication | [LocalStore.save](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/LocalStore.swift:236) | Preserve a single transactional writer and rollback on failure. Change the storage unit, not the durability guarantee. |
| Receipts and account-scoped cancellation | [SyncEngine](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/SyncEngine.swift), [AccountSession](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/AccountSession.swift:66) | A lost response must not repeat an accepted effect; old-account work must not publish into a new account. These are necessary, not gratuitous complexity. |
| Bounded trip observation and acknowledged pagination | [CloudTripLibrary](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/CloudTripLibrary.swift:5) | Current pages are ten records, with scoped active-trip observation. Keep page acceptance after durable local storage and distinguish leaving a query window from deletion. |
| Native routing and map reconciliation | [RoutePreviewService](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/RoutePreviewService.swift), [MapCoordinator](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Discovery/MapCoordinator.swift) | MapKit routing, cache bounds, stable annotation identities, and specialized render helpers need no provider rewrite. |
| Recoverable recording outside account payloads | [RecordingStore](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Expeditions/RecordingStore.swift) | Append-oriented sample storage and checkpoints are the right precedent for high-volume tracks. |
| Validated, cached public catalog | [CatalogRepository](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Catalog/CatalogRepository.swift), [CatalogValidator](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Catalog/CatalogValidator.swift) | Keep offline public discovery, revision/hash checks, and atomic replacement. Relocate ownership and publication endpoints without rebuilding discovery. |

### Change before native-backend launch

| Finding | Production evidence | Required change and concrete benefit |
| --- | --- | --- |
| One account-wide persistence/update unit | [LocalSchema](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/LocalSchema.swift:10) stores one payload; [save](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/LocalStore.swift:236) encodes the entire PersonalState on each save | Store independently addressable entities and outbox records in one local transactional database. Editing one note must not serialize all trips, visits, and history. |
| Competing trip representations | [Trip](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/Trip.swift:58) retains raw stops alongside typed stops; [initialization](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/Trip.swift:94) retains raw itinerary/bookends alongside typed ones | One typed representation. Remove raw dictionaries from native domain models and encode through explicit wire records. Equality and persistence then describe the same content. |
| Route-plan invalidation depends on whole-trip equality | [ActiveTripSession.plan](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Itinerary/ActiveTripSession.swift:22), [TripRoutingModel.update](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Itinerary/TripRoutingModel.swift:14) | Separate geometry dependencies from presentation dependencies. Preserve existing coordinate-keyed road-leg reuse; update labels/colours without treating them as geometry changes. A rebuilt local plan does not by itself prove another directions request. |
| Cached trips and editable drafts share a retention rule | [LocalStore+Adventures](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/LocalStore+Adventures.swift:47) exempts cached account trips from the twenty-draft check | Separate confirmed cache, dirty draft, and explicit offline retention. Evict only reconstructible clean cache. Do not “fix” the exemption by preventing users from opening their saved trips. |
| Shared trip owner has an escape hatch and exposed internals | [TripEditorModel](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Trips/TripEditorModel.swift:24), [RouteDaySheetViewModel](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Discovery/RouteDaySheet/RouteDaySheetViewModel.swift:41) | Require injection; remove fallback session construction. Make draft internals private and expose complete edit/save/conflict commands. This makes correct use easier and accidental second owners harder. |
| AccountSession owns feature/library state as well as account lifetime | [AccountSession](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/AccountSession.swift:6), [pagination](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/AccountSession.swift:229) | Keep identity/scope in AccountSession; move trip paging into its repository/library model and scheduling into its sync owner. Features consume small projections, not the full PersonalState. |
| Account transition behavior is distributed across view callbacks | [RootView](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/App/RootView.swift:98) | One ordered account-scope lifecycle contract. Distinguish identity change from store-ready; preserve recorder draining and guest behavior. Do not merely replace three callbacks with one UID key. |
| Transport mixes unrelated responsibilities and concrete types | [CloudUserTransport](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/SyncEngine.swift:5), [LeaderboardReading](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/LeaderboardRepository.swift:5) | Separate personal-data sync, trip queries, purchases, and account management at useful boundaries. Put response/error types outside concrete adapters; remove silent required-operation no-op defaults. |
| Mutations pair a kind with arbitrary raw values | [UserMutation](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/UserMutation.swift) | Typed command payloads, explicit revisions, stable IDs, and a versioned error contract. No arbitrary document path or unrestricted patch endpoint. |
| Saved places are not yet an account-owned journal foundation | [SavedPlace](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/SavedPlaces/SavedPlace.swift:5), [SavedPlaceStore](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/SavedPlaces/SavedPlaceStore.swift:17) | Introduce stable place identity distinct from name/coordinates and an explicit ownership scope. Preserve current device-only bookmark behavior until the account-journal milestone; never auto-upload old device bookmarks. |
| Map bookmark work grows with the entire loaded library | [MapPlaceAnnotations](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Discovery/MapPlaceAnnotations.swift:15) iterates all saved values | Give the map lightweight, viewport-scoped projections. Keep selected and active-trip markers. Do not send full journal records or image bytes through map state. |
| Legacy aggregate expedition data couples recording and rewards | [ExpeditionRepository](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Expeditions/ExpeditionRepository.swift), [ExpeditionPolicy](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/ExpeditionPolicy.swift) | Independent activity records, small virtual-run state, and server-owned award decisions. Preserve present expedition behavior while making an activity's existence independent of a mutable profile blob. |
| Native finish is not a permanent trail archive | [WalkRecorder.finish](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Expeditions/WalkRecorder.swift:263) commits a summary then removes recording files | Document the future durable-archive handoff explicitly. Do not claim current saved walks preserve their recorded geometry, and do not enable journal uploads now. |
| Backend mutations do broad compatibility/derived-data work | [userMutations](/Users/carterswarm/BarkRangerMap/01-code/functions/user/userMutations.js:72) reads achievement history and rank information and writes legacy projections | New handlers update only touched entities and relevant bounded summaries. Keep existing achievement rules, including any rank-dependent award, but evaluate them deliberately rather than reading all historical awards for every mutation. |
| Logs have a reporting seam but live assembly uses defaults | [Diagnostics](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/Diagnostics.swift:24), [AppComposition](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/App/AppComposition.swift:53) | Connect fixed-category nonfatal failure reporting to the chosen native monitoring path. A failed local store may never produce a backend request or crash. |

### Corrections to earlier critique

- Do not blindly strip tripName from the current Trip.fields: the current name getter reads that field. Rebuild the typed native model once, including its scalar storage.
- Current Trip.record reconstructs itinerary fields from typed values. The duplicated representation is evidence of storage/equality churn; it is not by itself proof of lost edits or corrupt exported routes.
- [DayRouteService](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/Routing/DayRouteService.swift:46) already keeps usable road legs by coordinate key and requests missing legs. Do not claim every note/name change calls MapKit again. [TripRoutePlan](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/TripRoutePlan.swift:13) also contains colours and stop information, so replacing its whole invalidation rule with geometry-only equality would risk stale presentation.
- Current [MutationFailurePolicy](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/MutationFailurePolicy.swift:10) already rejects invalid arguments, reused IDs, permission denial, and several preconditions. An unconditional “permanent failures retry forever” diagnosis is not supported by this version.
- Multiple account lifecycle keys are a coordination risk, not sufficient evidence of an observed race. Preserve the distinct lifecycle milestones.
- An inactive user is not evidence of a broken store. Do not add a blanket stale-account alarm as a substitute for actual failure signals.
- A source review cannot reliably infer the author's years of employment. Implementation decisions should follow the concrete findings above, not an experience score.

## 3. Target architecture

Use one native backend codebase, not a fleet of microservices. Keep the existing BarkDomain package; no package explosion or generic event-sourcing framework.

| Boundary | Owns | Must not own |
| --- | --- | --- |
| SwiftUI views and feature models | Presentation state, user intent, small read projections | Firebase dictionaries, account-wide history, entitlement truth, direct disk writes |
| ActiveTripSession | One editable itinerary, checkpoint/save ordering, conflicts, route input | Account lifecycle, global trip library, journal/media storage |
| AccountSession / AccountScope | Identity, environment+account namespace, opening/closing account resources | Every feature's data and pagination state |
| Feature repositories | Typed commands and bounded reads for trips, visits, profile, activities | UI lifecycle or arbitrary cross-feature state mutation |
| Local entity store actor | Atomic entities, drafts, pending intents, receipts/cursors, protected local persistence | Business presentation or a serialized whole-account graph |
| Personal sync coordinator | Durable delivery, retry scheduling, acknowledgments, scoped reconciliation | Purchases UI, billing URLs, full library presentation |
| Firebase adapters | SDK conversion, queries/listeners, cancellation/deadlines, typed transport errors | Domain rules encoded as legacy key strings in feature code |
| Native backend handlers | Authorization, validation, revisions, idempotency, authoritative rewards/entitlements | Trusted client-supplied points or raw SDK writes into protected data |

Retain local domain validation for immediate/offline feedback. Repeat security-sensitive validation on the backend because the client is not trusted. “Server-owned rules” does not mean removing all useful client validation.

### One trip decision-maker, not merely one injected instance

Move the sequence currently orchestrated by [TripEditorModel.save](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Trips/TripEditorModel.swift:270) into ActiveTripSession: capture the intended draft, await/checkpoint, validate revisions, persist the save intent, accept its result without overwriting newer edits, and publish conflict/success state.

Both Map and Planner send typed operations such as editDay, selectTrip, saveDraftToAccount, clearSelection and resolveConflict. They do not receive mutable session internals or arbitrary repository closures to orchestrate these steps themselves. Presentation-specific timers, sheet dismissal and search proposals stay in screen models.

Required injection alone only forces a caller to supply an instance; it does not prove both screens received the same instance. AppComposition creates and owns exactly one active-trip session per account scope. Construction and all screen wiring must preserve that invariant.

Geometry input includes route-affecting coordinates/order/options and the mapping needed to assign legs to days. Presentation input includes current labels, colours and stop metadata. Preserve route geometry when only presentation changes, and refresh presentation when geometry stays the same. Do not add another independently editable trip copy to implement these projections.

### Ordered account transitions

1. Immediately clear visible old-account projections, invalidate their publication generation, and stop accepting new operations into that scope.
2. Cancel observers and network work; checkpoint/suspend recording and drain owned writes using the explicitly retained old scope, never the new identity.
3. Close the old resources after their drain completes. Do not leave old-account data visible while awaiting that work.
4. Open a namespace keyed by environment/project, UID, and native schema generation. Guest storage is a separate explicit scope.
5. Publish store-ready, then start scoped sync and feature projections.
6. Reject late callbacks whose scope does not match, even if their task was cancelled.

Do not delete legitimate cancellation/revision checks simply to reduce line count. Remove duplicated ownership, not the defenses needed at asynchronous boundaries.

## 4. Data model: current foundation and future extension

All paths below are **proposed**, not deployed resources. Fields are a design contract to finalize in the first implementation milestone.

Use stable IDs, with random IDs for arbitrary user-created entities and deterministic references for known catalog/provider identities as defined below. A display name, geographic coordinate, list position, or dog name is never the primary key. Use official catalog IDs and aliases for official places/trails. Keep an entity revision distinct from its schema version.

### Place identity rules

- Resolve an official place to its canonical catalog ID before creating a private place reference. Within an account, use a deterministic official-place key derived from that canonical identity. Different trips to that known official place reuse its private overlay; retired catalog aliases do not create a second place.
- For a provider-identified place that is not matched to an official catalog place, derive a stable key from provider plus provider ID. Names and coordinates are editable attributes, not identity. Use the same rule in the local and server adapters.
- For an arbitrary pin with no authoritative identifier, generate its ID once and retain it through save, reopen, trip insertion and trip duplication. Adding an existing saved pin to another trip passes its existing ID; it does not call a fresh-pin constructor.
- Do not merge two independent arbitrary pins merely because coordinates are close or labels match. An explicit future merge/link operation can reconcile genuinely duplicated private places; it is not a prerequisite or hidden feature here.
- If later reference data reveals that previously separate provider/custom records are one official place, preserve their existing references until a deliberate reconciliation is implemented. Do not silently rewrite history based on a fuzzy match.
- Deterministic IDs and revisions make concurrent creates of a known place resolve to one record. Repeated creation must preserve existing private text, rather than replacing it with a fresh default.

This is how “notes follow the place into a trip” remains meaningful: the trip must reference the same place, not merely a different record with similar coordinates.

### 4.1 Foundation records for existing functionality

| Proposed record | Contents and ownership | Loading/size rule |
| --- | --- | --- |
| users/{uid} | Small native profile: display name, typed settings, created/updated timestamps, schema version | No visitedPlaces, trip arrays, expedition history, images, or provider billing dump |
| Account-scoped local selection (not a cloud record) | Active trip/day on this device | Preserve the current device-local behavior. Selection must not rewrite itinerary content or add a cross-device conflict/queue |
| users/{uid}/state/entitlement | Server-computed native access and validity, source environment, revision | Owner read; server write only; no private Apple keys or full transaction bodies |
| users/{uid}/state/progress | Small server-computed passport totals and bounded current achievement state | No ever-growing visit/activity/operation lists |
| users/{uid}/trips/{tripID} | List metadata: title, createdAt, updatedAt, status, day/stop counts, content revision | Proposed soft budget 4 KiB; current ordering preserved unless explicitly changed |
| users/{uid}/trips/{tripID}/content/itinerary | One canonical typed bounded itinerary: stable days/stops, coordinates, place references, current day notes and note references | Existing maximum 50 days / 500 stops retained; validate native encoding below the existing 350,000-byte content ceiling, including metadata overhead |
| users/{uid}/places/{placeID} | Minimal private place identity/overlay used by current trip references: coordinate, title, optional official ID/provider ID | Not automatically a new “saved in journal” feature. A stop may create a place reference without starring it on the map |
| users/{uid}/notes/{noteID} | Existing pin/stop-note text, placeID, optional origin trip/stop context, revision, timestamps | Independent canonical text; retain current applicable 1,000-UTF16-unit limit; no image bytes or copied official catalog. Current editor remains the UI |
| users/{uid}/visits/{visitID} | An individual current visit event: place/official ID, happenedAt, recordedAt, source, verification status, revision | Stable visit ID from the start; no identity keyed solely by park ID |
| users/{uid}/placeProgress/{officialPlaceID} | Derived marked/visited state, relevant current visit reference and counters | Makes map/passport queries small. No array of all visits. Canonical aliases prevent duplicate official-site credit |
| users/{uid}/activities/{activityID} | Current walk/Health-import summary, source, dates, distance/duration, optional virtual-run association, revision | Bounded summary only in foundation; no GPS array |
| users/{uid}/virtualRuns/{runID} | Current virtual expedition selection/progress/completion state | Independent from an activity and from the profile; completed runs are pageable records |
| users/{uid}/awards/{awardID} | Server-derived achievement or reward evidence, rule version, source IDs | Deterministic award identity for deduplication; no client writable scores |
| leaderboard/{publicEntryID} | Only intentionally public display name and score fields needed by today's board | Server writes; never expose profile/email/location/journal data through this document |
| Private operation receipts | UID+operation ID, immutable payload fingerprint, outcome, entity revisions, expiry | Server-only records; bounded response content, explicit replay/retention contract |
| Private purchase mappings/events | Apple transaction ownership and processed-notification state | Server only; separate from public leaderboard and user profile |
| Private support reports / deletion jobs | Current native support and resumable account deletion | Explicit retention, operator access, size/rate bounds |

A bounded itinerary document is an intentional tradeoff. Do not create one network document per coordinate or per stop just because the account blob is being removed. A trip is currently edited and saved as a bounded unit. Split list metadata from heavy content now; split days further only if an actual workflow later requires independent day concurrency or larger trips.

Similarly, a bounded array of three participating dog IDs is reasonable later; an array containing all visits, tracks, or photos is not. Firebase recommends different structures for small fixed lists and growing relationships. [Firestore data structure guidance](https://firebase.google.com/docs/firestore/manage-data/structure-data).

### 4.2 Notes: one source, multiple contexts

The model must support the requested experience without changing today's screen layout:

- A place has stable identity. A note is independently stored and linked to that place.
- A trip stop references a place and, where needed for the current editor, a note ID. It does not own another independently editable copy of a shared place note.
- A note may retain its origin trip/visit context. That is useful history, not a second journal.
- Today's stop-note editor reads/writes its referenced note. The future place/journal screen can show all relevant notes and the future trip screen can show shared place information plus trip/visit-context information.
- Day-level itinerary notes remain day-level planning information. They are not silently reclassified as permanent place notes.
- Updating a shared note later updates the same record wherever it is shown. A completed trip may have an immutable summary/version marker, but not another live, editable copy of every note and photo.
- Keep a small title/coordinate snapshot on a stop where needed for offline routing or a deleted/renamed place. This is a historical/navigation snapshot, not a competing editable place record.

Foundation extraction of current note text into note records is current-feature storage work, not a journal UI implementation. Do not implement timeline browsing, photo attachments, cross-trip note aggregation, or new journal actions in that milestone.

Review trip duplication explicitly: personal place notes are shared references; trip-specific planning notes may be duplicated only when they are intentionally independent content. Do not silently change the meaning of the current Duplicate action. If this requires a visible behavior change, gate it for owner approval rather than bundling it into an infrastructure refactor.

Foundation default: preserve today's independently editable trip-stop planning notes as canonical note records tagged with their origin trip/stop. Duplicating that planning content creates intentionally independent note IDs, matching today's meaning; it does not clone a future shared place note. The journal milestone shows place-associated notes together, with optional context sections, and adds shared-place-note editing deliberately. There is one authoritative body per note, not a stored body on both the note and the stop.

ActiveTripSession owns unsaved note edits within its draft. The confirmed note repository owns saved note records. A draft can carry an explicit working copy and base revision for conflict handling, but no screen may treat its copy as a separately authoritative saved note. Conflict, discard and save preserve these distinctions.

Note edits should use a note revision, not invalidate routing or require sending the full itinerary. Creation of a stop, its new place/note, and its references must have a defined atomic bounded command; bulk changes must not leave dangling references.

This separation does not authorize autosaving an unsaved planner draft. Keep draft note changes locally until the current workflow's save boundary; a saved-trip operation commits its dirty note changes and itinerary references coherently. A current direct-note-save action can use a note-only command. Preserve the existing save/cancel meaning in both cases.

Avoid an N+1-read regression: trip lists do not fetch notes, and opening an itinerary does not independently request every historical note. Load the visible note context in bounded batches, cache it locally, and include those reads in the screen budget. Verify the full 500-stop case and bulk note edits before approving this representation; the 350,000-byte logical trip-content budget must still account for the current note text, not shrink artificially to references alone.

### 4.3 Future model: document now, implement at its milestone

| Future entity/relationship | Intended design | Do not build in the foundation release |
| --- | --- | --- |
| Saved personal place | Add explicit account-library membership to place records; official and arbitrary pins both supported | New official-pin save UI, journal listing, or automatic upload of old device bookmarks |
| Journal | One account-wide experience over canonical places, notes, visits, activities, and completed trips | One giant journal document, separate journal per dog, or a generic content platform |
| Journal timeline index, if required | Small rebuildable items with dates/type/source IDs for efficient mixed pagination | Another copy of note text, photos, trip content, or tracks |
| Multiple dogs | users/{uid}/dogs/{dogID}; stable identity and archived state; proposed maximum three active dogs | Dog switcher, per-dog scoring rules, dummy dog creation, or hardwired dog1/dog2/dog3 fields |
| Dog participation | Small dogIDs association on visit/activity/trip; derived per-dog progress records | Copies of the same trip, journal, photo, or GPS trace per dog |
| Repeat visits | New visit IDs to the same place with distinct dates and optional trip/dog associations | A new repeat-visit button or scoring multiplier now |
| Photo/media asset | Private object-storage bytes plus asset metadata/state and explicit links to canonical notes/visits/activities | Upload workers, empty photo endpoints, image processing, or image UI now |
| Recorded trail archive | Activity references protected track object(s), summary, bounding box, and simplified display geometry | Permanent track uploads/archive viewer before the activity-journal milestone |
| Official trail completion | Separate claim/evidence/award referencing a versioned official trail | Treating accumulated virtual distance as proof of physically completing that trail |
| Catalog submission | Explicit selected copy into a review queue with provenance and moderation state | Automatic publication of private journal/location/photo data |

One activity has one recorded path and one measurement source. Attaching two dogs records participation; it does not imply the phone independently measured each dog's speed or distance.

Dogs added later must not automatically acquire all historical visits. Unknown historical participation stays unknown until the user deliberately assigns it. Archiving a dog must not delete shared history.

## 5. Native local storage and sync contract

### 5.1 Replace the blob without replacing the single writer

Keep one account-scoped SwiftData container and a single actor coordinating writes. Introduce entity rows for profile/selection, trip metadata/content, draft, place, note, visit/progress, activity/run, pending operation, and synchronization cursor. Names are illustrative; do not create a separate database for every repository.

Core invariants:

1. A user action that saves account data and the pending intent required to synchronize it commit together. A draft-only checkpoint persists its edits without creating a remote-save intent.
2. A confirmed remote entity, acknowledged operation, and applicable cursor advance commit together.
3. Publish a successful edit only after durable commit. On failure retain the prior valid state and report the failure.
4. Feature streams publish only the projection they need. A profile-name edit does not publish a complete trip/journal archive.
5. Keep confirmed entity content and an active dirty draft where conflict handling needs both. Eliminate accidental extra raw copies, not necessary preimages.
6. Clean downloaded cache is evictable; dirty drafts, unsent operations, in-progress recordings, and explicitly kept offline content are not.
7. Cache retention has both byte and item budgets. The existing twenty-draft product behavior is not repurposed as a limit on all saved-trip access.
8. Data protection and backup behavior distinguish irreplaceable local work from reconstructible cache. Disk-full and corruption are not interpreted as “empty account.”

Use a new environment+account native namespace. Do not open incompatible AccountRecord bytes and silently reinterpret them; non-target local files remain untouched. Native schema upgrades must preserve data created in the new system after launch.

Keep one deliberate offline write queue. The current [assembly](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/App/AccountAssembly.swift:80) uses memory-only Firestore cache; do not accidentally introduce a second persistent SDK write queue alongside the custom durable outbox.

### Remove account-wide work from memory as well as disk

The replacement is incomplete if smaller database rows are immediately assembled into the same giant runtime object. Explicitly replace these production paths:

| Current path | Required replacement |
| --- | --- |
| [PersonalState.visible](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/UserMutation.swift:131), replaying all pending operations over the full snapshot | Per-entity confirmed/optimistic state; compute only the projection being read and only its relevant intents |
| [CloudUserChange.applying](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/CloudUserChange.swift:76), merging collections and decoding a whole snapshot after a delta | Decode/validate/upsert only touched records and update their subscribed projections |
| [AccountSession account publication](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/AccountSession.swift:159) | Small account identity/access/status state; repository-owned feature streams and synchronization wakeups |
| [TripLibraryContent.updated](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/TripLibraryContent.swift:18) reading full saved trips | Paged metadata rows and separate dirty-draft metadata; content fetched only on demand |
| [PersonalParkProjection](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/PersonalParkProjection.swift:56) and [PassportModel.input](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Passport/PassportModel.swift:13) extracting feature data from account-wide state | Dedicated visited-marker/progress/history inputs; a note edit cannot rebuild unrelated passport history |

Do not keep these full-account paths as a convenience adapter in the shipped native dependency graph. A single per-trip bounded working copy is acceptable; an ever-growing account graph under a new type name is not.

Resolve clean-cache byte/item budgets in Phase 1 and enforce them in storage queries and retained projections. Never reinterpret a dirty-draft limit as permission to evict unsaved work. Inspect production call paths and measure touched rows/encoded bytes/subscriber updates; passing persistence tests alone does not satisfy this requirement.

### 5.2 Commands and outcomes

Use a small, explicit set of typed operations, such as updateProfile, saveTrip, editNote, recordVisit, removeCurrentVisit, saveWalkSummary, and advanceVirtualRun. Active-trip/day selection remains a local transaction, matching the existing app. Group deployment handlers by feature where helpful; this is not a requirement for one Cloud Function per field.

Each command carries:

- Contract version and stable operation ID.
- Client creation time for the documented offline/replay window.
- Typed entity ID(s), typed payload, and expected entity revision(s).
- Scope supplied/verified through authenticated context; do not trust a payload UID as authorization.

Outcomes:

| Outcome | Required client behavior |
| --- | --- |
| Accepted / previously accepted | Apply canonical revisions, clear the matching intent durably; never replay the effect under a fresh operation ID |
| Conflict | Preserve the user's draft, fetch the touched record, resolve explicitly; a retry with changed content is a new intent |
| Invalid / forbidden / unsupported contract | Stop automatic retry of that intent and surface a useful recoverable state |
| Authentication expired | Refresh/re-authenticate within the same scope; never retry under a different account |
| Transient / rate limited | Backoff with jitter and retry-after; keep durable intent |
| Timeout / lost response | Outcome is unknown, not failure. Retry the identical ID and payload or reconcile its receipt |
| Offline intent older than supported replay window | Preserve local content, reconcile known entity state, and require a deliberate rebase/resubmission if needed |

The server transaction checks authorization, payload bounds, exact receipt fingerprint, current revisions, entitlement where required, and relevant business invariants. It commits touched records, bounded derived records, and the receipt together. No Apple network call or other external side effect runs inside a retried Firestore transaction.

Preserve useful current queue behavior: conflicts on one entity should not arbitrarily prevent unrelated entities from progressing. Do not parallelize conflicting commands against the same expected revision.

Recommended starting replay policy: retain the current thirty-day intent acceptance window and receipts longer than it, initially sixty days, pending review of actual offline requirements. Do not claim infinite exactly-once delivery after receipt expiry. Stable entity IDs, revisions, tombstones, and deterministic award IDs prevent data/reward duplication independently of a short-lived receipt.

Never refresh an old operation's timestamp while retaining its ID. Receipt expiration is not permission to award the same official completion again.

Make every parent/child reference owner-scoped and validate its existence or same-command creation. For a trip deletion, selection, itinerary and note-link cleanup must remain recoverable without deleting notes still referenced elsewhere. For visit updates, the foundation retains the current one-active-visit-per-official-site behavior through placeProgress; repeat creation is enabled deliberately at J2, not accidentally by changing the record key.

### 5.3 Bounded reading and reconciliation

- Preserve the current ten-item trip page behavior; read metadata for the library and only fetch itinerary content when needed.
- Observe a small account state set, the current library head when needed, and active content. Historical pages are on demand, not permanently listened to.
- Persist cursors only after records are committed locally.
- Use deterministic ordering with a document-ID tie-breaker. A record leaving a limited query is not proof it was deleted; preserve the current verification principle.
- Use per-entity revisions to reject stale callbacks and protect a newer acknowledgment from an older snapshot.
- Specify per-collection incremental reconciliation using server update times and deterministic cursors, including an upper-bound/overlap strategy so concurrent updates cannot fall between pages.
- Include deletion tombstones in reconciliation. Define retention and a bounded rebootstrap path when a client is older than that retention; never discard its dirty drafts/outbox.
- Avoid a global monotonically incremented “all users changed” document. No single write bottleneck is needed for unrelated accounts.
- A long archive must not be downloaded before the app can display its cached active trip and initial screens.
- Standardize cancellation/deadline behavior inside adapters. Do not spread SDK continuation handling through feature models.

Phase 1 must implement the following reconciliation contract, resolving the concrete SDK query/cursor representation before wiring its consumers:

1. Open the local scope and show cached initial content without awaiting an account-wide download.
2. Fetch/listen to bounded current windows and selected entities. Each result carries server entity revisions; query membership and entity existence remain separate facts.
3. For a required incremental scan, use an owner/collection-scoped durable cursor ordered by server update time and document ID. Capture a server-confirmed upper watermark, not the device clock; keep that bound for the scan.
4. Commit each page and its page cursor in one local transaction. Interrupted scans resume from the last committed page; they never advance from a network response that failed to persist.
5. Ignore older entity revisions, apply deletions as tombstones, and keep optimistic local work separate from confirmed remote content.
6. Advance the completed-scan watermark only after all bounded pages through its upper watermark have been accepted. Revisit the boundary timestamp inclusively on the next scan and deduplicate by entity ID/revision so equal timestamps cannot create a skipped interval.
7. A change after the scan's upper watermark belongs to a subsequent scan/listener result; overlapping delivery is safe because application is idempotent. Do not use a limited head-query snapshot as proof that an archive scan is complete.
8. Expose the supported deletion-retention horizon. If a cursor predates it, rebuild that collection's clean cache in pages while retaining dirty drafts and queued intents; publish a completed cache generation only after its reconciliation is coherent.

Specify and verify the watermark source, ordering/index, equal-time behavior, overlapping updates/deletes, horizon, cancellation and local commit boundary as part of Phase 1. If the selected SDK cannot provide the required consistency, resolve the adapter design there rather than shipping an approximation. No global per-write counter or account-wide event-replay system is required.

For multiple offline saves to one entity, distinguish a durable local intent from a sealed wire command. An intent may depend on an earlier intent's accepted revision. The sync owner materializes its exact expected revision and payload before first submission; after that, operation ID and payload are immutable across retries. Persist that transition. A rejected/conflicting predecessor blocks its dependent intents, not unrelated work. Do not rebase a queued edit across somebody else's change without an explicit conflict decision.

## 6. New backend: minimal services, full trust boundaries

### Include

- Firebase Authentication for the explicitly chosen native sign-in methods.
- Firestore Standard/native document storage, indexes and deny-by-default rules for this contract.
- A focused native Functions deployment for typed commands, account deletion, purchase verification/notifications, current feedback, and bounded maintenance.
- Public versioned catalog assets, with a native-owned publication process.
- Operational alerts, privacy-safe nonfatal reporting, audit logs for privileged actions, backups and restore procedure.
- Object storage only where current catalog/support delivery actually requires it. Journal photo/track pipelines wait for their milestone.

### Exclude

Create an explicit native Functions entrypoint and minimal dependency/secret set. Exclude Lemon Squeezy integrations, Gemini features, ORS proxy/key, Google Maps Platform key, unrelated compatibility triggers and JDDM code. Rules start deny-by-default.

This is an allowlist deployment. Reusing a small reviewed pure validation function is acceptable; importing a broad unrelated module graph is not.

Keep necessary native Firebase configuration. A Firebase configuration API key is not the Google Maps Platform key the user wants removed. Likewise, preserving an existing Google Sign-In option is a separate auth decision. [AccountAssembly](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/App/AccountAssembly.swift:64) already treats its setup explicitly.

[MapsHandoff](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/MapsHandoff.swift) supports navigation handoff; an ordinary Google Maps directions link is not an ORS or Google Maps API integration. Preserve the current handoff UI unless separately asked to remove it.

### Authentication, rules and abuse

- Owner reads only for private data; authorize owner collection queries, with supported limits and indexes. Never use a broad recursive authenticated-user allow rule.
- Foundation synchronized writes go through typed authenticated commands. Direct SDK writes to entitlements, visits' verification, awards, public leaderboard, receipts, or purchase mappings are denied.
- Public catalog and leaderboard documents contain only intentionally public fields. Firestore reads expose the permitted document, not a redacted view of private fields.
- Server SDK access must enforce the same ownership checks explicitly; security rules are not the server's authorization layer.
- Use narrowly scoped service accounts and secrets. Native deployment credentials cannot administer non-target projects.
- Enable and verify native App Check before enforcing it on supported protected endpoints. Keep auth, quotas, payload validation, and server reward rules: App Check complements them and does not eliminate abuse. [Firebase App Check](https://firebase.google.com/docs/app-check).
- Apply per-user/action limits, command-size limits and bounded work per request. Avoid one global rate-limit counter updated by every user.
- Treat catalog matching, plausible location/time, duplicated evidence and source provenance as a reward-policy problem. Server ownership prevents direct point forgery but does not magically prove client GPS is truthful.
- A private arbitrary pin or normal walk can be useful journal data without being eligible for an official-site/trail award.
- No private coordinates, note bodies, photos, health values, purchase payloads, or contact emails in routine telemetry.

### Essential catalog/support independence

The [native catalog URL](/Users/carterswarm/BarkRangerMap/01-code/ios/Config/Base.xcconfig:19) is configured separately from the Firebase registration. Account configuration alone does not establish ownership of every native runtime dependency.

Publish approved public catalog/trail assets into the native project's asset namespace, preserving canonical IDs/aliases, provenance, allowed source licensing, revision/hash behavior, and bundled fallback. Use approved repository/public reference assets; no non-target database access is needed. Development and load data are synthetic.

The current [FeedbackService](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/FeedbackService.swift:24) sends bounded screenshot attachments through a callable. Preserve the existing feedback path and support experience, but review its new-project retention, payload size and delivery failure behavior. Existing feedback attachments are not authorization to introduce a general journal-image pipeline.

## 7. Apple purchases and access

This is a required replacement integration, not a future journal feature. Removing Lemon Squeezy while keeping only an editable premium Boolean would be incomplete and insecure.

**Owner update, September 13:** paid Apple Developer enrollment is still pending. The owner authorized leaving Apple-dependent integration inactive, with comments and commented-out activation wiring at the actual iOS/backend boundaries while the rest of Phase 1 proceeds. Track these with `APPLE-ACTIVATION`. This does not authorize mock Premium or imply the purchase service is complete; real signing, provider/product configuration, verification and device/sandbox checks remain activation gates. Report this exception explicitly at handoff, and do not claim a purchase-ready release before it is resolved.

**Owner clarification later September 13:** finish the actual purchase/verification implementation in Phase 1. Only approval-dependent activation stays disabled; comments or service sketches are not the implementation. Non-Apple workflows must be independently testable. After enrollment approval, configure the real Apple identifiers/providers/products, activate the prepared integration and verify its device/sandbox flows; do not represent those external checks as already passed.

1. Confirm the Apple developer team, bundle registration, product IDs, subscription group and production/sandbox environments.
2. Implement StoreKit purchase, transaction observation, restore, and subscription-management behavior behind a dedicated purchase service.
3. Associate purchases with an opaque app-account token mapped server-side to a Firebase UID. Verify signed transaction information, app/product/environment, and purchase ownership.
4. Persist server-derived entitlement state. Never trust a client-provided premium flag, expiry, or an unverified transaction identifier.
5. Process App Store Server Notifications idempotently, handle out-of-order/replayed notifications, and reconcile missed notifications through Apple's server API.
6. Define renewal, expiration, billing retry/grace, refund/revocation, restore, and account-switch outcomes. Do not apply a sandbox entitlement in production.
7. Define what happens when the Apple purchase is already linked to another Bark account; do not silently duplicate its access. Decide Family Sharing support explicitly rather than assuming one mapping rule covers it.
8. Preserve an intentional offline access policy with finite validity. Do not blindly reuse a legacy billing-provider status string or its offline-duration rule.

Apple documents signed StoreKit transactions, server integration and account tokens in [StoreKit](https://developer.apple.com/storekit/), [App Store Server Notifications](https://developer.apple.com/documentation/AppStoreServerNotifications), and [in-app purchase integration](https://developer.apple.com/videos/play/wwdc2022/10040/). Verify current APIs and product policy during implementation; this plan does not invent product IDs or prices.

Current native [AccountDataAccess](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/AccountDataAccess.swift:5) allows guest draft editing but requires Premium for account editing. Preserve that baseline unless separately changed; do not introduce unrelated access rules. Support and account deletion remain available without purchasing Premium.

The UI freeze has two factual/provider exceptions: billing actions must use Apple flows, and provider/data-source copy must accurately describe the native system. Neither authorizes layout changes, a new leaderboard, or redesigned account screens.

## 8. What “100,000 users” means and how to prove readiness

### 8.1 Planning workload, not a capacity guarantee

Assume 100,000 registered accounts, not 100,000 simultaneous active users. Proposed initial load cases:

| Scenario | Planning workload | Purpose |
| --- | --- | --- |
| Initial wide launch | 100,000 registered; 10,000 daily active; 1,000 connected foreground clients at peak | Normal acceptance case |
| Busy-day headroom | 30,000 daily active; 5,000 connected foreground clients | Listener/read amplification and burst recovery |
| Command burst | 200 accepted commands/second sustained; 1,000/second short burst, distributed across accounts | Transaction, function concurrency, rate-limit and index pressure |
| Reconnect burst | 5,000 previously offline clients reconnect over five minutes with bounded queued work | Jitter, retries, receipts, listener reattachment and hot-key behavior |
| Heavy individual account | 1,000 trips, 10,000 place references and 20,000 historical visits/activities; future dataset extended with notes/assets | Prove one person's history does not become the app's working set |

These are proposed targets requiring budget approval and measured verification. Aggregate peak commands are deliberately above the illustrative daily average; they are not derived by dividing 100,000 users by a day.

A registered-user count does not establish storage growth, concurrency, photos, or cost. If 100,000 simultaneous active users is the actual requirement, re-size and re-price this plan before claiming readiness.

### 8.2 Query and work budgets

| Workflow | Proposed bounded behavior | Cost trap to avoid |
| --- | --- | --- |
| Account foreground | Small state records + current screen's first page; reuse durable local data | Downloading all trips/visits/activities on every launch |
| Trip library | Ten lightweight summaries per page, stable cursor | Downloading ten maximum-size itineraries just to show titles |
| Open/edit trip | One selected itinerary plus needed current notes; dirty draft retained locally | Listeners on all historical trip content |
| Edit note | One note command and receipt, plus only genuinely affected metadata | Rewriting account blob, all trip copies, or requesting directions |
| Mark visit/save walk | Touched event, bounded progress/award state, receipt | Reading every historical visit/achievement or updating a globally contended document |
| Leaderboard | Five public rows; own standing when required; no continuous full-board listener | Assuming limit(5) also bounds the separate ranking aggregation |
| Map personal pins | Local lightweight spatial projection and bounded remote page/viewport work | Query per marker, full journal downloads, or loading originals during panning |
| Future media | Explicit thumbnail/original fetch; uploads outside metadata commands | Image bytes in Firestore or re-download of originals on every appearance |

Keep listener counts explicit per screen/scope. Proposed foundation budget: no more than six active personal-data listeners for an ordinary foreground account, with each collection listener limited to a documented window. Ledger/archive history has none by default. Validate the actual count after wiring rather than relying on the number of repositories.

Do not leave collection listeners running merely because their feature model remains allocated after navigation. Reconnection and listener updates can create new billable reads. [Firestore billing](https://firebase.google.com/docs/firestore/pricing).

### 8.3 Leaderboard: preserve the five-row UI, size the rank work honestly

Current [topFive](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/LeaderboardRepository.swift:24) reads five documents. Current [standing](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/LeaderboardRepository.swift:32) additionally counts entries with a greater score.

Recommended initial backend: keep five-row reads and an on-demand personal-rank query behind an authenticated native standing endpoint. The server derives the requester from auth, so callers cannot request arbitrary private account context; rate-limit and coalesce repeated requests. Public top-five queries expose only their small public projection. Measure at 100,000 populated entries. Do not precompute a rank for every user after every score change.

Firestore count aggregations bill in batches of up to 1,000 scanned index entries. Counting 99,999 higher entries is approximately 100 aggregation read units, not 99,999 document downloads and not one flat-cost read. Include normal document reads and other applicable charges separately. [Aggregation query guidance](https://firebase.google.com/docs/firestore/query-data/aggregation-queries).

If 10,000 users make one average-rank lookup daily and each scans roughly 50,000 entries, that is approximately 500,000 aggregation read units/day, an illustrative calculation—not a measured bill. Decide whether the measured latency/cost is acceptable before building a more complex rank index.

If it fails the approved budget, evaluate an exact rank-count structure behind the same interface, or a clearly defined cached standing. Do not silently substitute stale/approximate rank or change the top-five UI.

There is an existing tie inconsistency: [LeaderboardModel](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Passport/LeaderboardModel.swift:43) and the five displayed rows use positional rank, while the separate personal query uses higher-score count + 1. Freeze the current behavior for the foundation unless the owner approves a specific tie-policy correction. Do not accidentally introduce a new tie rule while changing indexes.

### 8.4 Indexes, transactions and hotspots

- Every query in the first release gets a documented path, sort/filter, index, page limit, owner rule and expected scanned work.
- Trip metadata: preserve createdAt ordering with document-ID tie-breaker. Introduce updatedAt ordering only for sync or an approved UX change.
- Visit/activity history: happenedAt/startedAt plus document ID; place lookup indexes added only for required current reads.
- Personal place geohash index and combined journal/dog indexes ship only when their queries ship.
- Exempt large unqueried note text, itinerary contents, payloads and unneeded sequential/TTL fields from indexing. Audit collection-group indexes separately.
- Random document IDs do not by themselves prevent sequential-index hotspots. Audit globally queried time fields and high-write collections; do not assume a thousand command/second workload is safe without this check.
- Ramp new collections gradually; Firebase's starting guidance is 500 operations/second, then up to 50% increases every five minutes with distributed keys. This is rollout guidance, not a promised throughput limit for the complete application. [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices).
- Do not fan every visit out to all 100,000 leaderboard users. Update the one user's public score projection when it actually changes.
- Keep external calls and heavy computation outside transactions. Document worst-case bytes and touched records for bulk itinerary operations; split work only with an explicit recovery contract.

Firestore currently documents a 1 MiB document limit and a 10 MiB API request limit. Validate the chosen SDK's complete transaction constraints and index effects against maximum-size supported trips; a small logical payload alone is not proof that an expanded multi-record save is acceptable. [Firestore limits](https://firebase.google.com/docs/firestore/quotas).

### 8.5 Map scale and future media economics

Phase 1 gives the current local place/bookmark store indexed lightweight region queries and makes Map's read path use them. A repository returning every record in a lighter type is not sufficient. The map receives IDs, coordinates, marker style and needed small labels—not note bodies, media arrays or full account snapshots. Preserve current visual styles and selected/active-trip markers.

Define the current visible-region candidate budget and behaviour for very dense views in Phase 1. Do not silently hide arbitrary pins or claim a hard render cap while still rendering an unbounded viewport. If preserving today's visuals and the measured dense-view budget conflict, report that specific product choice; do not invent a UI change. Cloud journal geoqueries and any new clustering presentation remain future work.

At the journal milestone, debounce/cancel stale viewport requests and cache overlapping regions. Preserve the selected place and active itinerary. If a viewport contains too many pins, use bounded clustering/level-of-detail with a defined completeness policy; never silently drop arbitrary personal pins. Any visible clustering change belongs to that milestone, not the current UI-frozen foundation.

For Standard Firestore, geohash range queries are a reasonable initial regional-read approach, but require merged queries and filtering of false positives; include those extra reads in the budget. Measure dense areas and dateline/edge cases. [Firebase geoqueries](https://firebase.google.com/docs/firestore/solutions/geoqueries). Do not add a second search database before evidence justifies it.

Illustrative future storage: 100,000 users × 100 photos × 1 MB per stored photo = about 10 TB before thumbnails, backups, processing and download traffic. Repeated original-image downloads can dominate metadata cost. Set explicit per-file, per-user, retention and download policies before launching cloud photos.

### 8.6 Cost model and service objectives

Illustrative metadata budget: 10,000 daily active users × two foreground sessions × 25 document reads/session = 500,000 reads/day, about 15 million/month at thirty days. Separately, ten commands/user/day × six document writes/command would be 600,000 writes/day, about 18 million/month. These are workload examples, not verified current behavior; six writes includes the planned receipt/derived records only if the measured handler actually does.

Price measured document/index operations, storage, network egress, Functions compute, Authentication configuration, logs, backups, support and later media processing in the selected region. Avoid a fake dollar estimate before those inputs are known. Compare cost per active user and per accepted command across milestones.

Budget alerts alone do not stop service usage; any applicable spend-cap feature must be configured and its outage consequences understood. Keep application quotas and operational response procedures. [Firebase billing controls](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills).

Proposed acceptance objectives, to approve and measure:

- Warm local edit/checkpoint p95 below 100 ms for supported trip sizes; no account-wide encode or main-thread disk I/O.
- First cached useful screen within one second of local storage readiness, independent of remote archive size.
- Normal metadata commands p95 below one second in the chosen region under the normal load case; burst failures are controlled/retryable, not dropped writes.
- Current map interaction no worse than the measured baseline on the oldest supported physical iPhone; no steadily growing retained objects after repeated navigation/account changes.
- No duplicate reward/effect after lost responses; no cross-account state exposure; no silently discarded dirty work.

A plan cannot promise “will not crash.” Release evidence must include real-device memory/energy profiling and failure injection, not just passing automated assertions.

### 8.7 Owner refinement: cached overview, deliberate detail

The post-checkpoint 3 [current-source review](../reports/ios-native/SUMMARY_FIRST_SOURCE_REVIEW_2026_09_13.md) is the implementation addendum for this requirement. It supersedes any inference that metadata separation alone already guarantees cheap browsing. Ordinary cached pin selection should cause zero additional Firestore operations; background overview freshness, authentication, authored writes and explicit detail requests are separate workloads. Existing cached useful facts need no extra button merely to display them.

Before completing recovery checkpoint 4, remove unconditional selected-trip detail refresh, closed-history reconciliation and archive-wide reconstructible trip-cache bootstrap; preserve cross-device change/deletion safety and durable pending work. Make note-only explicit Save proportional to changed notes without changing Save/Cancel or independent planning-note ownership. Measure all server document/index operations and admission writes, not only response bytes or callable/page counts. The detailed findings, tradeoffs and acceptance workload are in the linked review. These fixes are planned, not implemented by this addendum.

Small bounded, rebuildable official-visit/dog overviews are compatible with the entity design if measurements justify their extra maintenance writes. They must not become an unbounded personal-pin/journal object. Future journal map/feed metadata is paged or regional; note detail and private media/track bytes load on demand and reuse valid caches. An explicit keep-offline guarantee and any dense-map clustering UI require separate product decisions. Do not add journal/dog/photo features or speculative infrastructure now.

## 9. Future journal, repeats, dogs, trails and photos: implementation order

These are future product milestones, not additional AI implementation phases or prerequisites of this rebuild. Build each only when approved; they are not hidden deliverables of the two-phase foundation.

### J1 — Account journal and saved places

- Expand place saving to any location, including official BARK sites and arbitrary pins.
- Introduce account-owned saved membership explicitly; keep guest/device content separate and require an intentional move before uploading existing local bookmarks.
- Show canonical note records in the journal and in trip context. Add a place to a trip by reference, not by cloning note/media content.
- Keep one shared journal. Link completed trips as memories; do not copy every trip's underlying data into another archive graph.
- Implement bounded place/journal queries and viewport map projection before allowing large libraries.
- Define archive/remove/delete semantics: removing a pin from the map need not delete its history; deleting a trip does not automatically delete shared places/notes.

### J2 — Repeat visits, alongside journal foundations

- Allow multiple visit records for one place. Each has its own time, trip association and later dog participants.
- Preserve a derived “visited this official site” projection for current map/passport needs.
- Decide whether repeat visits affect rewards; default recommendation is no automatic repeat-point multiplier. Distinct-site progress and visit count are different measures.
- Define removal/correction behavior for one visit versus clearing a visited marker. Do not make “unmark” silently erase all history.
- Retain happenedAt separately from recordedAt and represent date/timezone assumptions for summaries.

This can move alongside J1, ahead of multiple dogs, because stable visit IDs are already part of the foundation.

### J3 — Multiple dogs

- Add dog profiles and selection/participation UI, initially up to three active dogs if approved.
- Attach participating dogs to a trip, visit or activity; derive each dog's visited-site progress.
- Keep journal/notes/photos at account level; no repeated storage per dog.
- Archive removed dogs while preserving historical participation.
- Decide reward policy and display selection explicitly; do not award the same account more points just because three dogs are attached.

### J4 — Recorded walks/hikes as journal activities

- Retain the existing recorder's recovery mechanics, but make finish hand off to a durable activity archive before deleting temporary samples.
- Save a local archive first; upload later with resumable/idempotent state. An unavailable backend or rejected award must not destroy the walk.
- Store original track files outside Firestore, with lightweight summaries, bounds and display simplifications. Read long tracks in bounded chunks.
- Link an activity to a place and optionally a trip and dog participants. Add it to the journal/map as a completed walk.
- Do not add pre-trip trail planning: users save a pin first, visit it, then record the trail.
- Keep virtual expedition distance progress distinct from physically completing a particular official trail.
- Add versioned official-trail completion rules and evidence handling; ordinary nonofficial walks remain private journal activities without official rewards.
- Preserve current explicit Health workout import. [HealthWorkoutImporter](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/Recording/HealthWorkoutImporter.swift:5) is currently read-only selection, limited to walking/hiking candidates; it is not automatic import or Health writing.
- Future Apple Health writing/route sharing needs separate permission, source-ID deduplication and loop prevention. Do not infer each dog's health measurements from the user's Health data.

### J5 — Optional cloud journal photos

- Decide whether to launch photos and approve quota/retention/compression/offline expectations before coding.
- Store binary objects privately, with one metadata record per asset and reference links to notes/visits/activities.
- Use explicit pending/uploading/processing/ready/failed/deleting states. Reserve quota before upload and finalize server-side after checking actual bytes/type/dimensions.
- Do not trust MIME type or filename alone; process safely and enforce decoded-image/pixel limits.
- Generate thumbnails; request originals deliberately. Never place base64 images in ordinary Firestore journal records.
- Preserve originals or approved quality as specified by product policy; show actionable errors when offline storage is full.
- Keep metadata/object operations recoverable: Firestore and object storage are not one atomic transaction. Retry cleanup/finalization and sweep genuine orphan uploads after a grace period.
- Reuse an asset when linked to multiple trips or notes. Deleting a trip unlinks it; only explicit asset/account deletion or validated unreferenced cleanup removes the bytes.
- Private location/EXIF retention and sharing choices must be explicit. No automatically public download links.

Photos may move earlier within journal delivery once their independent security, quota and failure gates are met; they do not need to wait for trail rewards.

### Later, separately approved

Selected pin/trail submissions for official review; year-end summaries; events; accessibility/milestone information; park-hours-aware optimization; approved-trail routing; regional chats; lodging/camping/BringFido; commerce.

Do not add empty collections, plugins, dependency packages, scheduled jobs or abstract “extension frameworks” for these ideas now. Stable entities and references are enough preparation.

## 10. Build and hardening scope, executed through five recovery prompts

**September 13 recovery correction:** two broad prompts proved insufficiently controlled in execution: multiple isolated foundations accumulated before real app integration. Use the five sequential checkpoints in the recovery-prompts document. Keep useful code, correct identified defects, and require each feature's connected path before expanding. Do not restart the project or perform a broad rollback. These checkpoints divide the remaining work; they are not a guaranteed number of messages or hours.

The original two scope headings below remain useful: build/integrate (recovery prompts 1–4) and harden/deliver (recovery prompt 5). Setup, security and services remain implementation work, not more planning phases. Use reviewable changes and verify each connected slice; do not defer all verification to the end.

| Stage | Owner | Finished outcome |
| --- | --- | --- |
| AI Phase 1 — Build and integrate | AI, with narrowly scoped credential/approval help | Complete new native backend and connected iOS app, current features implemented, architecture repairs made, continuous engineering checks passing |
| AI Phase 2 — Harden and deliver | AI | Source-reviewed, exercised, profiled and load-checked native build; approved deployment and installable owner-testing package |
| Owner acceptance testing | Owner, with AI fixing reported defects | Owner confirms the app's real-device workflows and product experience; defects return to Phase 2 without creating another implementation phase |
| Final retirement | Owner-led, only after acceptance | Separate §15 work; never a prerequisite for the native build or testing |

### AI Phase 1 — Create the native environment and build the complete system

**Outcome:** a complete connected native system, not a backend awaiting a separate iOS project.

The AI performs the work below end to end. These are internal work items, not additional AI phases or routine approval stops.

**Setup and decisions**

- Operate Google/Firebase account access and new-project creation through the owner's computer. The owner signs in/completes verification where required; a separate Google account is created only if requested.
- Propose/check the project ID, resolve region and environment isolation, and obtain explicit approval for billing linkage, new charges or required legal commitments. Configure the approved development/staging and native production targets, with dedicated credentials and deny-by-default rules.
- Extend the repository ownership/target policy explicitly and keep non-target systems excluded. Proposed native deployment paths are 01-code/functions-native and 06-config/native-ios; choose final paths once, without copying an unrelated deployment entrypoint.
- Register the iOS bundle, generate native configuration, configure the intended auth providers, and keep environment/bundle checks fail-closed.
- Configure Apple developer/App Store Connect sandbox products, signing and transaction-notification setup. Where an account/team/agreement is missing, ask for that specific owner action; do not substitute a fake entitlement path.
- Finalize the production-source feature inventory, native schema, commands, revisions, read queries, indexes, cache limits and synchronization algorithm before their dependent code. Resolve small engineering choices directly; ask only for a material product/spending choice. There is no separate “plan the plan” phase.

**Build connected slices with verification as they land**

- Implement profile/settings/access, then trips/places/notes, then visits/passport/activities/virtual runs. Each slice includes its native backend handler, authorization, local storage, synchronization and existing UI connection.
- Implement one canonical typed trip representation and per-entity persistence. Remove both the disk blob and the account-wide in-memory merge/replay/publication paths listed in §5.
- Enforce one ActiveTripSession decision-maker and one ordered account-scope lifecycle. Move checkpoint/save/conflict orchestration out of screen models; remove fallback construction and mutable internal access.
- Implement explicit place reuse rules and note context/ownership from §4. Preserve current draft/save/cancel/duplicate semantics.
- Implement bounded collection reads, acknowledged pagination, entity revisions, immutable submitted commands, dependency-aware pending intents and deletion reconciliation.
- Make current local bookmark/map reads use bounded region projections. Preserve geometry caching and separate presentation updates from route recalculation; do not redesign the current map.
- Implement current server-owned rewards, native StoreKit purchase/restore/access, support, account deletion, public catalog publication and privacy-safe diagnostics.
- Configure backup/restore, operation/deletion retention, quotas, indexes and essential monitoring for the new system.
- Add the future comments from §12 in iOS and backend boundaries. Do not implement journal browsing, multiple-dog UI, repeat-visit UI, cloud photos, permanent trail archives or the other future product milestones.
- Preserve the five-entry leaderboard, personal row, current navigation and feature limits. Only necessary provider/data-source copy and approved semantic changes are allowed.

**Verification within this phase**

After each slice, compile and inspect the production dependency/call paths, write/adapt focused tests from the agreed contracts, run the relevant unit/integration/rules checks, and exercise the connected workflow in the simulator or available device. Use synthetic data and Apple sandbox transactions. Existing cases may be reused where they actually match the new contract; do not preserve obsolete architecture simply to keep an old assertion passing.

Verify local durable edit plus outbox, retries after a lost response, current access policy and scope isolation before stacking the next slice onto them. Resolve discovered defects during the slice. There is no “implementation complete” claim while current features are placeholders or a compatibility bridge remains necessary.

**Exit conditions**

- Current native features operate against the approved new native backend.
- All five original core architecture findings are addressed in the production paths, including smaller read/publication boundaries—not just renamed files or database collections.
- Geometry reuse and current presentation both remain correct; shared-place identity is actually reused.
- The precise synchronization algorithm and retention/cursor behaviour are implemented, not left as TODOs.
- The new native system has its own required catalog, auth, payments, support and monitoring dependencies.
- All engineering checks run for this phase have recorded results; unresolved failures are listed honestly and any core failure blocks completion.

### AI Phase 2 — Harden, verify at scale, and hand over for owner testing

**Outcome:** a versioned installable build and working native environment ready for the owner's acceptance testing.

**AI verification and repairs**

- Re-read the changed production architecture against §2–§5. Trace a note edit, trip save, visit, activity, account change and receipt through actual owners. Confirm there is no reconstructed account-wide graph or screen-owned save protocol.
- Run the full relevant new-system regression/rules/integration checks, including unauthorized writes, cross-account references, malformed/oversized inputs, duplicate commands, lost acknowledgments, queued-edit dependencies and overlapping edits.
- Exercise the UI using computer control: current navigation, five-row leaderboard/personal standing, planner/map edits, notes, saving/duplicating/clearing, visit history/date changes, available expedition flows, sharing/export, account actions and support.
- Exercise offline/reconnect, process interruption, local storage failure, cache retention, account switch and interrupted deletion. Verify recovery from compatible native backups and schema upgrades.
- Verify Apple sandbox purchase/restore/renewal/refund/revocation and replay/out-of-order notification handling to the extent available in the configured environment. Record exactly what was demonstrated and what requires owner/device/provider action.
- Measure listener counts, scanned reads, document writes, command latency, local touched records/encoded bytes, launch, memory and retained objects. Use the §8 workload cases in isolated native infrastructure with an approved test-spend ceiling and controlled ramp-up.
- Run physical-device profiling when the device is connected and accessible. Simulator or synthetic location results do not substitute for real outdoor recording, real Health permission behaviour or a user-observed battery experience.
- Fix the defects uncovered, rerun affected checks and re-inspect the changed source. Do not hand engineering failures to the owner as ordinary acceptance tasks.
- Deploy only to approved new-native targets, verify the exact project/bundle/environment and required runtime endpoints, and install/deliver the chosen build through Xcode or approved TestFlight distribution. No public App Store submission or rollout is implied.

**Owner-testing handoff**

Provide one concise acceptance package containing:

- Exact build/version, installation instructions and the native environment it uses.
- A feature-by-feature statement of what was exercised by AI, supported by results—not just a total passing-test count.
- Recorded scale/resource results and clearly stated limits of the 100K-user claim.
- A short hands-on checklist for the owner, emphasizing physical-device/location/Health/purchase experience and normal product use.
- Any remaining external/setup limitation, its impact and whether it blocks release.
- A simple way to report a problem: action taken, expected/actual result, build, approximate time, and an optional screenshot. Never request private journal content or credentials unnecessarily.

**Exit conditions**

- No known unresolved data-loss, account-isolation, purchase-integrity, core workflow or mandatory architecture defect.
- Approved latency/resource/cost targets met, or a specific measured deviation disclosed for explicit owner decision.
- The build is installed or otherwise genuinely available for owner testing—not merely compiling locally.
- Required physical/provider-dependent checks are identified accurately. Do not claim “all testing complete” before the owner performs those checks.
- There are no user-transition or non-native-system tasks blocking this handoff.

### Owner acceptance testing and defect loop

The owner tests the actual app on their iPhone after AI engineering verification. The AI handles diagnostics, code/configuration fixes, reruns affected engineering checks and supplies another versioned build as needed. This remains Phase 2 follow-through, not a new sequence of AI phases.

The checklist covers current map/search/routing and planner behaviour, note save/cancel/duplicate semantics, visits/passport/leaderboard, available walk/expedition and Health-import flows, guest/account switching, offline use, Apple purchases/restore, support and export. Do not ask the owner to accept journal/photos/multiple-dog features that were intentionally not implemented.

The owner confirms acceptance only after required hands-on checks pass and reported blocking defects are fixed. Record that accepted build and the decision before considering §15. User testing is a release gate, not a substitute for the AI's engineering work.

## 11. Verification plan: source-first, not test-count theater

The following are future implementation acceptance activities, not claims about tests already present:

| Risk | Required evidence |
| --- | --- |
| Competing trip representations | Inspect new model/coding paths and actual composition; show one typed editing owner. Verify name/notes/bookends survive encode/decode, unchanged coordinates reuse geometry, and changed labels/colours update presentation without unnecessary directions requests |
| Whole-account work persists under a new name | Trace one note edit and one receipt acknowledgment through storage/publication; record touched rows, encoded bytes and subscriber invalidations |
| Lost response after server commit | Interrupt response delivery; replay identical intent; confirm one effect and the same canonical outcome |
| Dependent offline edits | Queue two edits to one entity before connectivity returns; seal the second command against the accepted predecessor revision. Interrupt before/after each send; verify stable command identity, explicit conflict handling and continued progress for unrelated entities |
| Account switch during save/recording | Force UID change at each asynchronous boundary; inspect local scope, listeners, callbacks and retained recording data |
| Dirty draft lost during cache cleanup | Fill cache and disk, trigger cleanup, reopen; verify only reconstructible content was evicted |
| Query-window departure mistaken for delete | Move records out of head pages while paginating; verify no invented deletion or skipped record |
| Reconciliation boundary gaps | Exercise equal timestamps, multi-page changes, concurrent writes, process interruption and cursor expiry; verify atomic page/cursor commits, inclusive boundary deduplication and preservation of dirty work during a rebuild |
| Long-offline deletion/replay | Exercise tombstone/receipt expiry paths; preserve user work and prevent resurrection/duplicate awards |
| Trip/place/note referential integrity | Delete/archive/duplicate/edit in different orders and across devices; verify no dangling editable copy or accidental shared-note deletion |
| Duplicate identity for the same place | Add one official/provider place through multiple trips and aliases; verify one private place identity. Reopen/duplicate an arbitrary saved pin and preserve its ID; nearby unrelated pins must not be silently merged |
| Billing privilege error | Replay/out-of-order sandbox notifications; account switch/restore/refund; verify ownership and access revision |
| Leaderboard scale and semantics | Populate 100,000 synthetic entries; measure rank queries and five-row behavior, including ties, missing own entry and refresh |
| Large library responsiveness | Use large synthetic archives without loading them wholesale; profile the oldest supported physical device |
| Current local map load | Profile indexed region queries and the approved visible-candidate policy with a dense synthetic bookmark library; verify current navigation/presentation, bounded working sets and no silent loss of saved pins |
| Future map/media architecture | Review extension boundaries now; cloud journal geo-query, permanent track-archive and upload checks belong to the later features, not this release |
| Missing operational signal | Trigger a noncrashing local open/save failure; prove a privacy-safe report can arrive without requiring the broken store to open |
| Native target isolation | Inventory native configuration and network destinations; verify runtime services match the approved native allowlist and all required catalog/support assets are available without non-target account access |

Use emulator/integration checks, sandbox purchase verification, adverse-network/device exercises and actual profiling together. Emulator success is not production capacity evidence. A high passing-test count is not an architecture argument.

### Deletion, backup and recovery are release requirements

Account deletion must revoke access/stop new mutations, then remove private subcollections and storage objects through a resumable privileged job. Mark completion only after the inventory is handled; keep minimal required audit/purchase records according to an approved retention policy.

Deleting a parent Firestore document does not automatically delete its subcollections. The deletion workflow must enumerate and process them explicitly. [Firestore deletion guidance](https://firebase.google.com/docs/firestore/manage-data/delete-data).

Restore drills must cover Firestore and any required object assets. A backup is not verified merely because a scheduled export reports success. Native schema upgrades must preserve existing native data; deleting and recreating user data is not a recovery strategy.

## 12. Roadmap comments to add during implementation

Comments belong beside the relevant production boundary, with a milestone reference and invariant. They should explain why the design exists, not promise an unimplemented feature. Do not scatter “TODO: journal” throughout views.

| Anchor in current code / its native replacement | Intended comment content | Milestone |
| --- | --- | --- |
| [Trip / Stop](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/Trip.swift) | A stop references a stable place and canonical note; later journal/media views must follow references, not clone editable content. Routing snapshots are explicitly nonauthoritative | J1 |
| [Visit / VisitPolicy](/Users/carterswarm/BarkRangerMap/01-code/ios/Packages/BarkDomain/Sources/BarkDomain/Visit.swift) | Visit identity is independent from place identity; repeat visits and dog participation do not imply additional account-level rewards | J2/J3 |
| Native replacement for [LocalSchema](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/User/LocalSchema.swift) | New journal/media metadata must use independent records; never extend an account-wide payload or cache-evict dirty work | J1–J5 |
| [SavedPlaceStore replacement](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/SavedPlaces/SavedPlaceStore.swift) | Device/guest bookmarks do not silently become account-owned uploads; official and custom place overlays share stable identity rules | J1 |
| [MapPlaceAnnotations input](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Discovery/MapPlaceAnnotations.swift) | Map input is a bounded lightweight projection; no full journal content, image bytes or all-account history | J1/J5 |
| [WalkRecorder.finish](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Features/Expeditions/WalkRecorder.swift:263) | Current summary save is not a permanent track archive; journal release must complete durable archive handoff before removing temporary samples | J4 |
| [ExpeditionRepository replacement](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Data/Expeditions/ExpeditionRepository.swift) | Activity, virtual-run progress and physical official-trail award are different records/outcomes; rejected awards must not delete a journal activity | J4 |
| [HealthWorkoutImporter](/Users/carterswarm/BarkRangerMap/01-code/ios/BarkRanger/Platform/Recording/HealthWorkoutImporter.swift) | Current import is explicit/read-only; future Health writes require separate consent and source-ID loop prevention | J4 |
| Proposed native backend place/note handlers | Private place content is not public catalog content; journal/trip links retain ownership and do not create note copies | J1 |
| Proposed native backend visit/reward handlers | Repeat visits and multi-dog participation preserve event identity; award uniqueness and rule version are server-owned | J2/J3/J4 |
| Proposed native backend asset boundary, when introduced | Asset metadata and bytes have separate recoverable lifecycles; no base64 journal document fields or per-trip binary copies | J5 |
| Proposed native account-deletion handler | Every new owned entity/object namespace must be added to resumable deletion and restore inventories | Every future milestone |

These are planned comment placements only. No production comments or backend feature scaffolding were changed while preparing this plan.

## 13. Decisions resolved within Phase 1—and future choices that do not block it

The AI makes routine engineering decisions and records them while implementing. Ask the owner only for account access, irreversible infrastructure choices, spending/legal commitments or a material product tradeoff. Future product choices below do not create a prerequisite planning phase.

| Decision | Recommended starting position |
| --- | --- |
| New project ID, environments and region | AI proposes/checks available IDs and performs setup; owner confirms the Google account, target identities, region and billing commitments. Use explicit isolated development/staging; decide location before creating irreversible resources |
| Current UI/access behavior | Freeze current screens/top five/limits and current note save/cancel/duplicate behavior. Escalate only unavoidable provider/copy changes or a measured dense-map tradeoff that would change presentation |
| Apple products/auth configuration | Preserve intended current auth options; verify paid-team/provider setup; define products and offline entitlement policy |
| Workload/budget | Approve §8 assumptions, monthly spend tolerance and per-action budgets; no unmeasured 100K guarantee |
| Note duplication/history | Implement the foundation default in §4: current trip-stop planning notes remain context-specific and preserve duplication behavior. Later shared place journal notes stay canonical and referenced; completed-trip snapshot behavior is decided at that feature's milestone |
| Ranking ties | Preserve current behavior for foundation unless an owner-approved correction is specified |
| Future dog/repeat rewards | Up to three active dogs proposed; participation does not multiply account score by default; repeats do not automatically mint points |
| Future photos/Health | Separate approvals for quotas, privacy, retention, upload/Health permissions and rollout timing |

No need to settle events, commerce, chats, lodging or advanced optimization before rebuilding the foundation.

## 14. Why this is worth doing—and what would be unnecessary

This plan earns its complexity by removing recurring costs:

- Independent records avoid whole-account serialization and allow large personal histories to load gradually.
- Typed contracts remove raw transport-key knowledge from native feature code.
- Shared place/note identity prevents future “which copy is correct?” problems.
- One enforced editing/account lifetime owner reduces coordination spread across screens.
- A native-only deployment removes unused provider and compatibility surface.
- Bounded reads, independent activity records and media separation create measurable cost controls.

There are tradeoffs: more individual documents, more explicit queries, receipts and indexes; a proper StoreKit backend; and real implementation/release work. A fresh project is not inherently faster or cheaper. Those benefits come from the new read/write patterns, measured resource use, and removal of unnecessary dependencies.

Do not do: cosmetic file splitting, a protocol per method, a microservice per feature, a new routing engine, an all-user rank recomputation job, speculative media/AI pipelines, or an intermediate trip representation that would immediately need replacing again.

The engineering target is straightforward: a developer can trace “edit this note,” “save this trip,” “record this visit,” and “switch this account” through one clear owner, bounded storage, one authoritative command, and a defined failure outcome.

## 15. Separate final step: owner-led retirement after native acceptance

Only after both AI phases are complete, required testing has passed, and the owner has accepted the working native build does the owner deal with the old users, web app and database. None of that work is a prerequisite for native implementation or testing. There is no old-user migration, web-app adaptation or old-database cleanup workstream in the two AI phases.

The owner controls user communication, any data-retention/export decisions, the release/transition schedule and when to retire the old web app. This plan does not start those actions automatically. AI assistance with retirement requires a separate explicit request and exact scope.

Before any separately authorized shutdown:

1. Confirm the accepted native build and its purchases, support, catalog, alerts and account deletion are operating independently; agree any stabilization window.
2. Identify the exact old services/resources proposed for retirement and their remaining consumers, payment/support obligations and retention requirements.
3. Approve an exact retirement allowlist and recovery/retention record. Preserve anything not explicitly included.
4. Retire only those approved resources. Never delete broad project resources, ORS credentials, support/payment systems or unrelated services as a shortcut.

Nothing in this plan authorizes deleting or disabling the existing production system today. The new iOS-only system must be built, tested, working and accepted first.
