# B.A.R.K. Ranger Map - Current Feature Map

Created: April 29, 2026
Scope: Current app features visible in the repository as of today.
Format: Google-Doc-ready Markdown. This can be pasted or imported into Google Docs.

## 1. Purpose Of This Document

This document maps every current feature family in the B.A.R.K. Ranger Map app, from the biggest user-facing experiences down to smaller support tools, settings, admin workflows, and technical systems that make the app work.

The ranking is not analytics-based. It is an informed product ranking based on:

- The current codebase.
- The current beta product direction.
- The target audience: Facebook-group-based B.A.R.K. planners and dog/park travelers.
- The likely user value of each feature.
- The likely future monetization value of each feature.
- The current polish and stability risk of each feature.

This is a current-state feature inventory, not the future roadmap. The future roadmap lives in `plans/FUTURE_ROADMAP.md`.

## 2. Executive Summary

The app is currently much more than a map. It is already a full B.A.R.K. Ranger companion product with:

- A trusted official B.A.R.K. location map.
- Search, filters, marker clustering, and mobile map performance controls.
- Park detail cards with directions, reports, links, media, and trip actions.
- Account-based visit tracking.
- GPS verified check-ins.
- A profile/passport system with points, titles, streaks, achievements, and state progress.
- A trip planner with day-by-day route building, town stops, route lines, saved trips, and notes.
- A virtual expedition/walking system.
- Share tools for photos, QR codes, achievements, and expedition cards.
- Feedback and add-location flows.
- Admin-only data refinery tools for turning Facebook/community posts and screenshots into structured map data.
- Firebase cloud sync, Firestore user data, scheduled leaderboard work, and Google Sheets sync.

The strongest current value is still the official B.A.R.K. data and the ability to track where someone has been. The trip planner is useful, but it becomes much more strategic when framed as a B.A.R.K. route notebook and Facebook planning companion rather than a generic routing app. The expeditions/gamification layer is polished and interesting, but probably less core to the broad audience unless it supports the passport/journal experience.

## 3. Ranking Rubric

Popularity / user value:

- Very High: likely to matter to most users quickly.
- High: likely to matter to active users or planners.
- Medium: useful to a meaningful subset.
- Low: nice-to-have, hidden, or mostly admin/internal.

Product importance:

- Critical: the app depends on it.
- Major: important part of product identity.
- Support: helpful but not core.
- Internal: mostly helps the team/admin maintain the product.

Current maturity:

- Strong: implemented with real UX and reasonable technical support.
- Good: implemented and usable, with some complexity or rough edges.
- Fragile: useful, but architecture or UX needs refactor before scaling.
- Early: present but not yet central.

## 4. Ranked Feature Families

| Rank | Feature Family | Likely Popularity | Product Importance | Current Maturity | Future Premium Fit | Honest Read |
|---:|---|---|---|---|---|---|
| 1 | Official B.A.R.K. location map | Very High | Critical | Strong | Keep mostly free | This is the moat and the reason users arrive. |
| 2 | Park search and discovery | Very High | Critical | Good | Mostly free | Users need to find a park fast. Search quality matters more than flashy features. |
| 3 | Park detail panel | Very High | Critical | Good | Mostly free | This turns pins into useful information. It should remain extremely polished. |
| 4 | Visit tracking / "places I have been" | Very High | Major | Good | Strong paid expansion | This is likely the best conversion foundation. |
| 5 | Profile/passport stats | High | Major | Good | Strong paid expansion | Makes tracking feel meaningful and personal. |
| 6 | GPS verified check-ins | High | Major | Good | Medium | Trust-building feature, but must stay simple. |
| 7 | Trip planner / route notebook | High for planners | Major | Good but complex | Strong if reframed | Valuable when it helps people ask/share Facebook planning advice. |
| 8 | Saved routes and cloud sync | High for active users | Major | Good | Strong | Cloud persistence is account value. |
| 9 | Map performance controls | High indirectly | Critical | Good | No | Users do not ask for this, but they leave if the map is slow. |
| 10 | Settings / mobile behavior controls | Medium | Support | Good | No | Important for accessibility and old phones, but should stay quiet. |
| 11 | Achievements and badges | Medium | Major | Good | Medium | Fun and shareable, but not the core pain point. |
| 12 | Leaderboard | Medium | Support | Good | Low | Some users like it; many will ignore it. Keep it low-pressure. |
| 13 | Virtual expeditions / walking tracker | Medium-Low | Support | Fragile/complex | Weak unless tied to passport | Polished but not obviously what most B.A.R.K. planners came for. |
| 14 | Share tools and photo watermark | Medium | Support | Good | Medium | Complements Facebook instead of replacing it. Good strategic fit. |
| 15 | QR code and social link portal | Medium-Low | Support | Good | Low | Helpful for outreach, not daily use. |
| 16 | Feedback and add-location flows | Medium-Low | Support | Good | No | Important for data freshness and community trust. |
| 17 | Admin data refinery | Low for users, High for admins | Internal/Critical | Good but admin-only | No | This quietly powers the data moat. Very important. |
| 18 | Backend scheduled leaderboard / function layer | Invisible | Critical/Internal | Good | No | Necessary plumbing, not a user feature. |
| 19 | PWA install / hosting / version update | Low visibly | Support | Good | No | Makes the app feel real and reliable. |
| 20 | CSV export / data export | Low-Medium | Support | Good | Maybe | Great trust feature, not a headline feature. |
| 21 | Dev/test tools | Low | Internal | Early | No | Useful for debugging, should never become user-facing clutter. |
| 22 | Legacy trophy case fragment | Low | Legacy/Support | Unclear | No | Appears partly superseded by the main profile vault. |

## 5. Current Product Layers

The app currently has six major layers:

1. Discovery layer: map, pins, search, filters, panel, directions.
2. Memory layer: visited parks, verified visits, stats, profile, CSV export.
3. Planning layer: trip planner, start/end locations, route generation, saved routes, notes.
4. Motivation layer: points, titles, achievements, streaks, leaderboard, expeditions.
5. Sharing/community layer: watermark photos, QR codes, share cards, feedback, Facebook links.
6. Maintenance layer: admin refinery, Google Sheets sync, data polling, version polling, scripts.

The best long-term product direction is probably to strengthen layers 1, 2, and 3 first. Layers 4 and 5 should support the passport/journal/community loop, not distract from it.

## 6. Feature Family 1: Official B.A.R.K. Location Map

Popularity rank: 1
Likely audience value: Very High
Product importance: Critical
Current maturity: Strong
Primary files: `index.html`, `modules/mapEngine.js`, `modules/dataService.js`, `modules/renderEngine.js`, `modules/MarkerLayerManager.js`, `MapMarkerConfig.js`, `styles.css`, `styles/mapStyles.css`

### What The User Sees

Users see a Leaflet map of official B.A.R.K. locations across the United States. Each place appears as a branded B.A.R.K.-style marker. Users can pan, zoom, search, filter, and click pins to open a park detail panel.

### Current Subfeatures

- Full-screen Leaflet map.
- Custom B.A.R.K. marker icons.
- Official park pins loaded from the published data source.
- Different visual treatment for normal, state, and visited pins.
- Optional clustering through Leaflet markercluster.
- Optional plain marker mode.
- Viewport culling for plain pins when enabled.
- Map unavailable fallback card if Leaflet or map boot fails.
- Initial map view restoration or national default view.
- User location marker and locate control.
- Map tile style switching for logged-in users.
- Version update toast.
- Offline/local cache behavior.

### How It Works

The app loads structured park rows from a Google Sheets published CSV. `modules/dataService.js` parses the CSV through PapaParse, normalizes each row, validates canonical park IDs, and updates `window.BARK.allPoints`. `modules/renderEngine.js` calculates visible points based on filters, search, visited state, map view, and performance settings. `modules/MarkerLayerManager.js` owns the actual Leaflet marker lifecycle so markers can be reused instead of constantly recreated.

This is a strong current architecture pattern. Marker reuse is especially important because the app has many pins and a slow map would destroy the user experience.

### Data Fields Currently Used

- Park ID.
- Location / park name.
- State.
- Swag Cost.
- Type.
- Useful / Important Info.
- Website.
- Swag Pics.
- Video.
- Latitude.
- Longitude.
- Swag Type / derived swag type.

### Product Read

This feature should remain the free core. People arrive because the map has trusted data. If the map is paywalled too aggressively, the app risks losing the organic Facebook-group funnel.

The premium opportunity is not "see the map." The premium opportunity is "remember, organize, journal, and share my personal B.A.R.K. journey."

## 7. Feature Family 2: Data Loading, Refresh, And Data Integrity

Popularity rank: invisible but critical
Likely audience value: Very High indirectly
Product importance: Critical
Current maturity: Good
Primary files: `modules/dataService.js`, `version.json`, `BARK Master List.csv`, `data/data.csv`, `data/data.json`

### Current Subfeatures

- Google Sheets published CSV ingestion.
- PapaParse CSV parsing.
- Normalized park records.
- Canonical ID validation.
- Duplicate ID skipping.
- Legacy lat/lng ID skipping.
- Safety rollback guard if a refresh would drop canonical IDs.
- LocalStorage data cache.
- Data polling every several minutes.
- Focus/refocus polling.
- Abort timeout for slow fetches.
- Hash-based no-op refresh if data did not change.
- Ultra-low mode disables recurring polling.
- Special coordinate correction for War in the Pacific.
- Version polling against `version.json`.
- Update toast when a new version is detected.

### How It Works

The data service hydrates from cached CSV first when possible, then fetches current data. It creates normalized park objects, updates app state, updates marker managers, and schedules render sync. It uses defensive checks so a bad sheet publish is less likely to wipe the map.

### Product Read

This is not a feature users will praise directly, but it supports the entire trust promise. If users believe the map is current and accurate, they come back. If the data is stale, everything else feels weaker.

### Future Risk

This area must be protected during refactors. The future app needs a clearer official-data contract before adding personal pins, journal notes, public tips, or paid entitlements.

## 8. Feature Family 3: Search And Discovery

Popularity rank: 2
Likely audience value: Very High
Product importance: Critical
Current maturity: Good
Primary files: `modules/searchEngine.js`, `modules/renderEngine.js`, `index.html`

### Current Subfeatures

- Main search bar.
- Clear search button.
- Search suggestions.
- Local park search.
- Fuzzy matching.
- Abbreviation normalization.
- Partial search result caching.
- Search cancellation if user changes input.
- Budgeted/chunked search to avoid freezing the UI.
- Fallback global/town search for logged-in users.
- "My location" style geocoding support.
- Planner inline start/end search.
- Planner town/location search.
- Suggestion suppression on blur, scroll, and keyboard interactions.

### Text Normalization

The search engine recognizes common abbreviations and variations such as:

- `ft` to `fort`.
- `mt` to `mount`.
- `st` to `saint`.
- `natl` to `national`.
- `np` to `national park`.

This matters because real users will type messy names from memory.

### How It Works

The local search checks the current park dataset first. It uses a normalized string cache and Levenshtein-style fuzzy scoring. Search is debounced and chunked to avoid blocking the map. If the local results do not satisfy the user, logged-in users can launch a global geocode search through OpenRouteService.

### Product Read

Search is one of the highest-value features. For the Facebook audience, the app wins when someone can type "Acadia" or "Jacksonville FL" and quickly understand what is nearby.

## 9. Feature Family 4: Filters And Map Discovery Controls

Popularity rank: 2 to 5 depending user
Likely audience value: High
Product importance: Critical/Major
Current maturity: Good
Primary files: `index.html`, `modules/renderEngine.js`, `modules/uiController.js`, `modules/settingsController.js`

### Current Subfeatures

- Type filter dropdown.
- Swag filter buttons:
  - Tags.
  - Bandanas.
  - Certificates.
  - Other.
- Visited filter:
  - All.
  - Visited.
  - Unvisited.
- Map style selector:
  - Default OpenStreetMap.
  - Terrain.
  - Satellite.
  - Streets.
- Active trail overlay toggle.
- Completed trails overlay toggle.
- Premium tools lock state when logged out.
- Filter panel collapse/expand.
- Map movement closes/collapses some map UI.

### How It Works

Filters update state, then `syncState` coalesces marker updates through the render engine. The marker manager updates marker visibility and marker classes without unnecessary full rebuilds.

### Product Read

The swag and type filters are probably more valuable than gamification for many users because they answer a real planning question: "Where can I get the thing I care about?"

Visited/unvisited filtering becomes much more valuable once the app pivots toward a passport/journal model.

## 10. Feature Family 5: Park Detail Panel

Popularity rank: 3
Likely audience value: Very High
Product importance: Critical
Current maturity: Good
Primary files: `renderers/panelRenderer.js`, `index.html`, `styles.css`

### What The User Sees

When a user clicks a park pin, a slide panel opens with park details, visit controls, links, and trip actions.

### Current Subfeatures

- Park title.
- Active marker highlight.
- Visited section when logged in.
- GPS verified check-in button.
- Manual mark as visited button.
- Suggest edit mailto button.
- Meta pills for state, swag type, cost, or category.
- Updates and reports section.
- Show more / collapse behavior for long info.
- Website buttons.
- Swag photo links.
- Video link.
- Google Maps directions button.
- Apple Maps directions button.
- Add to Trip button.
- "In Trip Day X" state when already in a trip.
- Auto-pan so the panel does not cover the selected marker.
- Panel close button.
- Panel closes/clears active marker when switching contexts.

### How It Works

`panelRenderer.js` reads marker data, builds the panel content, binds visit actions, binds trip actions, and coordinates with map movement. It is currently a very important file because it mixes user interface, map behavior, visit logic, and trip entry points.

### Product Read

This panel is the main "card" experience today. Long term, it should probably split into:

- Official place card: trusted B.A.R.K. data.
- Personal visit card: user's private notes, photos, verified visit, journal.
- Trip stop card: trip-specific notes and route context.

That split should happen after refactor, not by stuffing every new feature into the existing panel.

## 11. Feature Family 6: Directions And External Navigation

Popularity rank: 3 to 6
Likely audience value: High
Product importance: Major
Current maturity: Good
Primary files: `renderers/panelRenderer.js`, `engines/tripPlannerCore.js`

### Current Subfeatures

- Google Maps directions from park panel.
- Apple Maps directions from park panel.
- Day route export to Google Maps.
- URL construction for route waypoints.
- Start/end bookend awareness for route export.

### Product Read

This is a practical feature. It should stay simple and reliable. The app should not try to beat Google Maps or Apple Maps at navigation. It should help users build B.A.R.K.-specific context, then hand off navigation when appropriate.

## 12. Feature Family 7: Visit Tracking

Popularity rank: 4
Likely audience value: Very High
Product importance: Major
Current maturity: Good
Primary files: `services/checkinService.js`, `services/firebaseService.js`, `services/authService.js`, `renderers/panelRenderer.js`, `modules/profileEngine.js`

### Current Subfeatures

- Google login unlocks visit tracking.
- Manual mark as visited.
- Optional uncheck setting.
- Verified GPS check-in.
- Verified visits cannot be casually removed unless allowed by logic.
- Visit records store name, ID, coordinates, verified state, and timestamp.
- Optimistic local updates.
- Snapshot reconciliation so local changes survive Firestore timing.
- Visit date display and update in profile/manage portal.
- Remove visited place in manage portal.
- Visited marker styling.
- Visited filter.
- Stats update after visits.
- Score update after visits.

### How GPS Verification Works

The app requests browser geolocation with high accuracy. It checks the user's position against the park's coordinates with a 25 km radius. If the user is within range, it records a verified visit and awards the verified point value.

### Current Scoring

- Manual visit: 1 point.
- GPS verified visit: 2 points.
- Walking/expedition points can also add to total score.

### Product Read

This is probably the best future paid feature family. The free product can allow basic tracking up to a limit, while premium expands the passport into unlimited tracking, notes, journal entries, photos, route recaps, and exports.

## 13. Feature Family 8: Google Account And Cloud Sync

Popularity rank: 5
Likely audience value: High for returning users
Product importance: Critical for paid future
Current maturity: Good but complex
Primary files: `services/authService.js`, `services/firebaseService.js`, `state/appState.js`

### Current Subfeatures

- Firebase initialization.
- Google sign-in with popup.
- Sign-out.
- Auth state listener.
- User document subscription.
- Cloud visited places.
- Cloud settings hydration.
- Cloud saved routes.
- Cloud expedition state.
- Cloud walk points.
- Cloud leaderboard writes.
- Admin detection.
- Logged-in premium tools unlock.
- Logout cleanup/reset.

### Current Login Gating

Right now, many "premium" tools are effectively unlocked by being logged in, not by a paid entitlement. This includes things like visited filter, map style, trail overlays, global geocoding, trip route generation, and cloud saved routes.

### Product Read

This is the exact foundation needed for payments later, but payment should not be added until entitlements are separated clearly from "is logged in." The app needs:

- Guest.
- Free account.
- Premium account.
- Admin.

Those should be different states, not one blurry login state.

## 14. Feature Family 9: Profile Dashboard And Passport Foundation

Popularity rank: 5
Likely audience value: High
Product importance: Major
Current maturity: Good
Primary files: `modules/profileEngine.js`, `gamificationLogic.js`, `utils/scoringUtils.js`, `index.html`

### Current Subfeatures

- Profile name display.
- Offline/account status.
- Score stat.
- Verified visit count.
- Regular visit count.
- States visited count.
- Daily streak pill.
- Current title banner.
- Rank progress bar.
- Rank progress fraction.
- Scoring explanation modal.
- Rank-up celebration overlay.
- Admin controls injection for admin users.
- My Data and Routes section.
- Saved itineraries count/list.
- Visited places management.
- Walk history management.

### Current Rank Titles

The app currently uses title thresholds roughly around:

- B.A.R.K. Trainee.
- B.A.R.K. Ranger.
- Trail Blazer.
- B.A.R.K. Master.
- Trail Legend.
- Apex Ranger.
- National Treasure.
- Legendary Ranger in some logic.

### Product Read

The profile is already moving toward a passport. The strongest long-term version is not just "points." It is "my official B.A.R.K. journey," with verified visits, personal memories, notes, and easy Facebook-ready recap exports.

## 15. Feature Family 10: Achievement Vault

Popularity rank: 11
Likely audience value: Medium
Product importance: Major but secondary
Current maturity: Good
Primary files: `gamificationLogic.js`, `modules/profileEngine.js`, `modules/shareEngine.js`, `pages/TrophyCase.html`, `styles/trophyCase.css`

### Current Subfeatures

- Vault tabs:
  - Rare Feats.
  - Paws.
  - States.
- Paw badges.
- State badges.
- Rare feat badges.
- Mystery/classified feats.
- Badge lock/unlock states.
- Verified/honor badge distinctions.
- Progress calculations.
- Badge rendering.
- Achievement persistence to Firestore.
- Vault share card.
- Single badge share card.
- Trophy-style export templates.

### Current Achievement Types

Paw milestones:

- Bronze.
- Silver.
- Gold.
- Platinum.
- Obsidian.

Rare and mystery examples:

- Explorer across multiple states.
- Local Legend for repeat visits.
- Coast-to-Coast.
- 50-State Club.
- Alpha Dog.
- Night Ranger.
- Early Bird.
- Marathoner.
- Lone Wolf.
- Map Conqueror.

### Product Read

Achievements are nice, but they should support the passport instead of becoming the main product. Users who love collecting will enjoy it. Users who only need planning data may ignore it.

## 16. Feature Family 11: Leaderboard

Popularity rank: 12
Likely audience value: Medium
Product importance: Support
Current maturity: Good
Primary files: `modules/profileEngine.js`, `services/firebaseService.js`, `functions/index.js`

### Current Subfeatures

- Top leaderboard entries.
- Top 5 initial display.
- "Show more" pagination behavior.
- Self-rank calculation.
- Pinned self fallback when user is not in top results.
- Total points sync.
- Scheduled hourly leaderboard snapshot function.
- Special #1 styling / Alpha Dog-style identity.

### How It Works

The app syncs a user's score to Firestore and reads leaderboard entries ordered by total points. It also uses an aggregation-style rank calculation to estimate the current user's exact rank.

### Product Read

Leaderboard is good community flavor, but not a guaranteed monetization driver. It should stay fun, optional, and non-punishing.

## 17. Feature Family 12: Trip Planner / B.A.R.K. Route Notebook

Popularity rank: 7
Likely audience value: High for planners
Product importance: Major
Current maturity: Good but complex
Primary files: `engines/tripPlannerCore.js`, `modules/TripLayerManager.js`, `renderers/routeRenderer.js`, `services/orsService.js`, `services/firebaseService.js`, `index.html`

### Current Subfeatures

- Trip name input.
- Day-by-day itinerary.
- Active day state.
- Add stop to trip from park panel.
- Add town/custom location through global search.
- Start location.
- End location.
- Inline start/end search.
- Inline park suggestions.
- Inline global town search.
- My location search support.
- Day tabs.
- Add day.
- Remove day with confirmation when stops exist.
- Insert day after current day.
- Shift day left.
- Shift day right.
- Active day color.
- Per-day stop list.
- Per-day notes.
- 1000 character notes limit.
- Day notes character counter.
- Move stop up/down.
- Move stop to another day.
- Remove stop from itinerary.
- Remove stop from map popup.
- Ghost add-stop prompt.
- Planner badge showing total stops.
- Clear trip with confirmation.
- Save route.
- Load saved route.
- Delete saved route.
- Saved routes list in planner.
- Saved routes list in profile.
- Load more saved routes.

### Trip Map Visuals

Current visual features:

- Dedicated trip layer group.
- Non-clustered trip markers.
- Non-culled trip markers.
- Numbered B.A.R.K. route badges.
- Start/end bookend markers.
- Day-colored dashed lines.
- Official park pins hidden under trip markers to avoid duplicate visible pins.
- Marker reuse through diff syncing.
- Park click from trip badge can still open the park panel.
- Custom town/location popups.
- Stop removal from trip marker popup.

### Route Intelligence

Current route-related features:

- Auto-sort active day by nearest-neighbor logic.
- Smart optimize whole trip.
- User max stops per day.
- User max drive hours per day.
- Approximate drive time based on distance assumptions.
- Generated OpenRouteService driving route.
- Route telemetry:
  - Total miles.
  - Drive time.
- Fit route to map bounds.
- Google Maps export for a day.
- Start/end bookends included where appropriate.

### Product Read

The route planner is not strong as a generic itinerary planner. It is strong if framed as:

- "Here are the B.A.R.K. places I want to visit."
- "Hide everything else while I plan."
- "Help me ask Facebook for advice."
- "Store my B.A.R.K. notes for the trip."
- "After the trip, help me share what I actually did."

This can become premium, but only after the code is less tangled and after the app has a clear free/premium account model.

## 18. Feature Family 13: Saved Routes

Popularity rank: 8
Likely audience value: High for active planners
Product importance: Major
Current maturity: Good
Primary files: `renderers/routeRenderer.js`, `services/firebaseService.js`, `engines/tripPlannerCore.js`

### Current Subfeatures

- Save current trip to Firestore.
- Saved route requires login.
- Saved route requires trip name.
- Saves route name, created date, trip days, stops, colors, and notes.
- Load saved route into planner.
- Delete saved route with confirmation.
- Initial saved route load.
- Load more saved routes.
- Saved route count display.
- Saved route cards show:
  - Name.
  - Date.
  - Day count.
  - Stop count.
  - Day color dots.

### Product Read

Saved routes are one of the clearest "account value" features. The user understands why login matters when their work is saved.

Future premium should likely expand saved routes by limits, notes, exports, and trip recap generation rather than basic access alone.

## 19. Feature Family 14: Virtual Expeditions

Popularity rank: 13
Likely audience value: Medium-Low broad, Medium for engaged users
Product importance: Support
Current maturity: Good but complex
Primary files: `modules/expeditionEngine.js`, `modules/barkConfig.js`, `trails.json`, `data/*.geojson`

### Current Subfeatures

- Virtual expedition basecamp module.
- Spin wheel trail assignment.
- Weighted/balanced trail selection.
- Active trail state.
- Trail total miles.
- Miles logged.
- Lifetime miles display.
- Live GPS Walk / neighborhood walk card.
- Start Walk action.
- Cancel Walk action.
- Daily/training walk copy that awards walk points.
- Manual mileage entry.
- GPS walk tracker.
- Wake lock attempt during GPS walk.
- Accuracy filtering.
- Minimum movement filtering.
- Live walk banner.
- iOS visibility/blackout fallback handling.
- Stop walk and save.
- Cancel walk with confirmation.
- Progress bar.
- Moving dog/avatar marker.
- Active trail overlay.
- Completed trail overlay.
- Completed route segment.
- Remaining route segment.
- Trail education modal.
- Fly to active trail.
- Claim reward.
- Completed expeditions list.
- Completed expedition trophy case.
- Walk history grouped by trail.
- Edit walk.
- Delete walk.
- Share single expedition.
- Share all expedition trophy case.

### Current Trails

The app includes trail data for:

- Half Dome.
- Angels Landing.
- Zion Narrows.
- Cascade Pass / Sahale Arm.
- Highline Trail.
- Harding Icefield.
- Old Rag Trail.
- Emerald Lake.
- Precipice Trail.
- Skyline Trail Loop.
- Grand Canyon Rim to Rim.

### Product Read

This is a big system. It is impressive, but it may not be the thing most beta users care about. It should probably be kept, simplified, and tied into the passport/journal identity rather than pushed as the primary paid reason.

## 20. Feature Family 15: Photo Watermark Tool

Popularity rank: 14
Likely audience value: Medium
Product importance: Support
Current maturity: Good
Primary files: `modules/shareEngine.js`, `index.html`, `assets/images/USBarkRangerLogoWatermark.jpeg`, `assets/images/WatermarkBARK.PNG`

### Current Subfeatures

- Upload a local photo.
- Preview photo on canvas.
- Add B.A.R.K. Ranger logo watermark.
- Logo size slider.
- High-resolution checkbox.
- Download JPEG.
- Clear/reset upload.
- Object URL cleanup.

### Product Read

This is strategically useful because the audience loves sharing dog photos. It complements Facebook rather than competing with Facebook.

Long term, this could connect to a paid journal/photo memory feature, but image storage should wait until billing, moderation, storage quotas, and abuse controls exist.

## 21. Feature Family 16: QR Code And Share Portal

Popularity rank: 15
Likely audience value: Medium-Low
Product importance: Support
Current maturity: Good
Primary files: `modules/shareEngine.js`, `index.html`

### Current Subfeatures

- Share link dropdown.
- QR code generation.
- Branded QR colors.
- QR download as PNG.
- Links to official/social destinations.
- Facebook group link.
- Instagram link.
- YouTube link.
- TikTok link.
- External website links.
- AllTrails link.

### Product Read

This is useful for outreach and community growth. It is not likely a direct daily-use feature.

## 22. Feature Family 17: Achievement And Expedition Share Images

Popularity rank: 14 to 16
Likely audience value: Medium
Product importance: Support
Current maturity: Good
Primary files: `modules/shareEngine.js`, `index.html`, `pages/TrophyCase.html`

### Current Subfeatures

- Lazy-load html2canvas only when needed.
- Share vault card.
- Download vault card fallback.
- Share single badge card.
- Download single badge fallback.
- Share single expedition.
- Share all completed expeditions.
- Use native Web Share with files when supported.
- Download fallback when Web Share is unavailable.
- Hidden export templates.

### Product Read

This supports the Facebook-complement strategy. The stronger future version is not generic achievement bragging. The stronger version is "make it easy to post my B.A.R.K. visit recap with my dog, my photos, my route, and my tips."

## 23. Feature Family 18: CSV And Personal Data Export

Popularity rank: 20
Likely audience value: Low-Medium
Product importance: Support/trust
Current maturity: Good
Primary files: `modules/shareEngine.js`, `index.html`

### Current Subfeatures

- Export map data to CSV.
- Include visited flag.
- Download file named `My_BarkRanger_Data.csv`.
- Appears in My Data and Routes area.

### Product Read

This is not flashy, but it is a trust feature. It tells serious users the app will not trap their data.

## 24. Feature Family 19: Feedback, Suggestions, And Community Contribution

Popularity rank: 16
Likely audience value: Medium-Low
Product importance: Support/Major for data freshness
Current maturity: Good
Primary files: `modules/uiController.js`, `renderers/panelRenderer.js`, `services/authService.js`, `index.html`

### Current Subfeatures

- Feedback text portal.
- Firestore feedback submission.
- Anonymous or signed-in feedback support.
- Add-location email portal.
- Suggest edit button from park panel.
- Mailto template for park edits.
- Mailto template for new place suggestions.
- User-facing support links.

### Product Read

This is a quiet but important bridge with the Facebook community. The app should not try to absorb all Facebook discussion yet. It should make it easier to turn community discoveries into structured map updates.

## 25. Feature Family 20: Settings And Personalization

Popularity rank: 10
Likely audience value: Medium, but critical for frustrated users
Product importance: Support/Critical
Current maturity: Good
Primary files: `modules/settingsRegistry.js`, `state/settingsStore.js`, `modules/settingsController.js`, `index.html`

### Current Settings

Account/visit setting:

- Allow unchecking visited places.

Map startup settings:

- Remember map position.
- Start at national view.

Navigation behavior:

- Instant navigation.
- Stop automatic map movements.

Map gestures:

- Lock map panning.
- Disable one-finger zoom.
- Disable pinch zoom.
- Disable double-tap zoom.

Pin and performance settings:

- Low Graphics Mode.
- Remove Shadows.
- Stop Resizing.
- Simplify Pins While Moving.
- Viewport Culling.
- Limit Zoom Out.
- Force Plain Pins.
- Simplify Trails.
- Standard Clustering.
- Bubble/cluster mode.
- Ultra-low emergency mode.

Cloud/settings actions:

- Save settings to cloud.
- Terminate and reload.

### How It Works

`settingsRegistry.js` declares settings, storage keys, default values, UI elements, and impact areas. `settingsStore.js` stores and mirrors values. `settingsController.js` binds the modal, applies CSS classes, changes map behavior, saves to cloud, and handles reload-required settings.

### Product Read

The settings system is surprisingly important because the map must run on older phones. Users do not care about the engineering, but they care deeply if the map feels slow or broken.

## 26. Feature Family 21: Map Performance Engine

Popularity rank: invisible but top 10 in importance
Likely audience value: High indirectly
Product importance: Critical
Current maturity: Good
Primary files: `modules/mapEngine.js`, `modules/renderEngine.js`, `modules/MarkerLayerManager.js`, `modules/markerLayerPolicy.js`, `state/settingsStore.js`, `styles/mapStyles.css`

### Current Subfeatures

- Leaflet Canvas renderer.
- Prefer canvas.
- Wheel debounce/delta tuning.
- Optional map animations disabled in ultra-low.
- Marker clustering.
- Dynamic cluster radius.
- Cluster disabled at high zoom.
- Plain marker layer.
- Stable marker reuse.
- Marker data fingerprints.
- Visibility fingerprints.
- RequestAnimationFrame render coalescing.
- Marker filtering without full rebuild where possible.
- Viewport culling.
- CSS hiding through marker classes.
- Low graphics body classes.
- Reduce motion style paths.
- Simplify pins while moving.
- Remove shadows.
- Stop pin resizing.
- Simplify trails.

### Product Read

This is one of the most important non-visible features in the app. The dataset is large enough that careless rendering would make the app feel unusable.

## 27. Feature Family 22: Mobile UX And Keyboard Safety

Popularity rank: invisible but important
Likely audience value: High indirectly
Product importance: Major
Current maturity: Good
Primary files: `modules/uiController.js`, `modules/mapEngine.js`, `styles.css`

### Current Subfeatures

- Visual viewport keyboard detection.
- `keyboard-open` body class.
- Close map-only surfaces when keyboard appears.
- Suppress planner suggestions during scroll/blur.
- Preserve scroll after keyboard close.
- Prevent slide panel from staying open on non-map tabs.
- Disable Leaflet click/scroll propagation inside panel.
- Collapse filter on map movement.
- Map click closes panel/filter.
- iOS context menu protection.
- Optional custom one-finger zoom.
- Optional gesture disabling.

### Product Read

Mobile behavior is critical because the core audience will use this on phones while planning or traveling.

## 28. Feature Family 23: Main Navigation And App Shell

Popularity rank: support
Likely audience value: Medium
Product importance: Critical
Current maturity: Good
Primary files: `index.html`, `modules/uiController.js`, `core/app.js`

### Current Subfeatures

- Home tab.
- Map tab.
- Planner tab.
- Profile tab.
- Planner stop-count badge.
- Navigation hides/shows the right UI surfaces.
- Map tab restores Leaflet controls and filter panel.
- Non-map tabs hide map-only controls.
- Loader on startup.
- Map unavailable fallback.
- Refresh button for map failure.
- Update toast with refresh action.

### Product Read

The app has enough features that navigation discipline matters. The four-tab model is understandable. The risk is that future features could overload the profile or panel unless new information architecture is planned.

## 29. Feature Family 24: Home View And Education Content

Popularity rank: 14 to 18
Likely audience value: Medium-Low
Product importance: Support/brand
Current maturity: Good
Primary files: `index.html`, `modules/shareEngine.js`

### Current Subfeatures

- Welcome/home content.
- Photo watermark tool.
- B.A.R.K. rule/education cards:
  - Bag pet waste.
  - Always leash pets.
  - Respect wildlife.
  - Know where you can go.
- External resource links.
- Social links.
- Share portal.

### Product Read

This is helpful brand and education content, but the app should open into utility quickly. Users likely come for the map, tracking, or planning.

## 30. Feature Family 25: Admin Data Refinery

Popularity rank: user-invisible, admin-critical
Likely audience value: Very High indirectly
Product importance: Internal/Critical
Current maturity: Good but should stay admin-only
Primary files: `pages/admin.html`, `pages/admin.js`, `functions/index.js`, `BARK Master List.csv`

### Current Subfeatures

- Admin auth gate.
- Non-admin redirect.
- Back to map button.
- AI engine selector.
- Lightweight model options.
- Heavyweight model options.
- Paid model option.
- Bundle size selector:
  - 1 image.
  - 3 images.
  - 5 images.
  - all images.
- Drag-and-drop screenshot upload.
- Click-to-select screenshot upload.
- Multiple image queue.
- Image thumbnail preview.
- Remove individual scheduled image.
- Paste raw text input.
- Process data button.
- Live processing timer.
- Loading overlay.
- Per-bundle progress subtitle.
- Raw AI output panel.
- Review queue dropdown.
- Source image display.
- Park name fuzzy matching.
- Master CSV lookup with Fuse.js.
- Date of info field.
- Force re-geocode checkbox.
- Entrance fee field.
- Swag location field.
- Approved trails field.
- Strict rules field.
- Hazards field.
- Extra swag field.
- Sync to map button.
- Discard current queue item button.
- New-site append guardrail.
- Confirmation before appending new row.
- Google Sheets sync.
- Existing coordinate preservation unless force-geocode is enabled.
- Smart merge that appends dated notes instead of blindly overwriting.
- Dev trail warp grid.
- Dev set-walk-points tool.

### How It Works

Admins can drop screenshots or paste Facebook/community text. The frontend sends content to a Firebase callable function, which uses Gemini to extract structured B.A.R.K. park data. The admin verifies the extracted result, matches it against the master park list, edits fields, and syncs it into Google Sheets.

### Product Read

This feature is not for normal users, but it is strategically important. The community data moat only stays alive if new info can be processed quickly and safely.

This should eventually become more robust, audited, and less dependent on fragile client-side admin glue.

## 31. Feature Family 26: Backend Cloud Functions

Popularity rank: invisible
Likely audience value: High indirectly
Product importance: Critical/Internal
Current maturity: Good but needs hardening before scale
Primary files: `functions/index.js`, `functions/package.json`

### Current Functions

- OpenRouteService route proxy / premium route function.
- Scheduled hourly leaderboard generation.
- Gemini data extraction callable.
- Google Sheets sync callable.

### Data Extraction Function

Current capabilities:

- Accepts image payloads.
- Accepts raw text.
- Supports multiple engine routes.
- Uses Google Generative AI.
- Enforces strict JSON output expectations.
- Extracts:
  - source image.
  - date found.
  - park name.
  - entrance fee.
  - swag location.
  - approved trails.
  - strict rules.
  - hazards.
  - extra swag.

### Spreadsheet Sync Function

Current capabilities:

- Reads the target Google Sheet.
- Normalizes park names.
- Finds exact or strong matches.
- Preserves old values when new values are empty.
- Appends dated new notes.
- Preserves coordinates unless forced or missing.
- Geocodes when needed.
- Updates matching rows.
- Requires explicit append confirmation for new sites.

### Product Read

This is important infrastructure. Before payments or public submissions, backend security, key handling, rate limits, and admin audit trails need tightening.

## 32. Feature Family 27: PWA, Hosting, And App Reliability

Popularity rank: support
Likely audience value: Medium indirectly
Product importance: Major
Current maturity: Good
Primary files: `manifest.json`, `firebase.json`, `core/app.js`, `version.json`

### Current Subfeatures

- PWA manifest.
- Standalone display mode.
- App name: US BARK Rangers.
- App icon.
- Firebase hosting config.
- Hosted root publish.
- Hosting ignores docs, plans, functions, raw data, scripts, tests, package files, and markdown.
- Boot error collection.
- Named initialization calls.
- Map readiness timeout.
- Map unavailable fallback.
- Loader dismissal on failure.
- Safe polling after boot.
- Update toast when version changes.

### Product Read

This makes the app feel more legitimate and resilient. It matters most when beta users are testing on unpredictable devices.

## 33. Feature Family 28: Offline And Cache Behavior

Popularity rank: support
Likely audience value: Medium indirectly
Product importance: Major
Current maturity: Good
Primary files: `modules/dataService.js`, `services/authService.js`, `services/firebaseService.js`

### Current Subfeatures

- Local CSV cache.
- Cached data hydration before fresh fetch.
- Offline fallback if data exists.
- Offline/no-cache error handling.
- Offline account status display.
- Guest reset on logout.
- Cloud snapshot unsubscribe on logout.
- Local storage settings.
- Local mutation staging for visits.

### Product Read

This is valuable for travelers. It does not yet look like a full offline-first product, but the basics are present.

## 34. Feature Family 29: Feedback-Free Safety And Error Recovery

Popularity rank: invisible
Likely audience value: High indirectly
Product importance: Major
Current maturity: Good but still fragile in places
Primary files: `core/app.js`, `modules/mapEngine.js`, `modules/dataService.js`, `services/firebaseService.js`, `docs/audits/BARK_LOGIC_BUG_TRIAGE.md`

### Current Subfeatures

- Guarded map initialization.
- Guarded missing Leaflet/map behavior in newer modules.
- Trip layer can survive missing map/Leaflet.
- Boot error tracking.
- Refresh fallback.
- Poll aborts.
- Snapshot reconciliation.
- Confirmations for destructive trip/day/route actions.
- Settings emergency reload.

### Product Read

The app has many guardrails, but the audit docs are right: global state, mixed responsibilities, and old inline handlers still make debugging risky as features grow.

## 35. Feature Family 30: Scripts And Data Build Utilities

Popularity rank: internal
Likely audience value: none directly
Product importance: Internal/Support
Current maturity: Early to Good
Primary files: `scripts/*`, `raw_trails/*`, `data/*`

### Current Utility Areas

- Trail building.
- Trail fetching.
- GeoJSON conversion.
- Geocoding.
- CSV fixing.
- Google Sheets autopilot.
- Beta user migration.
- HTML/div testing helpers.
- Version update helper.

### Product Read

These tools support the data and release workflow. They should be documented more clearly before other maintainers or AI agents work heavily in the repo.

## 36. Current Individual Feature Checklist

This section is a shorter checklist of current features by surface.

### Map Surface

- Full-screen map.
- Map unavailable fallback.
- Loading spinner.
- Custom B.A.R.K. pins.
- Marker clusters.
- Plain marker mode.
- Visited marker styling.
- Trip marker styling.
- User location marker.
- Locate behavior.
- Map tile switching.
- Initial national view.
- Remembered map view.
- Map movement state classes.
- Zoom behavior tuning.
- Mobile one-finger zoom.
- Gesture disabling options.

### Search And Filters

- Search by park name.
- Clear search.
- Local suggestions.
- Fuzzy match.
- Abbreviation match.
- Search cache.
- Chunked search.
- Global town/location search.
- Planner inline search.
- Start/end inline search.
- Type filter.
- Tag filter.
- Bandana filter.
- Certificate filter.
- Other swag filter.
- Visited filter.
- Active trail toggle.
- Completed trails toggle.

### Park Panel

- Panel title.
- Visit buttons.
- Verified check-in.
- Manual visited toggle.
- Suggest edit.
- State/type/cost meta.
- Reports/updates.
- Show full report.
- Website buttons.
- Swag photo links.
- Video link.
- Google Maps button.
- Apple Maps button.
- Add to Trip.
- In-trip status.
- Auto-pan.
- Close panel.

### Account/Profile

- Google login.
- Logout.
- Profile name.
- Offline status.
- Admin detection.
- Score.
- Verified count.
- Regular count.
- States count.
- Daily streak.
- Current rank/title.
- Rank progress.
- Scoring modal.
- Rank-up celebration.
- My Data and Routes.
- Saved itineraries.
- Visited places list.
- Visit date edit.
- Remove visited place.
- CSV export.

### Achievements

- Paws tab.
- States tab.
- Rare Feats tab.
- Mystery dossier.
- Badge cards.
- Locked/unlocked states.
- Verified/honor tier logic.
- Achievement save to Firestore.
- Vault sharing.
- Single badge sharing.

### Leaderboard

- Top entries.
- Top 5 display.
- Load more.
- Self-rank.
- Self pinned fallback.
- Score sync.
- Scheduled snapshot.

### Trip Planner

- Trip name.
- Trip day tabs.
- Active day.
- Add day.
- Remove day.
- Insert day.
- Shift day left/right.
- Day color.
- Per-day stops.
- Per-day notes.
- Notes character count.
- Add stop from park.
- Add town/location.
- Start location.
- End location.
- Remove start/end.
- Inline park search.
- Inline global search.
- Move stop.
- Move stop between days.
- Remove stop.
- Remove stop from map popup.
- Ghost add-stop row.
- Auto-sort day.
- Smart optimize trip.
- Max stops/day.
- Max drive hours/day.
- Generate route.
- Route telemetry.
- Google Maps export.
- Save route.
- Load route.
- Delete route.
- Clear trip.
- Planner nav badge.

### Trip Map Layer

- Dedicated trip layer.
- Non-clustered badges.
- Round numbered B.A.R.K. markers.
- Start marker.
- End marker.
- Day lines.
- Route line compatibility.
- Underlying official pin hiding.
- Marker reuse.
- Town popup.
- Park popup.
- Remove stop confirmation/action.

### Virtual Expedition

- Spin for trail.
- Active trail.
- Completed trails.
- Manual mileage.
- Live GPS Walk card.
- Start/cancel walk controls.
- GPS walk tracking.
- Walk banner.
- Wake lock attempt.
- Progress bar.
- Trail map overlay.
- Fly to trail.
- Trail education modal.
- Claim reward.
- Completed expedition grid.
- Walk history.
- Edit walk.
- Delete walk.
- Share expedition.
- Share trophy case.

### Sharing/Home

- Photo upload.
- Watermark preview.
- Logo size slider.
- High-resolution export.
- Download watermarked photo.
- QR code generation.
- QR download.
- Social links.
- External resource links.
- B.A.R.K. rules education.

### Settings

- Allow uncheck.
- Remember map position.
- National view startup.
- Instant navigation.
- Stop auto map movements.
- Lock map panning.
- Disable one-finger zoom.
- Disable pinch zoom.
- Disable double-tap zoom.
- Low graphics mode.
- Remove shadows.
- Stop resizing.
- Simplify pins while moving.
- Viewport culling.
- Limit zoom out.
- Force plain pins.
- Simplify trails.
- Standard clustering.
- Premium/bubble clustering.
- Ultra-low mode.
- Save settings to cloud.
- Terminate and reload.

### Admin

- Admin-only access.
- Screenshot upload.
- Multi-image queue.
- Thumbnail previews.
- Remove scheduled image.
- Text paste.
- AI engine selection.
- Bundle-size selection.
- Processing timer.
- Review queue.
- Raw JSON preview.
- Fuzzy park matching.
- Field verification/editing.
- Force geocode.
- Sync to Google Sheet.
- Append confirmation.
- Discard item.
- Trail warp dev tool.
- Walk points override.

## 37. Most Important Features For The Current Audience

Based on the Facebook-group audience and current beta direction, these are probably the highest-value features:

1. Official park data.
2. Search by park, region, or town.
3. Park detail panel with practical info.
4. Directions and map handoff.
5. Track visited parks.
6. See unvisited parks.
7. Profile/passport progress.
8. Plan a B.A.R.K.-specific route.
9. Save route and notes.
10. Share a clean recap or planning screenshot to Facebook.

The current app already has pieces of all ten. The work now is not inventing more features. The work is simplifying, stabilizing, and turning the strongest pieces into one obvious user story.

## 38. Features That Are Strong But Easy To Overlook

- Data polling and update toast.
- Marker reuse and render coalescing.
- Local data cache.
- Visit mutation reconciliation.
- Settings registry.
- Mobile keyboard handling.
- Trip layer marker reuse.
- Admin data refinery.
- Google Sheets merge guardrails.

These are not marketing features, but they are the reason the app can stay usable.

## 39. Features That May Be Overbuilt For Current Demand

- Virtual expeditions.
- Deep achievement system.
- Leaderboard.
- Some advanced performance settings exposed directly to users.
- Multiple map-clustering modes as user-facing choices.
- Too many profile modules competing for attention.

These features are not bad. The risk is that they make the app feel busier than the core audience needs. They should be trimmed, hidden, or reframed around the passport/journal plan.

## 40. Current Monetization Read

Strongest future premium candidates:

- Unlimited tracked official parks after a free limit.
- Private B.A.R.K. Passport.
- Visit notes.
- Verified visit history.
- Personal trip notes.
- Saved route expansion.
- Facebook-ready route planning post export.
- Post-trip recap export.
- Photo memories, only after storage limits and payment exist.

Weak current premium candidates:

- Basic map access.
- Basic park search.
- Basic park details.
- Basic directions.
- Generic route planning.
- Points only.
- Leaderboard only.
- Expeditions only.

The paid product should feel like: "I am saving and sharing my B.A.R.K. journey." It should not feel like: "I am paying to see the community map that brought me here."

## 41. Architecture Notes Relevant To Feature Growth

Current good patterns:

- `MarkerLayerManager.js` owns marker reuse.
- `TripLayerManager.js` owns trip overlay markers.
- `settingsRegistry.js` centralizes settings metadata.
- `settingsStore.js` centralizes setting values.
- `domRefs.js` centralizes many DOM lookups.
- `orsService.js` is a clean service boundary.
- `routeRenderer.js` moved saved route rendering out of Firebase service.
- `core/app.js` gives boot a clearer orchestrator.

Current risky patterns:

- Heavy reliance on `window.BARK` and legacy globals.
- Some business logic still lives in renderers.
- Some inline `onclick` patterns remain.
- Auth, user sync, settings, achievements, and UI updates still interact heavily.
- Profile has many feature families packed into one surface.
- Park panel is becoming the natural dumping ground for future ideas.
- Payment/entitlement is not yet separated from login.

## 42. Brutally Honest Current Feature Verdict

The app already has enough features for a serious beta. It does not need a pile of brand-new features before refactor. It needs:

1. Stability.
2. A clearer free-account vs paid-account model.
3. A cleaner official data vs personal data boundary.
4. A simpler profile/passport story.
5. A trip planner reframed around B.A.R.K. planning and Facebook sharing.
6. Admin/data tools protected because they feed the moat.

The strongest current app is not "a map with games." It is "the trusted B.A.R.K. map plus my personal B.A.R.K. passport and trip notebook."

That is the feature story everything else should support.
