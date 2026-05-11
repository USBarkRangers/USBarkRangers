/**
 * authPremiumUi.js - Premium control gating for entitlement state changes.
 */
window.BARK = window.BARK || {};

(function () {
    const PREMIUM_RUNTIME_DEFAULTS = {
        mapStyle: 'default',
        visitedFilter: 'all'
    };
    const PREMIUM_MAP_STYLES = new Set(['terrain', 'satellite', 'streets']);
    const PREMIUM_VISITED_FILTERS = new Set(['visited', 'unvisited', 'route']);

    function isPremiumActive() {
        if (
            window.BARK &&
            typeof window.BARK.isLaunchFlagEnabled === 'function' &&
            !window.BARK.isLaunchFlagEnabled('premiumRiskyToolsEnabled')
        ) {
            return false;
        }

        const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
        return Boolean(
            premiumService &&
            typeof premiumService.isPremium === 'function' &&
            premiumService.isPremium()
        );
    }

    function getAllowedMapStyle(style) {
        if (!PREMIUM_MAP_STYLES.has(style)) return style || PREMIUM_RUNTIME_DEFAULTS.mapStyle;
        return isPremiumActive() ? style : PREMIUM_RUNTIME_DEFAULTS.mapStyle;
    }

    function getAllowedVisitedFilter(filter) {
        if (!PREMIUM_VISITED_FILTERS.has(filter)) return filter || PREMIUM_RUNTIME_DEFAULTS.visitedFilter;
        return isPremiumActive() ? filter : PREMIUM_RUNTIME_DEFAULTS.visitedFilter;
    }

    function openPremiumPrompt(source) {
        const paywall = window.BARK && window.BARK.paywall;
        if (paywall && typeof paywall.openPaywall === 'function') {
            paywall.openPaywall({ source });
        }
    }

    function persistLocalValue(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (error) {
            console.error(`[authService] failed to persist premium runtime default "${key}":`, error);
        }
    }

    function setPremiumClusteringDefault() {
        const settings = window.BARK && window.BARK.settings;
        if (settings && typeof settings.set === 'function') {
            settings.set('premiumClusteringEnabled', false);
            return;
        }

        window.premiumClusteringEnabled = false;
        persistLocalValue('barkPremiumClustering', 'false');
    }

    function applyNonPremiumRuntimeDefaults() {
        window.BARK.visitedFilterState = PREMIUM_RUNTIME_DEFAULTS.visitedFilter;
        persistLocalValue('barkVisitedFilter', PREMIUM_RUNTIME_DEFAULTS.visitedFilter);
        persistLocalValue('barkMapStyle', PREMIUM_RUNTIME_DEFAULTS.mapStyle);
        setPremiumClusteringDefault();

        if (typeof window.BARK.loadLayer === 'function') {
            window.BARK.loadLayer(PREMIUM_RUNTIME_DEFAULTS.mapStyle);
        }
        if (typeof window.BARK.syncSettingsControls === 'function') {
            window.BARK.syncSettingsControls();
        }
        if (typeof window.syncState === 'function') {
            window.syncState();
        }
    }

    function setTrailButtonState(buttons, isUnlocked) {
        buttons.forEach(btn => {
            if (isUnlocked) {
                btn.disabled = false;
                btn.setAttribute('aria-disabled', 'false');
            } else {
                btn.classList.remove('active');
                btn.disabled = true;
                btn.setAttribute('aria-disabled', 'true');
            }
        });
    }

    function applyPremiumGating(isPremium, options = {}) {
        try {
            const riskyToolsEnabled = !window.BARK ||
                typeof window.BARK.isLaunchFlagEnabled !== 'function' ||
                window.BARK.isLaunchFlagEnabled('premiumRiskyToolsEnabled');
            const effectivePremium = isPremium === true && riskyToolsEnabled;
            const premiumWrap = document.getElementById('premium-filters-wrap');
            const visitedSelect = document.getElementById('visited-filter');
            const mapStyleSelectF = document.getElementById('map-style-select');
            const trailButtons = [
                document.getElementById('toggle-virtual-trail'),
                document.getElementById('toggle-completed-trails')
            ].filter(Boolean);
            const trailsUnlocked = effectivePremium && (options.trailsUnlocked === undefined ? true : options.trailsUnlocked === true);

            if (premiumWrap) {
                if (effectivePremium) {
                    premiumWrap.classList.remove('premium-locked');
                    premiumWrap.classList.add('premium-unlocked');
                    if (visitedSelect) visitedSelect.disabled = false;
                    if (mapStyleSelectF) mapStyleSelectF.disabled = false;
                } else {
                    premiumWrap.classList.add('premium-locked');
                    premiumWrap.classList.remove('premium-unlocked');
                    if (visitedSelect) { visitedSelect.disabled = true; visitedSelect.value = 'all'; }
                    if (mapStyleSelectF) { mapStyleSelectF.disabled = true; mapStyleSelectF.value = 'default'; }
                }
            }

            setTrailButtonState(trailButtons, trailsUnlocked);
            if (
                premiumWrap &&
                window.BARK &&
                typeof window.BARK.isLaunchFlagEnabled === 'function' &&
                !riskyToolsEnabled
            ) {
                premiumWrap.title = window.BARK.getLaunchFlagMessage('premiumRiskyToolsEnabled');
            }
            if (!effectivePremium && options.sanitizePremiumState === true) {
                applyNonPremiumRuntimeDefaults();
            }
        } catch (error) {
            console.error("[authService] premium gating failed:", error);
        }
    }

    window.BARK.authPremiumUi = {
        applyPremiumGating,
        getAllowedMapStyle,
        getAllowedVisitedFilter,
        isPremiumActive,
        openPremiumPrompt
    };
})();
