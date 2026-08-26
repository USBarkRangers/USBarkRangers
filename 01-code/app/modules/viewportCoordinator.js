/*
 * Viewport coordinator
 *
 * CSS owns the full-screen shell. This module is deliberately limited to one
 * job: when a browser reports a visual viewport that clips the bottom-nav
 * content, publish the smallest visual-only content lift that makes the
 * controls visible. It also owns one narrow WebKit workaround: after an
 * installed app closes Apple's external-site/photo sheet, Safari can leave
 * every existing 100dvh declaration resolved against the sheet's shorter
 * viewport. The coordinator therefore publishes the installed app window's
 * stable height for structural surfaces. No screen dimensions, phone models,
 * or per-device offsets are used.
 */
(function exposeViewportCoordinator(root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root && root.document) {
        root.BARK = root.BARK || {};
        root.BARK.viewportCoordinator = api.install(root);
    }
}(typeof window !== 'undefined' ? window : null, function createViewportCoordinator() {
    'use strict';

    const CONTENT_LIFT_PROPERTY = '--bark-nav-content-lift';
    const IOS_STANDALONE_CLASS = 'bark-ios-standalone-fullscreen';
    const STABLE_SHELL_CLASS = 'bark-stable-standalone-shell';
    const STABLE_SHELL_HEIGHT_PROPERTY = '--bark-standalone-app-height';
    const MAX_LIFT_PX = 260;
    const CONTENT_MARGIN_PX = 3;
    const CHANGE_TOLERANCE_PX = 1;

    function finiteNumber(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function calculateRequiredContentLift(metrics = {}) {
        const currentLift = Math.max(0, finiteNumber(metrics.currentLift));
        if (metrics.suspended) return currentLift;

        const visibleBottom = finiteNumber(metrics.visibleBottom);
        const contentBottom = finiteNumber(metrics.contentBottom);
        const layoutHeight = finiteNumber(metrics.layoutHeight);
        if (visibleBottom <= 0 || contentBottom <= 0 || layoutHeight <= 0) return currentLift;

        const margin = Math.max(0, finiteNumber(metrics.margin, CONTENT_MARGIN_PX));
        const maximumLift = Math.min(
            MAX_LIFT_PX,
            Math.max(0, layoutHeight * 0.35)
        );
        const target = clamp(
            currentLift + contentBottom + margin - visibleBottom,
            0,
            maximumLift
        );

        return Math.abs(target - currentLift) <= CHANGE_TOLERANCE_PX
            ? currentLift
            : Math.ceil(target);
    }

    function isIOSDevice(targetWindow) {
        const navigator = targetWindow.navigator || {};
        return /iPad|iPhone|iPod/i.test(navigator.userAgent || '')
            || (navigator.platform === 'MacIntel' && finiteNumber(navigator.maxTouchPoints) > 1);
    }

    function isStandalone(targetWindow) {
        const mediaStandalone = typeof targetWindow.matchMedia === 'function'
            && targetWindow.matchMedia('(display-mode: standalone)').matches;
        return targetWindow.navigator.standalone === true || mediaStandalone;
    }

    function calculateStandaloneAppHeight(metrics = {}) {
        const candidates = [
            metrics.outerHeight,
            metrics.innerHeight,
            metrics.visualHeight
        ]
            .map(value => finiteNumber(value))
            .filter(value => value >= 240 && value <= 4096);
        return candidates.length ? Math.max(...candidates) : 0;
    }

    function readCurrentLift(targetWindow) {
        const value = targetWindow.getComputedStyle(targetWindow.document.documentElement)
            .getPropertyValue(CONTENT_LIFT_PROPERTY);
        return Math.max(0, finiteNumber(parseFloat(value)));
    }

    function readNavContentBottom(nav) {
        const content = nav.querySelectorAll('.nav-item svg, .nav-item > span');
        let bottom = 0;
        content.forEach((element) => {
            if (element.id === 'planner-badge' && element.offsetParent === null) return;
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) bottom = Math.max(bottom, rect.bottom);
        });

        if (bottom > 0) return bottom;
        const navRect = nav.getBoundingClientRect();
        return navRect.bottom;
    }

    function readMetrics(targetWindow) {
        const document = targetWindow.document;
        const rootElement = document.documentElement;
        const nav = document.getElementById('main-nav');
        if (!nav) return null;

        const visualViewport = targetWindow.visualViewport;
        const layoutHeight = finiteNumber(targetWindow.innerHeight)
            || finiteNumber(rootElement.clientHeight);
        const visualScale = finiteNumber(visualViewport && visualViewport.scale, 1);
        const visualBottom = visualViewport
            ? finiteNumber(visualViewport.offsetTop) + finiteNumber(visualViewport.height, layoutHeight)
            : layoutHeight;
        const visibleBottom = visualScale > 1.05
            ? layoutHeight
            : Math.min(layoutHeight, visualBottom || layoutHeight);
        const suspended = document.body.classList.contains('keyboard-open')
            || document.body.classList.contains('bark-external-handoff-pending');

        return {
            currentLift: readCurrentLift(targetWindow),
            visibleBottom,
            contentBottom: readNavContentBottom(nav),
            layoutHeight,
            suspended,
            visualScale
        };
    }

    function install(targetWindow) {
        const document = targetWindow.document;
        const rootElement = document.documentElement;
        if (isIOSDevice(targetWindow) && isStandalone(targetWindow)) {
            rootElement.classList.add(IOS_STANDALONE_CLASS);
        }

        let generation = 0;
        let shellGeneration = 0;
        let lastReason = 'install';
        const standaloneApp = isStandalone(targetWindow);
        const stableStandaloneShell = standaloneApp && isIOSDevice(targetWindow);

        function refresh(reason = 'manual') {
            const metrics = readMetrics(targetWindow);
            if (!metrics) return { applied: false, reason, lift: 0 };

            const lift = calculateRequiredContentLift(metrics);
            const changed = Math.abs(lift - metrics.currentLift) > CHANGE_TOLERANCE_PX;
            if (changed) {
                rootElement.style.setProperty(CONTENT_LIFT_PROPERTY, `${lift}px`);
            }
            rootElement.dataset.barkNavContentLift = String(lift);
            lastReason = reason;

            targetWindow.dispatchEvent(new targetWindow.CustomEvent('bark:viewport-layout', {
                detail: {
                    reason,
                    lift,
                    changed,
                    visibleBottom: metrics.visibleBottom,
                    contentBottom: metrics.contentBottom,
                    layoutHeight: metrics.layoutHeight
                }
            }));

            return { applied: changed, reason, lift, metrics };
        }

        function schedule(reason = 'scheduled', delays = [0, 120, 420]) {
            const scheduledGeneration = ++generation;
            delays.forEach((delay) => {
                targetWindow.setTimeout(() => {
                    if (scheduledGeneration !== generation) return;
                    targetWindow.requestAnimationFrame(() => {
                        targetWindow.requestAnimationFrame(() => refresh(reason));
                    });
                }, delay);
            });
        }

        function refreshStandaloneShell(reason = 'manual-shell-refresh') {
            if (!stableStandaloneShell) return { applied: false, reason };

            const visualViewport = targetWindow.visualViewport;
            const height = calculateStandaloneAppHeight({
                outerHeight: targetWindow.outerHeight,
                innerHeight: targetWindow.innerHeight,
                visualHeight: visualViewport && visualViewport.height
            });
            if (!height) return { applied: false, reason };

            const value = `${Math.round(height * 100) / 100}px`;
            const previousValue = rootElement.style.getPropertyValue(STABLE_SHELL_HEIGHT_PROPERTY);
            rootElement.style.setProperty(STABLE_SHELL_HEIGHT_PROPERTY, value);
            rootElement.classList.add(STABLE_SHELL_CLASS);

            // Commit the stable body before Leaflet receives its next size pass.
            void rootElement.offsetHeight;
            rootElement.dataset.barkStandaloneAppHeight = value;
            return {
                applied: value !== previousValue,
                reason,
                height,
                value
            };
        }

        function scheduleShellRecovery(reason = 'shell-recovery', delays = [0, 120, 480, 1200]) {
            if (!stableStandaloneShell) return false;
            const scheduledGeneration = ++shellGeneration;
            delays.forEach((delay) => {
                targetWindow.setTimeout(() => {
                    if (scheduledGeneration !== shellGeneration) return;
                    targetWindow.requestAnimationFrame(() => {
                        refreshStandaloneShell(reason);
                        refresh(reason);
                    });
                }, delay);
            });
            return true;
        }

        function settleExternalReturn() {
            scheduleShellRecovery('external-return-settled');
            schedule('external-return', [0, 120, 420]);
        }

        let viewportFrame = 0;
        let viewportReason = 'visual-viewport';
        function scheduleViewportRefresh(reason) {
            viewportReason = reason || viewportReason;
            if (viewportFrame) return;
            viewportFrame = targetWindow.requestAnimationFrame(() => {
                viewportFrame = 0;
                refresh(viewportReason);
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                refreshStandaloneShell('dom-ready');
                schedule('dom-ready');
            }, { once: true });
        } else {
            refreshStandaloneShell('ready');
            schedule('ready');
        }

        targetWindow.addEventListener('load', () => schedule('load', [0, 120]), { once: true });
        targetWindow.addEventListener('orientationchange', () => {
            scheduleShellRecovery('orientation', [0, 120, 420]);
            schedule('orientation', [120, 420]);
        });
        targetWindow.addEventListener('resize', () => {
            if (stableStandaloneShell) scheduleShellRecovery('window-resize', [0, 120]);
            scheduleViewportRefresh('window-resize');
        });
        if (targetWindow.visualViewport
            && typeof targetWindow.visualViewport.addEventListener === 'function') {
            targetWindow.visualViewport.addEventListener('resize', () => {
                scheduleViewportRefresh('visual-viewport-resize');
            });
            targetWindow.visualViewport.addEventListener('scroll', () => {
                scheduleViewportRefresh('visual-viewport-scroll');
            });
        }
        targetWindow.addEventListener('pageshow', (event) => {
            if (!event.persisted && lastReason === 'load') return;
            if (document.body.classList.contains('bark-external-handoff-pending')) {
                scheduleShellRecovery('external-pageshow');
            }
            schedule('pageshow', [0, 120]);
        });
        targetWindow.addEventListener('focus', () => {
            if (document.body.classList.contains('bark-external-handoff-pending')) {
                scheduleShellRecovery('external-focus');
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && document.body.classList.contains('bark-external-handoff-pending')) {
                scheduleShellRecovery('external-visibility');
            }
        });
        targetWindow.addEventListener('bark:external-return-started', () => {
            scheduleShellRecovery('external-return-started');
        });
        targetWindow.addEventListener('bark:external-return-settled', settleExternalReturn);

        return Object.freeze({
            refresh,
            schedule,
            refreshStandaloneShell,
            scheduleShellRecovery,
            readMetrics: () => readMetrics(targetWindow)
        });
    }

    return Object.freeze({
        CONTENT_LIFT_PROPERTY,
        IOS_STANDALONE_CLASS,
        STABLE_SHELL_CLASS,
        STABLE_SHELL_HEIGHT_PROPERTY,
        calculateStandaloneAppHeight,
        calculateRequiredContentLift,
        install
    });
}));
