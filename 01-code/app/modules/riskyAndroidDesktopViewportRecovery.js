/*
 * RISKY BETA EXPERIMENT: Android standalone PWA desktop-viewport recovery.
 *
 * WHY THIS EXISTS
 * Chrome can launch an installed Android PWA with its forced desktop viewport
 * (normally about 980 CSS px). On a tall phone that shrinks the entire BARK UI,
 * activates desktop breakpoints, and makes every label look tiny. Standalone
 * PWAs do not expose Chrome's normal "Desktop site" menu to the user.
 *
 * WHY THIS IS NAMED RISKY
 * Web pages cannot switch Chrome's desktop-site preference off. This code uses
 * a deliberately narrow device-shape heuristic and CSS zoom to recreate a
 * phone-sized logical viewport inside Chrome's 980px viewport. CSS zoom can
 * affect fixed overlays, Leaflet sizing, keyboards, and future layout work.
 *
 * IF THIS CAUSES A PROBLEM
 * Set ENABLE_RISKY_ANDROID_DESKTOP_VIEWPORT_RECOVERY to false, or revert this
 * file plus its matching CSS/index/test changes. The emergency URL escape hatch
 * `?barkDisableRiskyPhoneRecovery=1` disables it for one page load.
 */
(function exposeRiskyAndroidDesktopViewportRecovery(root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root && root.document) {
        root.BARK_RISKY_ANDROID_DESKTOP_VIEWPORT_RECOVERY = api;
        api.install(root);
    }
}(typeof window !== 'undefined' ? window : null, function createRecoveryApi() {
    'use strict';

    // BETA KILL SWITCH: change only this line to false to stop the experiment.
    const ENABLE_RISKY_ANDROID_DESKTOP_VIEWPORT_RECOVERY = true;
    const RECOVERY_CLASS = 'bark-risky-android-desktop-phone-recovery';
    const DISABLE_QUERY_KEY = 'barkDisableRiskyPhoneRecovery';
    const DEFAULT_PHONE_WIDTH = 430;

    function finiteNumber(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getRecoveryDecision(metrics = {}) {
        const viewportWidth = finiteNumber(metrics.viewportWidth);
        const viewportHeight = finiteNumber(metrics.viewportHeight);
        const screenWidth = finiteNumber(metrics.screenWidth);
        const visualScale = finiteNumber(metrics.visualScale, 1);
        const isStandalone = Boolean(metrics.isStandalone);
        const hasCoarseTouch = Boolean(metrics.hasCoarseTouch);
        const isDisabled = Boolean(metrics.isDisabled);
        const aspectRatio = viewportWidth > 0 ? viewportHeight / viewportWidth : 0;

        // The narrow gate is intentional. The fallback branch catches Chrome
        // builds that hide both real screen.width and visualViewport.scale while
        // still exposing the unmistakable 980px/tall/touch/standalone shape.
        const desktopViewportWidth = viewportWidth >= 900 && viewportWidth <= 1100;
        const tallPortraitPhoneShape = aspectRatio >= 1.65;
        const screenReportsPhoneWidth = screenWidth >= 280 && screenWidth <= 600;
        const visualViewportReportsShrink = visualScale >= 0.25
            && visualScale <= 0.75
            && viewportWidth * visualScale >= 280
            && viewportWidth * visualScale <= 600;
        const exactChromeDesktopFallback = viewportWidth >= 950 && viewportWidth <= 1010;

        const shouldRecover = ENABLE_RISKY_ANDROID_DESKTOP_VIEWPORT_RECOVERY
            && !isDisabled
            && isStandalone
            && hasCoarseTouch
            && desktopViewportWidth
            && tallPortraitPhoneShape
            && (screenReportsPhoneWidth
                || visualViewportReportsShrink
                || exactChromeDesktopFallback);

        if (!shouldRecover) {
            return {
                active: false,
                viewportWidth,
                viewportHeight,
                screenWidth,
                visualScale,
                aspectRatio
            };
        }

        let logicalWidth = DEFAULT_PHONE_WIDTH;
        if (screenReportsPhoneWidth) {
            logicalWidth = screenWidth;
        } else if (visualViewportReportsShrink) {
            logicalWidth = viewportWidth * visualScale;
        }

        logicalWidth = clamp(logicalWidth, 320, 520);
        const zoom = clamp(viewportWidth / logicalWidth, 1.5, 3.25);
        const logicalHeight = Math.max(480, viewportHeight / zoom);

        return {
            active: true,
            viewportWidth,
            viewportHeight,
            screenWidth,
            visualScale,
            aspectRatio,
            logicalWidth,
            logicalHeight,
            zoom
        };
    }

    function readWindowMetrics(targetWindow) {
        const media = typeof targetWindow.matchMedia === 'function'
            ? targetWindow.matchMedia.bind(targetWindow)
            : () => ({ matches: false });
        const visualViewport = targetWindow.visualViewport;
        const viewportWidth = finiteNumber(targetWindow.innerWidth)
            || finiteNumber(targetWindow.document.documentElement.clientWidth);
        const viewportHeight = finiteNumber(visualViewport && visualViewport.height)
            || finiteNumber(targetWindow.innerHeight)
            || finiteNumber(targetWindow.document.documentElement.clientHeight);
        let isDisabled = false;

        try {
            const params = new URLSearchParams(targetWindow.location.search || '');
            isDisabled = params.get(DISABLE_QUERY_KEY) === '1';
        } catch (_) {
            // A malformed or unavailable URL must never break app startup.
        }

        return {
            viewportWidth,
            viewportHeight,
            screenWidth: finiteNumber(targetWindow.screen && targetWindow.screen.width),
            visualScale: finiteNumber(visualViewport && visualViewport.scale, 1),
            isStandalone: media('(display-mode: standalone)').matches
                || targetWindow.navigator.standalone === true,
            hasCoarseTouch: media('(pointer: coarse)').matches
                || finiteNumber(targetWindow.navigator.maxTouchPoints) > 0,
            isDisabled
        };
    }

    function clearRecovery(targetWindow) {
        const rootElement = targetWindow.document.documentElement;
        rootElement.classList.remove(RECOVERY_CLASS);
        delete rootElement.dataset.barkRiskyPhoneRecovery;
        [
            '--bark-risky-phone-width',
            '--bark-risky-phone-height',
            '--bark-risky-phone-zoom',
            '--bark-risky-filter-max-height',
            '--bark-risky-image-max-height'
        ].forEach((property) => rootElement.style.removeProperty(property));
    }

    function applyRecovery(targetWindow, decision) {
        const rootElement = targetWindow.document.documentElement;
        rootElement.classList.add(RECOVERY_CLASS);
        rootElement.dataset.barkRiskyPhoneRecovery = 'active';
        rootElement.style.setProperty('--bark-risky-phone-width', `${decision.logicalWidth}px`);
        rootElement.style.setProperty('--bark-risky-phone-height', `${decision.logicalHeight}px`);
        rootElement.style.setProperty('--bark-risky-phone-zoom', String(decision.zoom));
        rootElement.style.setProperty(
            '--bark-risky-filter-max-height',
            `${Math.max(320, decision.logicalHeight - 120)}px`
        );
        rootElement.style.setProperty(
            '--bark-risky-image-max-height',
            `${Math.max(180, decision.logicalHeight * 0.42)}px`
        );
    }

    function install(targetWindow) {
        if (!ENABLE_RISKY_ANDROID_DESKTOP_VIEWPORT_RECOVERY || !targetWindow.document) {
            return { refresh: () => ({ active: false }) };
        }

        let frame = null;
        let warned = false;

        const refresh = () => {
            frame = null;
            const decision = getRecoveryDecision(readWindowMetrics(targetWindow));

            if (decision.active) {
                applyRecovery(targetWindow, decision);
                if (!warned && targetWindow.console && typeof targetWindow.console.warn === 'function') {
                    warned = true;
                    targetWindow.console.warn(
                        '[BARK][RISKY PHONE RECOVERY] Replacing Chrome\'s desktop-sized PWA viewport.',
                        decision
                    );
                }
            } else {
                clearRecovery(targetWindow);
            }

            if (targetWindow.map && typeof targetWindow.map.invalidateSize === 'function') {
                targetWindow.setTimeout(() => targetWindow.map.invalidateSize({ pan: false }), 0);
            }

            return decision;
        };

        const scheduleRefresh = () => {
            if (frame !== null) return;
            frame = targetWindow.requestAnimationFrame(refresh);
        };

        refresh();
        targetWindow.addEventListener('resize', scheduleRefresh, { passive: true });
        targetWindow.addEventListener('orientationchange', scheduleRefresh, { passive: true });
        if (targetWindow.visualViewport) {
            targetWindow.visualViewport.addEventListener('resize', scheduleRefresh, { passive: true });
        }

        return { refresh, scheduleRefresh };
    }

    return Object.freeze({
        ENABLE_RISKY_ANDROID_DESKTOP_VIEWPORT_RECOVERY,
        RECOVERY_CLASS,
        getRecoveryDecision,
        install
    });
}));
