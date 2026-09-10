# Current source inventory and measured line counts

Measured September 9, 2026 from working-tree source at commit `8451e06`. Source measurement only; no live deployment or spreadsheet freshness is inferred.

## Counting method

Physical lines use UTF-8-decoded splitlines(); nonblank lines remove only whitespace-only rows. Comments remain. This is not language-aware executable SLOC. Consumer files are first-party JS/HTML/CSS; backend production is the 19 top-level JS modules. Exclude vendor/node_modules, data, images, JSON manifests, lockfiles, generated artifacts and documentation.

The beta dependency set is index.v145.html, its existing local first-party JS/CSS src/href references with query/hash stripped, sw.js and offline/cacheManifest-0.145.js, counted once. Dynamic third-party html2canvas is excluded. This static dependency definition does not prove execution or dead code.

| Scope | Files | Physical lines | Nonblank lines |
|---|---:|---:|---:|
| Beta consumer dependency set | 75 | 39,957 | 35,178 |
| Other app-tree source | 31 | 29,555 | 26,257 |
| All first-party app-tree source | 106 | 69,512 | 61,435 |
| Backend production modules | 19 | 10,039 | 9,073 |

Production 0.142 measured by the same method is 39,812 physical / 35,039 nonblank lines across 76 files. Latest beta is the behavior baseline.

## All 106 app source files

Other release source is not necessarily byte-for-byte duplicate or safe to delete now: some is used by production and installed older service workers.

| Current file | Lines | Nonblank | Classification | Native/retention destination |
|---|---:|---:|---|---|
| [01-code/app/MapMarkerConfig.js](../../../01-code/app/MapMarkerConfig.js) | 64 | 54 | Beta dependency | ParkAnnotation |
| [01-code/app/config/domRefs.js](../../../01-code/app/config/domRefs.js) | 211 | 187 | Beta dependency | Retire DOM registry; typed SwiftUI references |
| [01-code/app/core/app.js](../../../01-code/app/core/app.js) | 312 | 270 | Other release source | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/core/app.v141.js](../../../01-code/app/core/app.v141.js) | 378 | 329 | Other release source | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/core/app.v144.js](../../../01-code/app/core/app.v144.js) | 433 | 381 | Other release source | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/core/app.v145.js](../../../01-code/app/core/app.v145.js) | 442 | 390 | Beta dependency | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/engines/tripPlannerCore.js](../../../01-code/app/engines/tripPlannerCore.js) | 1,778 | 1,553 | Beta dependency | TripEditorModel / TripRepository / TripOptimizer / TripRoutePlan |
| [01-code/app/engines/tripRouteBatch.js](../../../01-code/app/engines/tripRouteBatch.js) | 219 | 196 | Beta dependency | RoutePreviewService; no native ORS batching |
| [01-code/app/engines/tripRoutePlan.js](../../../01-code/app/engines/tripRoutePlan.js) | 168 | 149 | Beta dependency | TripRoutePlan |
| [01-code/app/gamificationLogic.js](../../../01-code/app/gamificationLogic.js) | 637 | 555 | Beta dependency | AchievementPolicy / ExpeditionPolicy / definitions |
| [01-code/app/index.html](../../../01-code/app/index.html) | 1,867 | 1,701 | Other release source | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/index.v141.html](../../../01-code/app/index.v141.html) | 1,871 | 1,705 | Other release source | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/index.v142.html](../../../01-code/app/index.v142.html) | 1,871 | 1,705 | Other release source | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/index.v143.html](../../../01-code/app/index.v143.html) | 1,964 | 1,792 | Other release source | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/index.v144.html](../../../01-code/app/index.v144.html) | 1,964 | 1,792 | Other release source | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/index.v145.html](../../../01-code/app/index.v145.html) | 1,964 | 1,792 | Beta dependency | Native app composition/startup/views; preserve old web entry until retirement |
| [01-code/app/modules/MarkerLayerManager.js](../../../01-code/app/modules/MarkerLayerManager.js) | 450 | 387 | Beta dependency | MapCoordinator / ParkAnnotation / native clustering |
| [01-code/app/modules/RefreshCoordinator.js](../../../01-code/app/modules/RefreshCoordinator.js) | 150 | 126 | Beta dependency | Observation / repository revision streams |
| [01-code/app/modules/TripLayerManager.js](../../../01-code/app/modules/TripLayerManager.js) | 623 | 572 | Beta dependency | MapOverlayRenderer / ParkAnnotation |
| [01-code/app/modules/achievementsPanel.js](../../../01-code/app/modules/achievementsPanel.js) | 295 | 256 | Beta dependency | AchievementGridView |
| [01-code/app/modules/barkConfig.js](../../../01-code/app/modules/barkConfig.js) | 63 | 58 | Beta dependency | Build config / policy / bundled resources |
| [01-code/app/modules/barkState.js](../../../01-code/app/modules/barkState.js) | 164 | 147 | Beta dependency | Domain values / feature models / AppComposition |
| [01-code/app/modules/dataService.js](../../../01-code/app/modules/dataService.js) | 667 | 572 | Other release source | CatalogRepository / CatalogValidator / publisher |
| [01-code/app/modules/dataService.v142.js](../../../01-code/app/modules/dataService.v142.js) | 845 | 732 | Other release source | CatalogRepository / CatalogValidator / publisher |
| [01-code/app/modules/dataService.v143.js](../../../01-code/app/modules/dataService.v143.js) | 855 | 742 | Beta dependency | CatalogRepository / CatalogValidator / publisher |
| [01-code/app/modules/errorReporter.js](../../../01-code/app/modules/errorReporter.js) | 281 | 257 | Beta dependency | Diagnostics / operations/clientDiagnostics |
| [01-code/app/modules/expeditionEngine.js](../../../01-code/app/modules/expeditionEngine.js) | 1,101 | 928 | Beta dependency | ExpeditionRepository / ExpeditionModel / TrailRepository |
| [01-code/app/modules/externalPinReturn.js](../../../01-code/app/modules/externalPinReturn.js) | 285 | 243 | Beta dependency | AppLifecycle / MapsHandoff |
| [01-code/app/modules/feedbackModal.js](../../../01-code/app/modules/feedbackModal.js) | 402 | 340 | Beta dependency | FeedbackView / FeedbackModel / FeedbackService |
| [01-code/app/modules/feedbackSubjectPicker.js](../../../01-code/app/modules/feedbackSubjectPicker.js) | 241 | 207 | Beta dependency | FeedbackView / FeedbackModel / FeedbackService |
| [01-code/app/modules/feedbackTransport.js](../../../01-code/app/modules/feedbackTransport.js) | 170 | 151 | Beta dependency | FeedbackView / FeedbackModel / FeedbackService |
| [01-code/app/modules/firstOpenDisclaimer.js](../../../01-code/app/modules/firstOpenDisclaimer.js) | 69 | 58 | Beta dependency | Native Home/Settings education/legal content |
| [01-code/app/modules/launchFlags.js](../../../01-code/app/modules/launchFlags.js) | 16 | 16 | Beta dependency | Runtime config / entitlement gates |
| [01-code/app/modules/leaderboardEngine.js](../../../01-code/app/modules/leaderboardEngine.js) | 773 | 676 | Beta dependency | LeaderboardRepository / LeaderboardModel / server projection |
| [01-code/app/modules/leaderboardSyncPolicy.js](../../../01-code/app/modules/leaderboardSyncPolicy.js) | 98 | 84 | Beta dependency | LeaderboardRepository / LeaderboardModel / server projection |
| [01-code/app/modules/loadState.js](../../../01-code/app/modules/loadState.js) | 164 | 143 | Beta dependency | StartupModel / StartupView |
| [01-code/app/modules/managePortal.js](../../../01-code/app/modules/managePortal.js) | 146 | 124 | Beta dependency | VisitHistoryView / WalkHistoryView |
| [01-code/app/modules/mapEngine.js](../../../01-code/app/modules/mapEngine.js) | 627 | 546 | Other release source | NativeMapView / MapCoordinator |
| [01-code/app/modules/mapEngine.v143.js](../../../01-code/app/modules/mapEngine.v143.js) | 627 | 546 | Beta dependency | NativeMapView / MapCoordinator |
| [01-code/app/modules/markerLayerPolicy.js](../../../01-code/app/modules/markerLayerPolicy.js) | 43 | 38 | Beta dependency | MapCoordinator / native clustering |
| [01-code/app/modules/monitoringContext.js](../../../01-code/app/modules/monitoringContext.js) | 331 | 305 | Beta dependency | Diagnostics |
| [01-code/app/modules/oauthFragmentGuard.js](../../../01-code/app/modules/oauthFragmentGuard.js) | 34 | 30 | Other release source | AccountService / ProviderSignIn / AccountModel |
| [01-code/app/modules/paywallController.js](../../../01-code/app/modules/paywallController.js) | 1,300 | 1,165 | Beta dependency | Review ownership against Swift file map before retirement |
| [01-code/app/modules/profileEngine.js](../../../01-code/app/modules/profileEngine.js) | 425 | 362 | Beta dependency | PassportModel / ProfileRepository |
| [01-code/app/modules/rateLimitUi.js](../../../01-code/app/modules/rateLimitUi.js) | 197 | 179 | Beta dependency | Typed retry/error state in feature models |
| [01-code/app/modules/renderEngine.js](../../../01-code/app/modules/renderEngine.js) | 576 | 499 | Beta dependency | MapFeatureModel / ParkFilter |
| [01-code/app/modules/riskyAndroidDesktopViewportRecovery.js](../../../01-code/app/modules/riskyAndroidDesktopViewportRecovery.js) | 232 | 205 | Beta dependency | Retire browser-only recovery after web retirement |
| [01-code/app/modules/searchEngine.js](../../../01-code/app/modules/searchEngine.js) | 1,249 | 1,064 | Beta dependency | Review ownership against Swift file map before retirement |
| [01-code/app/modules/settingsController.js](../../../01-code/app/modules/settingsController.js) | 717 | 621 | Beta dependency | SettingsRepository / SettingsModel / AppSettings |
| [01-code/app/modules/settingsRegistry.js](../../../01-code/app/modules/settingsRegistry.js) | 184 | 180 | Beta dependency | SettingsRepository / SettingsModel / AppSettings |
| [01-code/app/modules/shareEngine.js](../../../01-code/app/modules/shareEngine.js) | 234 | 208 | Beta dependency | ExportModel / ShareCardView / ImageExportService |
| [01-code/app/modules/uiController.js](../../../01-code/app/modules/uiController.js) | 951 | 839 | Beta dependency | RootView / feature views / AppRouter |
| [01-code/app/modules/viewportCoordinator.js](../../../01-code/app/modules/viewportCoordinator.js) | 522 | 474 | Beta dependency | Native safe areas and keyboard behavior |
| [01-code/app/modules/visitorAnalytics.js](../../../01-code/app/modules/visitorAnalytics.js) | 128 | 114 | Beta dependency | Native metrics policy; retain web analytics as needed |
| [01-code/app/modules/walkTracker.js](../../../01-code/app/modules/walkTracker.js) | 928 | 802 | Beta dependency | WalkRecorder / LocationClient / RecordingStore |
| [01-code/app/modules/watermarkTool.js](../../../01-code/app/modules/watermarkTool.js) | 813 | 720 | Beta dependency | PhotoWatermarkView / PhotoWatermarkModel / ImageExportService |
| [01-code/app/offline/cacheManifest-0.141.js](../../../01-code/app/offline/cacheManifest-0.141.js) | 123 | 123 | Other release source | App Store bundle / CatalogDiskStore; retain atomic web releases until retirement |
| [01-code/app/offline/cacheManifest-0.142.js](../../../01-code/app/offline/cacheManifest-0.142.js) | 126 | 126 | Other release source | App Store bundle / CatalogDiskStore; retain atomic web releases until retirement |
| [01-code/app/offline/cacheManifest-0.143.js](../../../01-code/app/offline/cacheManifest-0.143.js) | 129 | 129 | Other release source | App Store bundle / CatalogDiskStore; retain atomic web releases until retirement |
| [01-code/app/offline/cacheManifest-0.144.js](../../../01-code/app/offline/cacheManifest-0.144.js) | 129 | 129 | Other release source | App Store bundle / CatalogDiskStore; retain atomic web releases until retirement |
| [01-code/app/offline/cacheManifest-0.145.js](../../../01-code/app/offline/cacheManifest-0.145.js) | 129 | 129 | Beta dependency | App Store bundle / CatalogDiskStore; retain atomic web releases until retirement |
| [01-code/app/offline/cacheManifest.js](../../../01-code/app/offline/cacheManifest.js) | 114 | 114 | Other release source | App Store bundle / CatalogDiskStore; retain atomic web releases until retirement |
| [01-code/app/offline/offlineBootstrap.js](../../../01-code/app/offline/offlineBootstrap.js) | 80 | 70 | Beta dependency | App Store bundle / CatalogDiskStore; retain atomic web releases until retirement |
| [01-code/app/pages/TrophyCase.html](../../../01-code/app/pages/TrophyCase.html) | 130 | 118 | Legacy trophy fragment | Native achievements replace legacy trophy fragment after review |
| [01-code/app/pages/admin.html](../../../01-code/app/pages/admin.html) | 451 | 394 | Admin retained | Retain restricted admin web tool |
| [01-code/app/pages/admin.js](../../../01-code/app/pages/admin.js) | 603 | 518 | Admin retained | Retain restricted admin web tool |
| [01-code/app/pages/privacy.html](../../../01-code/app/pages/privacy.html) | 213 | 180 | Legal retained | Retain hosted legal content; bundle native text |
| [01-code/app/pages/terms.html](../../../01-code/app/pages/terms.html) | 236 | 198 | Legal retained | Retain hosted legal content; bundle native text |
| [01-code/app/renderers/leaderboardRenderer.js](../../../01-code/app/renderers/leaderboardRenderer.js) | 92 | 78 | Beta dependency | LeaderboardView |
| [01-code/app/renderers/panelRenderer.js](../../../01-code/app/renderers/panelRenderer.js) | 793 | 714 | Beta dependency | ParkDetailView / ParkDetailModel |
| [01-code/app/renderers/routeRenderer.js](../../../01-code/app/renderers/routeRenderer.js) | 330 | 281 | Beta dependency | SavedTripsView / SavedTripsModel |
| [01-code/app/repos/ParkRepo.js](../../../01-code/app/repos/ParkRepo.js) | 233 | 205 | Beta dependency | CatalogRepository |
| [01-code/app/repos/VaultRepo.js](../../../01-code/app/repos/VaultRepo.js) | 730 | 624 | Other release source | LocalStore / VisitRepository |
| [01-code/app/repos/VaultRepo.v141.js](../../../01-code/app/repos/VaultRepo.v141.js) | 802 | 690 | Beta dependency | LocalStore / VisitRepository |
| [01-code/app/services/authAccountUi.js](../../../01-code/app/services/authAccountUi.js) | 1,463 | 1,305 | Beta dependency | AccountService / ProviderSignIn / AccountModel |
| [01-code/app/services/authPremiumUi.js](../../../01-code/app/services/authPremiumUi.js) | 174 | 157 | Beta dependency | AccountService / ProviderSignIn / AccountModel |
| [01-code/app/services/authService.js](../../../01-code/app/services/authService.js) | 1,758 | 1,533 | Other release source | AccountService / ProviderSignIn / AccountModel |
| [01-code/app/services/authService.v141.js](../../../01-code/app/services/authService.v141.js) | 1,803 | 1,578 | Other release source | AccountService / ProviderSignIn / AccountModel |
| [01-code/app/services/authService.v145.js](../../../01-code/app/services/authService.v145.js) | 1,803 | 1,578 | Beta dependency | AccountService / ProviderSignIn / AccountModel |
| [01-code/app/services/checkinService.js](../../../01-code/app/services/checkinService.js) | 1,590 | 1,392 | Other release source | VisitRepository / VisitPolicy / LocationClient / SyncEngine |
| [01-code/app/services/checkinService.v141.js](../../../01-code/app/services/checkinService.v141.js) | 1,898 | 1,683 | Beta dependency | VisitRepository / VisitPolicy / LocationClient / SyncEngine |
| [01-code/app/services/firebaseService.js](../../../01-code/app/services/firebaseService.js) | 1,538 | 1,330 | Other release source | LocalStore / feature repositories / SyncEngine / CloudUserClient |
| [01-code/app/services/firebaseService.v141.js](../../../01-code/app/services/firebaseService.v141.js) | 1,832 | 1,606 | Other release source | LocalStore / feature repositories / SyncEngine / CloudUserClient |
| [01-code/app/services/firebaseService.v145.js](../../../01-code/app/services/firebaseService.v145.js) | 1,839 | 1,613 | Beta dependency | LocalStore / feature repositories / SyncEngine / CloudUserClient |
| [01-code/app/services/orsRouteCache.js](../../../01-code/app/services/orsRouteCache.js) | 96 | 87 | Beta dependency | MapKit native search/preview; web ORS retirement gate |
| [01-code/app/services/orsService.js](../../../01-code/app/services/orsService.js) | 191 | 174 | Beta dependency | MapKit native search/preview; web ORS retirement gate |
| [01-code/app/services/premiumService.js](../../../01-code/app/services/premiumService.js) | 326 | 292 | Other release source | EntitlementRepository / PurchaseService |
| [01-code/app/services/premiumService.v145.js](../../../01-code/app/services/premiumService.v145.js) | 328 | 293 | Beta dependency | EntitlementRepository / PurchaseService |
| [01-code/app/services/visitMutationCoordinator.js](../../../01-code/app/services/visitMutationCoordinator.js) | 267 | 243 | Other release source | UserMutation / SyncEngine |
| [01-code/app/services/visitMutationCoordinator.v141.js](../../../01-code/app/services/visitMutationCoordinator.v141.js) | 270 | 246 | Beta dependency | UserMutation / SyncEngine |
| [01-code/app/state/appState.js](../../../01-code/app/state/appState.js) | 147 | 124 | Beta dependency | AccountSession / scoped repositories |
| [01-code/app/state/settingsStore.js](../../../01-code/app/state/settingsStore.js) | 309 | 267 | Beta dependency | SettingsRepository / SettingsModel / AppSettings |
| [01-code/app/styles/feedbackModal.css](../../../01-code/app/styles/feedbackModal.css) | 386 | 336 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles/loadState.css](../../../01-code/app/styles/loadState.css) | 66 | 58 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles/mapStyles.css](../../../01-code/app/styles/mapStyles.css) | 461 | 396 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles/riskyAndroidDesktopViewportRecovery.css](../../../01-code/app/styles/riskyAndroidDesktopViewportRecovery.css) | 200 | 169 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles/trophyCase.css](../../../01-code/app/styles/trophyCase.css) | 995 | 882 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles/viewportShell.css](../../../01-code/app/styles/viewportShell.css) | 155 | 141 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles/walkTracker.css](../../../01-code/app/styles/walkTracker.css) | 68 | 61 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles/watermarkTool.css](../../../01-code/app/styles/watermarkTool.css) | 90 | 79 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles.css](../../../01-code/app/styles.css) | 4,624 | 4,075 | Other release source | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/styles.v141.css](../../../01-code/app/styles.v141.css) | 4,684 | 4,126 | Beta dependency | SwiftUI/native presentation; retain CSS while web release is supported |
| [01-code/app/sw.js](../../../01-code/app/sw.js) | 313 | 287 | Beta dependency | App Store bundle / CatalogDiskStore; retain atomic web releases until retirement |
| [01-code/app/utils/geoUtils.js](../../../01-code/app/utils/geoUtils.js) | 45 | 38 | Beta dependency | Coordinate values / location APIs / distance policies |
| [01-code/app/utils/imageDownscale.js](../../../01-code/app/utils/imageDownscale.js) | 159 | 138 | Beta dependency | ImageExportService |
| [01-code/app/utils/scoringUtils.js](../../../01-code/app/utils/scoringUtils.js) | 72 | 61 | Beta dependency | AchievementPolicy / server scoring contract |

## All 19 backend production modules

Endpoint retention gates and full proposed APIs appear in BACKEND_FILE_MAP.md.

| Current file | Lines | Nonblank | Destination |
|---|---:|---:|---|
| [01-code/functions/analyticsReporting.js](../../../01-code/functions/analyticsReporting.js) | 284 | 260 | operations alerts/clientDiagnostics/reports/costMonitoring/metricsSources; preserve distinct outputs |
| [01-code/functions/businessReporting.js](../../../01-code/functions/businessReporting.js) | 200 | 180 | operations alerts/clientDiagnostics/reports/costMonitoring/metricsSources; preserve distinct outputs |
| [01-code/functions/catalogSnapshot.js](../../../01-code/functions/catalogSnapshot.js) | 365 | 328 | Publisher plus legacy snapshot compatibility |
| [01-code/functions/costMetrics.js](../../../01-code/functions/costMetrics.js) | 612 | 576 | operations alerts/clientDiagnostics/reports/costMonitoring/metricsSources; preserve distinct outputs |
| [01-code/functions/costReporting.js](../../../01-code/functions/costReporting.js) | 735 | 684 | operations alerts/clientDiagnostics/reports/costMonitoring/metricsSources; preserve distinct outputs |
| [01-code/functions/dataIntegrity.js](../../../01-code/functions/dataIntegrity.js) | 207 | 186 | catalog/catalogSchema.js plus legacy compatibility |
| [01-code/functions/feedbackAttachments.js](../../../01-code/functions/feedbackAttachments.js) | 125 | 107 | support/feedbackAttachments.js retained |
| [01-code/functions/ga4Metrics.js](../../../01-code/functions/ga4Metrics.js) | 271 | 249 | operations alerts/clientDiagnostics/reports/costMonitoring/metricsSources; preserve distinct outputs |
| [01-code/functions/healthMonitoring.js](../../../01-code/functions/healthMonitoring.js) | 226 | 206 | operations alerts/clientDiagnostics/reports/costMonitoring/metricsSources; preserve distinct outputs |
| [01-code/functions/index.js](../../../01-code/functions/index.js) | 4,634 | 4,144 | Registry plus extracted user/billing/admin/support/operations handlers; preserve exported contracts |
| [01-code/functions/opsDiscord.js](../../../01-code/functions/opsDiscord.js) | 318 | 278 | operations alerts/clientDiagnostics/reports/costMonitoring/metricsSources; preserve distinct outputs |
| [01-code/functions/opsMetrics.js](../../../01-code/functions/opsMetrics.js) | 393 | 367 | operations alerts/clientDiagnostics/reports/costMonitoring/metricsSources; preserve distinct outputs |
| [01-code/functions/orsEndpoints.js](../../../01-code/functions/orsEndpoints.js) | 18 | 16 | Transitional ORS path only |
| [01-code/functions/orsSafety.js](../../../01-code/functions/orsSafety.js) | 199 | 176 | Transitional ORS path only |
| [01-code/functions/orsTelemetry.js](../../../01-code/functions/orsTelemetry.js) | 122 | 108 | Transitional ORS path only |
| [01-code/functions/rateLimits.js](../../../01-code/functions/rateLimits.js) | 429 | 385 | shared/rateLimits.js retained |
| [01-code/functions/routeRequestStrategy.js](../../../01-code/functions/routeRequestStrategy.js) | 26 | 23 | Transitional ORS path only |
| [01-code/functions/routeResponseCompact.js](../../../01-code/functions/routeResponseCompact.js) | 123 | 110 | Transitional ORS path only |
| [01-code/functions/supportDesk.js](../../../01-code/functions/supportDesk.js) | 752 | 690 | support/supportDesk.js retained |

## Supporting source

| Scope | Files | Physical lines | Nonblank |
|---|---:|---:|---:|
| 01-code/functions/tests | 27 | 10,147 | 9,184 |
| 03-tests | 122 | 29,015 | 25,793 |
| 05-tools | 22 | 3,475 | 3,049 |
| 06-config | 1 | 201 | 172 |

Test counts are files including support/fixtures, not individual test cases. The tools measurement includes current untracked scripts. Preserve unrelated user changes. Root redirect HTML, package/config files, future CI, assets and data are outside the consumer/backend baseline. Existing unchanged tools/admin/legal content cancel when added to both sides; the new catalog trigger is explicitly included in the reduction estimate.

## Data observations

| Repository snapshot | Rows/entries | Bytes |
|---|---:|---:|
| assets/data/bark-fallback-0.142.csv | 393 | 508,049 |
| assets/data/bark-fallback.csv | 374 | 439,331 |
| data/BARK Master List.csv | 345 | 344,734 |
| 02-data/data/data.json | 335 | 174,982 |
| trails.json | 11 | 278,982 |

No live spreadsheet refresh was performed. These counts are repository snapshots, not a claim about the current live count.

## Key source anchors

- firebase.json selects production 0.142; root index.html selects beta 0.145.
- dataService.v143.js:31 defines fallback/snapshot locations. Lines 469-471 define five-/ten-minute polling and one-minute refocus; reconnect recovery only starts with no accepted parks.
- renderEngine.js:117 owns the filter count, separate from cluster bubbles.
- firebaseService.v145.js:933 commits visits atomically; checkinService.v141.js protects pending confirmation journals.
- tripRoutePlan.js:115 owns day continuity/bookends; tripPlannerCore.js begins with the 50-day limit.
- expeditionEngine.js:591 records mileage with pointMiles zero; completion point constant is 1 at line 37.
- barkConfig.js:48 sets a 25 km proximity radius.
- gamificationLogic.js retains achievement map/subcollection migration and physical-site deduplication.
- functions/index.js:3991 begins current exports; 24 public/scheduled/triggered handlers are defined in source.

The application source files in this inventory were not modified.
