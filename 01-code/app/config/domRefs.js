/**
 * domRefs.js - Centralized DOM lookup registry.
 * Values are functions so deferred modules always fetch the live element.
 */
(function () {
    window.BARK = window.BARK || {};

    const byId = (id) => () => document.getElementById(id);
    const dismissableOverlays = [];
    let escapeDismissBound = false;

    function isOverlayActive(entry) {
        const overlay = entry.overlay;
        if (typeof entry.isActive === 'function') return entry.isActive(overlay);
        if (overlay.classList.contains('active')) return true;
        if (overlay.getAttribute('aria-hidden') === 'false') return true;
        return overlay.style.display === 'flex';
    }

    function getOverlayZIndex(entry, index) {
        const rawZIndex = window.getComputedStyle(entry.overlay).zIndex;
        const parsedZIndex = Number.parseInt(rawZIndex, 10);
        return Number.isFinite(parsedZIndex) ? parsedZIndex : index;
    }

    function ensureEscapeDismiss() {
        if (escapeDismissBound) return;
        escapeDismissBound = true;

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;

            const activeEntries = dismissableOverlays
                .filter(entry => entry.closeOnEscape !== false && isOverlayActive(entry));
            if (activeEntries.length === 0) return;

            const topEntry = activeEntries.reduce((top, entry) => {
                const topIndex = dismissableOverlays.indexOf(top);
                const entryIndex = dismissableOverlays.indexOf(entry);
                const topZIndex = getOverlayZIndex(top, topIndex);
                const entryZIndex = getOverlayZIndex(entry, entryIndex);
                return entryZIndex >= topZIndex ? entry : top;
            });

            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }
            topEntry.onDismiss(event);
        }, true);
    }

    function bindDismissableOverlay(options) {
        const overlay = typeof options.overlay === 'string'
            ? document.getElementById(options.overlay)
            : options.overlay;
        const onDismiss = options.onDismiss;
        if (!overlay || typeof onDismiss !== 'function') return;

        const boundKey = options.boundKey || 'barkDismissBound';
        if (overlay.dataset[boundKey] === 'true') return;
        overlay.dataset[boundKey] = 'true';

        const entry = {
            overlay,
            onDismiss,
            closeOnEscape: options.closeOnEscape,
            isActive: options.isActive
        };
        dismissableOverlays.push(entry);
        ensureEscapeDismiss();

        const getSurface = () => {
            if (options.surface && typeof options.surface !== 'string') return options.surface;
            return options.surface ? overlay.querySelector(options.surface) : overlay.firstElementChild;
        };
        const isInsideSurface = (target) => {
            const surface = getSurface();
            return Boolean(surface && target && surface.contains(target));
        };

        let pointerStartedOutside = false;

        document.addEventListener('pointerdown', (event) => {
            if (!isOverlayActive(entry)) return;
            pointerStartedOutside = !isInsideSurface(event.target);
        }, true);

        document.addEventListener('click', (event) => {
            if (!isOverlayActive(entry)) return;
            const clickedOutside = !isInsideSurface(event.target);
            if (!pointerStartedOutside && !clickedOutside) return;
            pointerStartedOutside = false;
            if (!clickedOutside) return;
            event.preventDefault();
            event.stopPropagation();
            onDismiss(event);
        }, true);
    }

    window.BARK.DOM = {
        byId,
        bindDismissableOverlay,

        map: byId('map'),
        barkLoader: byId('bark-loader'),
        updateToast: byId('update-toast'),
        refreshBtn: byId('refresh-btn'),

        filterPanel: byId('filter-panel'),
        filterContent: byId('filter-content'),
        toggleFilterBtn: byId('toggle-filter-btn'),
        parkSearch: byId('park-search'),
        clearSearchBtn: byId('clear-search-btn'),
        searchSuggestions: byId('search-suggestions'),
        typeFilter: byId('type-filter'),
        visitedFilter: byId('visited-filter'),
        mapStyleSelect: byId('map-style-select'),
        premiumFiltersWrap: byId('premium-filters-wrap'),
        toggleVirtualTrail: byId('toggle-virtual-trail'),
        toggleCompletedTrails: byId('toggle-completed-trails'),

        slidePanel: byId('slide-panel'),
        closeSlidePanel: byId('close-slide-panel'),
        panelTitle: byId('panel-title'),
        panelVisitedSection: byId('panel-visited-section'),
        verifyCheckinBtn: byId('verify-checkin-btn'),
        markVisitedBtn: byId('mark-visited-btn'),
        markVisitedText: byId('mark-visited-text'),
        panelMetaContainer: byId('panel-meta-container'),
        panelInfoSection: byId('panel-info-section'),
        panelInfoContainer: byId('panel-info-container'),
        panelInfo: byId('panel-info'),
        websitesContainer: byId('websites-container'),
        panelPics: byId('panel-pics'),
        panelVideo: byId('panel-video'),
        panelStickyFooter: byId('panel-sticky-footer'),

        settingsGearBtn: byId('settings-gear-btn'),
        settingsOverlay: byId('settings-overlay'),
        closeSettingsBtn: byId('close-settings-btn'),
        allowUncheckSetting: byId('allow-uncheck-setting'),
        standardClusterToggle: byId('standard-cluster-toggle'),
        premiumClusterToggle: byId('premium-cluster-toggle'),
        lowGfxToggle: byId('low-gfx-toggle'),
        simplifyTrailToggle: byId('simplify-trail-toggle'),
        instantNavToggle: byId('instant-nav-toggle'),
        rememberMapToggle: byId('remember-map-toggle'),
        reduceMotionToggle: byId('reduce-motion-toggle'),
        ultraLowToggle: byId('ultra-low-toggle'),
        settingsAppVersion: byId('settings-app-version'),
        toggleRemoveShadows: byId('toggle-remove-shadows'),
        toggleStopResizing: byId('toggle-stop-resizing'),
        toggleViewportCulling: byId('toggle-viewport-culling'),
        toggleDisableDoubleTap: byId('toggle-disable-double-tap'),
        toggleDisablePinch: byId('toggle-disable-pinch'),
        toggleDisable1Finger: byId('toggle-disable-1finger'),
        toggleLockMapPanning: byId('toggle-lock-map-panning'),
        nationalViewToggle: byId('national-view-toggle'),
        toggleStopAutoMove: byId('toggle-stop-auto-move'),
        terminateReloadBtn: byId('terminate-reload-btn'),
        saveSettingsCloudBtn: byId('save-settings-cloud-btn'),

        tripActionToast: byId('trip-action-toast'),
        optimizerModal: byId('optimizer-modal'),
        optMaxStops: byId('opt-max-stops'),
        optMaxHours: byId('opt-max-hours'),
        plannerBadge: byId('planner-badge'),
        tripQueueList: byId('trip-queue-list'),
        tripDayTabs: byId('trip-day-tabs'),
        uiStartNode: byId('ui-start-node'),
        uiEndNode: byId('ui-end-node'),
        itineraryTimelineWrapper: byId('itinerary-timeline-wrapper'),
        dayManagementBar: byId('day-management-bar'),
        dayNotesContainer: byId('day-notes-container'),
        dayNotesTextarea: byId('day-notes-textarea'),
        charCount: byId('char-count'),
        clearTripBtn: byId('clear-trip-btn'),
        startRouteBtn: byId('start-route-btn'),
        saveRouteBtn: byId('save-route-btn'),
        optimizeTripBtn: byId('optimize-trip-btn'),
        tripNameInput: byId('tripNameInput'),
        routeTelemetry: byId('route-telemetry'),
        plannerSavedRoutesContainer: byId('planner-saved-routes-container'),
        plannerSavedRoutesList: byId('planner-saved-routes-list'),
        savedRoutesList: byId('saved-routes-list'),
        savedRoutesCount: byId('saved-routes-count'),

        loginContainer: byId('login-container'),
        offlineStatusContainer: byId('offline-status-container'),
        userProfileName: byId('user-profile-name'),
        adminControlsContainer: byId('admin-controls-container'),
        devWarpContainer: byId('dev-warp-container'),
        devTrailWarpGrid: byId('dev-trail-warp-grid'),

        expeditionIntroState: byId('expedition-intro-state'),
        expeditionActiveState: byId('expedition-active-state'),
        expeditionCompleteState: byId('expedition-complete-state'),
        expeditionName: byId('expedition-name'),
        celebrationTrailName: byId('celebration-trail-name'),
        claimRewardBtn: byId('claim-reward-btn'),
        expeditionFill: byId('expedition-fill'),
        expeditionProgressText: byId('expedition-progress-text'),
        lifetimeMilesDisplay: byId('lifetime-miles-display'),

        inlineInput: (type) => document.getElementById(`inline-${type}-input`),
        inlineSuggest: (type) => document.getElementById(`inline-suggest-${type}`),
        tabContent: (tabName) => document.getElementById(`${tabName}-content`)
    };
})();
