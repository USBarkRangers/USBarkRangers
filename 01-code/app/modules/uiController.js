/**
 * uiController.js — Navigation, Slide Panel, Filter Panel, Modals, iOS Fixes
 * Loaded TWELFTH in the boot sequence.
 */
window.BARK = window.BARK || {};

function isBarkTextEntryElement(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;

    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['email', 'number', 'password', 'search', 'tel', 'text', 'url'].includes(type);
}

function isBarkKeyboardViewportOpen({ baselineHeight, viewportHeight, screenHeight, activeElement }) {
    if (!isBarkTextEntryElement(activeElement)) return false;
    const shrinkThreshold = Math.max(120, Number(screenHeight) * 0.2);
    return (Number(baselineHeight) - Number(viewportHeight)) > shrinkThreshold;
}

window.BARK.keyboardViewportGuard = Object.freeze({
    isTextEntryElement: isBarkTextEntryElement,
    isKeyboardViewportOpen: isBarkKeyboardViewportOpen
});

function isBarkExternalHandoffDestination({ href, target, currentHref }) {
    if (typeof href !== 'string' || !href.trim() || href.trim().startsWith('#')) return false;

    try {
        const currentUrl = new URL(currentHref);
        const destinationUrl = new URL(href, currentUrl);
        const protocol = destinationUrl.protocol.toLowerCase();
        if (['mailto:', 'sms:', 'tel:'].includes(protocol)) return true;
        if (protocol !== 'http:' && protocol !== 'https:') return false;
        return String(target || '').toLowerCase() === '_blank' || destinationUrl.origin !== currentUrl.origin;
    } catch (error) {
        return false;
    }
}

function shouldUseBarkIOSSameContextHandoff({ href, currentHref, isIOS, isStandalone }) {
    if (!isIOS || !isStandalone || typeof href !== 'string' || !href.trim()) return false;

    try {
        const currentUrl = new URL(currentHref);
        const destinationUrl = new URL(href, currentUrl);
        const protocol = destinationUrl.protocol.toLowerCase();
        return (protocol === 'http:' || protocol === 'https:')
            && destinationUrl.origin !== currentUrl.origin;
    } catch (error) {
        return false;
    }
}

function shouldUseBarkLocalExternalHandler({ localAction, hasClickHandler, hasFeedbackHandler }) {
    return localAction === 'feedback'
        && hasClickHandler === true
        && hasFeedbackHandler === true;
}

window.BARK.externalHandoffGuard = Object.freeze({
    isExternalHandoffDestination: isBarkExternalHandoffDestination,
    shouldUseIOSSameContextHandoff: shouldUseBarkIOSSameContextHandoff,
    shouldUseLocalExternalHandler: shouldUseBarkLocalExternalHandler
});

function shouldActivateBarkNavPointer({
    pointerType,
    isPrimary,
    button,
    startX,
    startY,
    endX,
    endY
}) {
    if (isPrimary === false) return false;
    if (Number.isFinite(Number(button)) && Number(button) !== 0) return false;
    if (!['mouse', 'pen', 'touch'].includes(String(pointerType || '').toLowerCase())) return false;

    const deltaX = Number(endX) - Number(startX);
    const deltaY = Number(endY) - Number(startY);
    if (![deltaX, deltaY].every(Number.isFinite)) return false;
    return Math.hypot(deltaX, deltaY) <= 14;
}

window.BARK.navInputGuard = Object.freeze({
    shouldActivatePointer: shouldActivateBarkNavPointer
});

window.BARK.initUI = function initUI() {
let keyboardFocusContext = null;
const EXTERNAL_HANDOFF_PENDING_KEY = 'bark_external_handoff_pending';
const EXTERNAL_HANDOFF_STARTED_KEY = 'bark_external_handoff_started_at';
const EXTERNAL_HANDOFF_CLASS = 'bark-external-handoff-pending';
const EXTERNAL_RETURN_QUARANTINE_MS = 1200;
let externalReturnSettleGeneration = 0;
let externalHandoffPendingInMemory = false;

// ====== iOS SAFARI MAGNIFIER PROTECTION ======
document.addEventListener('contextmenu', function (e) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
});

function isAppTabActive() {
    return Boolean(document.querySelector('.ui-view.active'));
}

function syncAppTabMode() {
    document.body.classList.toggle('app-tab-active', isAppTabActive());
}

function resetSlidePanelShell() {
    const title = document.getElementById('panel-title');
    if (title) title.textContent = '';

    [
        'panel-meta-container',
        'panel-info',
        'websites-container',
        'panel-pics',
        'panel-sticky-footer'
    ].forEach((id) => {
        const element = document.getElementById(id);
        if (!element) return;
        while (element.firstChild) element.removeChild(element.firstChild);
    });

    ['panel-visited-section', 'panel-info-section', 'panel-sticky-footer'].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });

    const showMoreButton = document.getElementById('show-more-info');
    if (showMoreButton) showMoreButton.style.display = 'none';

    const videoLink = document.getElementById('panel-video');
    if (videoLink) {
        videoLink.removeAttribute('href');
        videoLink.style.display = 'none';
    }

    const suggestEditButton = document.getElementById('suggest-edit-btn');
    if (suggestEditButton) {
        suggestEditButton.href = 'mailto:support@usbarkrangersmap.com';
        suggestEditButton.onclick = null;
    }
}

function getUsableActivePinMarker() {
    const marker = window.BARK && window.BARK.activePinMarker;
    const data = marker && marker._parkData;
    const name = data && typeof data.name === 'string' ? data.name.trim() : '';
    if (!data || !name || name === 'Park Name') return null;
    if (!data.id && !Number.isFinite(Number(data.lat)) && !Number.isFinite(Number(data.lng))) return null;
    return marker;
}

function activePinMatchesSlidePanel(marker) {
    const title = document.getElementById('panel-title');
    const data = marker && marker._parkData;
    const name = data && typeof data.name === 'string' ? data.name.trim() : '';
    const titleText = title && typeof title.textContent === 'string' ? title.textContent.trim() : '';
    return Boolean(name && titleText === name);
}

function consumeExternalCheckoutCleanupFlag() {
    try {
        if (sessionStorage.getItem('bark_checkout_external_pending') !== '1') return false;
        sessionStorage.removeItem('bark_checkout_external_pending');
        sessionStorage.removeItem('bark_checkout_external_started_at');
        return true;
    } catch (error) {
        return false;
    }
}

function markExternalHandoffPending() {
    externalHandoffPendingInMemory = true;
    try {
        sessionStorage.setItem(EXTERNAL_HANDOFF_PENDING_KEY, '1');
        sessionStorage.setItem(EXTERNAL_HANDOFF_STARTED_KEY, String(Date.now()));
    } catch (error) {
        // Best-effort only. Storage restrictions must never block an external action.
    }
}

function consumeExternalHandoffCleanupFlag() {
    let pending = false;
    try {
        pending = sessionStorage.getItem(EXTERNAL_HANDOFF_PENDING_KEY) === '1';
        sessionStorage.removeItem(EXTERNAL_HANDOFF_PENDING_KEY);
        sessionStorage.removeItem(EXTERNAL_HANDOFF_STARTED_KEY);
    } catch (error) {
        // The body class is a storage-independent fallback for the same page instance.
    }
    const pendingInMemory = externalHandoffPendingInMemory;
    const checkoutPending = consumeExternalCheckoutCleanupFlag();
    externalHandoffPendingInMemory = false;
    return pending || pendingInMemory || checkoutPending;
}

function closeMapOnlySurfaces(options = {}) {
    const panel = document.getElementById('slide-panel');
    if (panel) {
        panel.classList.remove('open');
        if (options.resetPanel !== false) resetSlidePanelShell();
    }
    if (options.clearActivePin !== false && window.BARK && typeof window.BARK.clearActivePin === 'function') {
        window.BARK.clearActivePin();
    }
}

function closeStaleSlidePanel(reason) {
    void reason;
    const panel = document.getElementById('slide-panel');
    if (!panel || !panel.classList.contains('open')) return;
    const activeMarker = getUsableActivePinMarker();
    if (activeMarker && activePinMatchesSlidePanel(activeMarker)) return;
    closeMapOnlySurfaces({ clearActivePin: true, resetPanel: true });
}

window.BARK.closeMapOnlySurfaces = closeMapOnlySurfaces;

function prepareExternalHandoff(details = {}) {
    const pinReturn = window.BARK && window.BARK.externalPinReturn;
    if (pinReturn && typeof pinReturn.capture === 'function') {
        pinReturn.capture(details);
    }
    markExternalHandoffPending();
    document.body.classList.add(EXTERNAL_HANDOFF_CLASS);
    document.body.classList.remove('keyboard-open');
    closeMapOnlySurfaces({ clearActivePin: true, resetPanel: true });

    // Commit the hidden state before iOS snapshots the app underneath its Safari
    // overlay. Without this read WebKit can preserve the previous composited layer.
    const panel = document.getElementById('slide-panel');
    if (panel) void panel.offsetHeight;
}

function isIOSStandaloneApp() {
    const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || '')
        || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1);
    const isStandalone = navigator.standalone === true
        || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
    return { isIOS, isStandalone };
}

function shouldUseSameContextForExternalWebsite(href) {
    const environment = isIOSStandaloneApp();
    return shouldUseBarkIOSSameContextHandoff({
        href,
        currentHref: window.location.href,
        isIOS: environment.isIOS,
        isStandalone: environment.isStandalone
    });
}

function openExternalWebsite(destination, details = {}) {
    let safeDestination;
    try {
        safeDestination = new URL(destination, window.location.href);
    } catch (error) {
        return false;
    }

    if (!['http:', 'https:'].includes(safeDestination.protocol.toLowerCase())) return false;

    prepareExternalHandoff({ ...details, destination: safeDestination.href });
    if (shouldUseSameContextForExternalWebsite(safeDestination.href)) {
        // In an installed iPhone web app, this still opens Apple's external
        // Safari sheet. Unlike target=_blank, its X returns to this exact live
        // document instead of cold-loading the app again.
        window.location.assign(safeDestination.href);
        return true;
    }

    window.open(safeDestination.href, '_blank', 'noopener,noreferrer');
    return true;
}

function settleExternalReturnViewport(reason) {
    const generation = ++externalReturnSettleGeneration;
    closeMapOnlySurfaces({ clearActivePin: true, resetPanel: true });
    document.body.classList.remove('keyboard-open');
    window.dispatchEvent(new CustomEvent('bark:external-return-started', {
        detail: { reason: reason || 'external-return' }
    }));

    const settle = () => {
        if (generation !== externalReturnSettleGeneration) return;
        // Only repair viewport/compositor state here. A user can return from
        // Safari and open a new pin before these delayed passes run; clearing
        // map surfaces again would erase that brand-new card as stale state.
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        if (window.map && typeof window.map.invalidateSize === 'function') {
            window.map.invalidateSize({ pan: false });
        }
        if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
            window.BARK.invalidateMarkerVisibility();
        }
    };

    requestAnimationFrame(() => requestAnimationFrame(settle));
    setTimeout(settle, 480);
    setTimeout(() => {
        if (generation !== externalReturnSettleGeneration) return;
        settle();
        document.body.classList.remove(EXTERNAL_HANDOFF_CLASS);
        // Force WebKit to build a fresh fixed/composited scene after its Safari
        // overlay has fully finished dismissing. The stale park card is already
        // empty, so even an old snapshot cannot leak a park name or button.
        void document.body.offsetHeight;
        window.dispatchEvent(new CustomEvent('bark:external-return-settled', {
            detail: { reason: reason || 'external-return' }
        }));
    }, EXTERNAL_RETURN_QUARANTINE_MS);
}

function finishExternalReturnForInteraction(reason = 'user-interaction') {
    if (!document.body.classList.contains(EXTERNAL_HANDOFF_CLASS)) return false;

    // A real user interaction takes ownership of the live app. Cancel every
    // delayed Safari-return pass before revealing new UI so it cannot resize
    // the map or keep a newly opened park card quarantined for another second.
    externalReturnSettleGeneration += 1;
    consumeExternalHandoffCleanupFlag();
    document.body.classList.remove(EXTERNAL_HANDOFF_CLASS);
    void document.body.offsetHeight;
    window.dispatchEvent(new CustomEvent('bark:external-return-settled', {
        detail: { reason }
    }));
    return true;
}

function handleAppReturn(reason) {
    if (consumeExternalHandoffCleanupFlag()) {
        settleExternalReturnViewport(reason);
        return;
    }
    closeStaleSlidePanel(reason);
}

window.BARK.prepareExternalHandoff = prepareExternalHandoff;
window.BARK.openExternalWebsite = openExternalWebsite;
window.BARK.finishExternalReturnForInteraction = finishExternalReturnForInteraction;

function settleAppViewportAfterKeyboard() {
    requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;

        const activeView = document.querySelector('.ui-view.active');
        if (!activeView) return;

        const maxScroll = Math.max(0, activeView.scrollHeight - activeView.clientHeight);
        if (keyboardFocusContext && keyboardFocusContext.view === activeView) {
            activeView.scrollTop = Math.min(keyboardFocusContext.scrollTop, maxScroll);
            return;
        }

        if (activeView.scrollTop > maxScroll) activeView.scrollTop = maxScroll;
    });
}

function scheduleAppViewportSettle() {
    settleAppViewportAfterKeyboard();
    setTimeout(settleAppViewportAfterKeyboard, 120);
    setTimeout(settleAppViewportAfterKeyboard, 320);
}

function dismissKeyboardTransientUi() {
    const activeElement = document.activeElement;

    if (typeof window.BARK.suppressInlinePlannerSuggestions === 'function') {
        window.BARK.suppressInlinePlannerSuggestions(700);
    } else if (typeof window.BARK.hideAllInlinePlannerSuggestions === 'function') {
        window.BARK.hideAllInlinePlannerSuggestions();
    }

    if (isBarkTextEntryElement(activeElement) && typeof activeElement.blur === 'function') {
        activeElement.blur();
    }

    if (isAppTabActive()) closeMapOnlySurfaces();
    scheduleAppViewportSettle();
}

// ====== iOS KEYBOARD LAYOUT FIX ======
if (window.visualViewport) {
    let initialHeight = window.visualViewport.height;

    window.visualViewport.addEventListener('resize', () => {
        const viewportHeight = window.visualViewport.height;
        const activeElement = document.activeElement;
        if (!isBarkTextEntryElement(activeElement)) {
            initialHeight = Math.max(initialHeight, viewportHeight);
        }
        const isKeyboardOpen = isBarkKeyboardViewportOpen({
            baselineHeight: initialHeight,
            viewportHeight,
            screenHeight: window.screen.height,
            activeElement
        });
        const wasKeyboardOpen = document.body.classList.contains('keyboard-open');

        if (!isKeyboardOpen && wasKeyboardOpen) {
            dismissKeyboardTransientUi();
        }

        document.body.classList.toggle('keyboard-open', isKeyboardOpen);

        // RISKY BETA viewport recovery keeps Chrome's reported innerWidth near
        // 980px while presenting the app as a phone. Treat it as mobile here so
        // the keyboard cannot leave map-only surfaces covering text inputs.
        const isRecoveredDesktopViewportPhone = document.documentElement.classList
            .contains('bark-risky-android-desktop-phone-recovery');
        if (isKeyboardOpen && (window.innerWidth < 768 || isRecoveredDesktopViewportPhone)) {
            closeMapOnlySurfaces();
        }
    });

    document.addEventListener('focusout', () => {
        setTimeout(() => {
            if (isBarkTextEntryElement(document.activeElement)) return;
            const wasKeyboardOpen = document.body.classList.contains('keyboard-open');
            document.body.classList.remove('keyboard-open');
            initialHeight = Math.max(initialHeight, window.visualViewport.height);
            if (wasKeyboardOpen) scheduleAppViewportSettle();
        }, 0);
    });

    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            if (isBarkTextEntryElement(document.activeElement)) return;
            initialHeight = window.visualViewport.height;
            document.body.classList.remove('keyboard-open');
        }, 500);
    });
}

// ====== DOM ELEMENTS ======
const slidePanel = document.getElementById('slide-panel');
const closeSlideBtn = document.getElementById('close-slide-panel');
const navItems = document.querySelectorAll('.nav-item');
const uiViews = document.querySelectorAll('.ui-view');
const filterPanel = document.getElementById('filter-panel');
const bottomNav = document.querySelector('.glass-nav');
const leafletControls = document.querySelectorAll('.leaflet-control-container');

function findScrollableAncestorWithin(target, root) {
    let el = target;
    while (el && el !== document && root.contains(el)) {
        const style = window.getComputedStyle(el);
        const canScrollY = /(auto|scroll)/.test(style.overflowY || '') &&
            el.scrollHeight > el.clientHeight + 1;
        if (canScrollY) return el;
        el = el.parentElement;
    }
    return null;
}

function canScrollInDirection(el, deltaY) {
    if (!el || !Number.isFinite(deltaY) || Math.abs(deltaY) < 1) return false;
    if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    return el.scrollTop > 1;
}

function bindFixedSurfaceScrollGuard(root) {
    if (!root || root._barkScrollGuardBound) return;
    root._barkScrollGuardBound = true;
    let lastTouchY = null;

    root.addEventListener('touchstart', (event) => {
        lastTouchY = event.touches && event.touches.length === 1
            ? event.touches[0].clientY
            : null;
    }, { passive: true });

    const guardScroll = (event) => {
        let deltaY = event.deltaY || 0;
        if (event.type === 'touchmove') {
            if (!event.touches || event.touches.length !== 1 || lastTouchY === null) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            deltaY = lastTouchY - event.touches[0].clientY;
            lastTouchY = event.touches[0].clientY;
        }

        const scrollable = findScrollableAncestorWithin(event.target, root);
        if (scrollable && canScrollInDirection(scrollable, deltaY)) {
            event.stopPropagation();
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    };

    root.addEventListener('wheel', guardScroll, { passive: false, capture: true });
    root.addEventListener('touchmove', guardScroll, { passive: false, capture: true });
}

if (slidePanel && window.MutationObserver) {
    const slidePanelObserver = new MutationObserver(() => {
        if (isAppTabActive() && slidePanel.classList.contains('open')) {
            slidePanel.classList.remove('open');
        }
    });

    slidePanelObserver.observe(slidePanel, { attributes: true, attributeFilter: ['class'] });
}

document.addEventListener('focusin', (e) => {
    if (!isBarkTextEntryElement(e.target) || !isAppTabActive()) return;
    const activeView = document.querySelector('.ui-view.active');
    keyboardFocusContext = activeView
        ? { view: activeView, scrollTop: activeView.scrollTop }
        : null;
    closeMapOnlySurfaces();
});

document.addEventListener('focusout', (e) => {
    if (!isBarkTextEntryElement(e.target) || !isAppTabActive()) return;
    setTimeout(() => {
        if (isBarkTextEntryElement(document.activeElement)) return;
        scheduleAppViewportSettle();
    }, 120);
}, true);

function initUIEventListeners() {
    const bindClick = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    };
    const bindDisplayModalDismiss = (id, surface) => {
        const modal = document.getElementById(id);
        const bindDismissableOverlay = window.BARK.DOM && window.BARK.DOM.bindDismissableOverlay;
        if (!modal || typeof bindDismissableOverlay !== 'function') return;
        bindDismissableOverlay({
            overlay: modal,
            surface,
            onDismiss: () => { modal.style.display = 'none'; }
        });
    };

    // ====== STATIC INLINE HANDLER REPLACEMENTS ======
    bindClick('auto-sort-day-btn', () => {
        if (typeof window.autoSortDay === 'function') window.autoSortDay();
    });
    bindClick('planner-load-btn', () => {
        if (typeof window.togglePlannerRoutes === 'function') window.togglePlannerRoutes();
    });
    bindClick('planner-routes-close-btn', () => {
        if (typeof window.togglePlannerRoutes === 'function') window.togglePlannerRoutes();
    });
    bindClick('share-single-expedition-btn', () => {
        if (typeof window.shareSingleExpedition === 'function') window.shareSingleExpedition();
    });
    bindClick('claim-reward-btn', () => {
        if (typeof window.claimRewardAndReset === 'function') window.claimRewardAndReset();
    });
    bindClick('fly-active-trail-btn', () => {
        if (typeof window.flyToActiveTrail === 'function') window.flyToActiveTrail();
    });
    bindClick('trail-brief-btn', () => {
        const modal = document.getElementById('trail-education-modal');
        if (modal) modal.style.display = 'flex';
    });
    bindClick('training-action-btn', () => {
        if (typeof window.handleTrainingClick === 'function') window.handleTrainingClick();
    });
    bindClick('cancel-training-btn', () => {
        if (typeof window.cancelTrainingWalk === 'function') window.cancelTrainingWalk();
    });
    bindClick('share-all-expeditions-btn', () => {
        if (typeof window.shareAllExpeditions === 'function') window.shareAllExpeditions();
    });
    bindClick('share-vault-btn', () => {
        if (typeof window.shareVaultCard === 'function') window.shareVaultCard();
    });
    bindClick('optimizer-modal-close-btn', () => {
        const modal = document.getElementById('optimizer-modal');
        if (modal) modal.style.display = 'none';
    });
    bindClick('execute-smart-optimization-btn', () => {
        if (typeof window.executeSmartOptimization === 'function') window.executeSmartOptimization();
    });
    bindClick('trail-education-close-btn', () => {
        const modal = document.getElementById('trail-education-modal');
        if (modal) modal.style.display = 'none';
    });

    bindDisplayModalDismiss('scoring-modal', '.scoring-modal-card');
    bindDisplayModalDismiss('optimizer-modal', '.scoring-modal-card');
    bindDisplayModalDismiss('trail-education-modal', '.scoring-modal-card');
}

initUIEventListeners();
syncAppTabMode();

// ====== PLANNER SCROLL: DISMISS INLINE SUGGESTIONS ======
// When the user scrolls the planner view without selecting a suggestion,
// hide the dropdown. This prevents the dropdown from extending the scroll
// height while the keyboard is open, which causes Safari's position:fixed
// nav bar to glitch.
const plannerViewEl = document.getElementById('planner-view');
if (plannerViewEl) {
    let dismissTimer = null;
    plannerViewEl.addEventListener('scroll', () => {
        clearTimeout(dismissTimer);
        dismissTimer = setTimeout(() => {
            ['start', 'end'].forEach(type => {
                const suggestBox = document.getElementById(`inline-suggest-${type}`);
                if (suggestBox) suggestBox.style.display = 'none';
            });
        }, 80);
    }, { passive: true });
}

// Stop Leaflet from stealing touches on the UI panels
if (slidePanel) {
    L.DomEvent.disableClickPropagation(slidePanel);
    L.DomEvent.disableScrollPropagation(slidePanel);
}
if (filterPanel) {
    L.DomEvent.disableClickPropagation(filterPanel);
    L.DomEvent.disableScrollPropagation(filterPanel);
    bindFixedSurfaceScrollGuard(filterPanel);
}
if (bottomNav) {
    L.DomEvent.disableClickPropagation(bottomNav);
    L.DomEvent.disableScrollPropagation(bottomNav);
}

document.addEventListener('click', (event) => {
    const target = event.target;
    const link = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
    if (!link || !isBarkExternalHandoffDestination({
        href: link.getAttribute('href') || link.href,
        target: link.getAttribute('target') || '',
        currentHref: window.location.href
    })) return;

    // The park edit link is a real mailto fallback, but normally its target
    // handler opens the in-app feedback dialog. Let that handler run instead of
    // clearing it during capture; if the feedback module failed to initialize,
    // the ordinary external-handoff cleanup and email fallback still apply.
    if (shouldUseBarkLocalExternalHandler({
        localAction: link.dataset ? link.dataset.barkLocalAction : '',
        hasClickHandler: typeof link.onclick === 'function',
        hasFeedbackHandler: Boolean(window.BARK.feedback && typeof window.BARK.feedback.open === 'function')
    })) return;

    const handoffDetails = {
        destination: link.href,
        source: 'link',
        preservePinPopup: Boolean(link.closest('#slide-panel'))
    };

    if (!event.defaultPrevented
        && !link.hasAttribute('download')
        && (!Number.isFinite(event.button) || event.button === 0)
        && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
        && shouldUseSameContextForExternalWebsite(link.href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openExternalWebsite(link.href, handoffDetails);
        return;
    }

    prepareExternalHandoff(handoffDetails);
}, true);

window.addEventListener('pageshow', () => handleAppReturn('pageshow'));
window.addEventListener('focus', () => handleAppReturn('focus'));
document.addEventListener('visibilitychange', () => {
    if (document.hidden === false) handleAppReturn('visibilitychange');
});

// Close panel and clear pin
if (closeSlideBtn) {
    closeSlideBtn.addEventListener('click', () => {
        closeMapOnlySurfaces({ clearActivePin: true, resetPanel: true });
    });
}

// ====== NAVIGATION LOGIC ======
function activateNavItem(btn) {
    if (!btn || !btn.classList.contains('nav-item')) return;
    const targetId = btn.getAttribute('data-target');
    if (!targetId) return;

    const visitorAnalytics = window.BARK.visitorAnalytics;
    if (visitorAnalytics && typeof visitorAnalytics.trackScreen === 'function') {
        visitorAnalytics.trackScreen(targetId);
    }

    if (typeof window.BARK.closeSettingsModal === 'function') {
        window.BARK.closeSettingsModal();
    }

    navItems.forEach((navItem) => {
        const active = navItem === btn;
        navItem.classList.toggle('active', active);
        if (active) navItem.setAttribute('aria-current', 'page');
        else navItem.removeAttribute('aria-current');
    });

    if (targetId === 'map-view') {
        uiViews.forEach(v => v.classList.remove('active'));
        syncAppTabMode();
        closeMapOnlySurfaces({ clearActivePin: true, resetPanel: true });
        requestAnimationFrame(() => {
            if (filterPanel) filterPanel.style.display = 'flex';
            if (leafletControls.length) leafletControls[0].style.display = 'block';
            if (window.map) window.map.invalidateSize();
            if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
                window.BARK.invalidateMarkerVisibility();
            }
            if (typeof window.syncState === 'function') {
                window.BARK._pendingMarkerSync = false;
                window.syncState();
            }
        });
        return;
    }

    uiViews.forEach(v => {
        if (v.id === targetId) v.classList.add('active');
        else v.classList.remove('active');
    });
    syncAppTabMode();
    if (filterPanel) filterPanel.style.display = 'none';
    closeMapOnlySurfaces({ clearActivePin: true, resetPanel: true });
    if (leafletControls.length) leafletControls[0].style.display = 'none';
}

if (bottomNav) {
    let navPointerStart = null;
    let lastPointerActivation = { button: null, at: -Infinity };

    bottomNav.addEventListener('pointerdown', (event) => {
        const btn = event.target.closest('.nav-item');
        if (!btn || event.isPrimary === false || event.button !== 0) {
            navPointerStart = null;
            return;
        }
        navPointerStart = {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            button: event.button,
            x: event.clientX,
            y: event.clientY,
            btn
        };
    });

    bottomNav.addEventListener('pointerup', (event) => {
        const start = navPointerStart;
        navPointerStart = null;
        const btn = event.target.closest('.nav-item');
        if (!start || !btn || btn !== start.btn || event.pointerId !== start.pointerId) return;
        if (!shouldActivateBarkNavPointer({
            pointerType: start.pointerType,
            isPrimary: start.isPrimary,
            button: start.button,
            startX: start.x,
            startY: start.y,
            endX: event.clientX,
            endY: event.clientY
        })) return;

        event.preventDefault();
        event.stopPropagation();
        lastPointerActivation = { button: btn, at: performance.now() };
        activateNavItem(btn);
    });

    bottomNav.addEventListener('pointercancel', () => {
        navPointerStart = null;
    });

    bottomNav.addEventListener('click', (event) => {
        const btn = event.target.closest('.nav-item');
        if (!btn) return;
        const followsHandledPointer = lastPointerActivation.button === btn
            && performance.now() - lastPointerActivation.at < 700
            && event.detail !== 0;
        if (followsHandledPointer) {
            event.preventDefault();
            return;
        }
        activateNavItem(btn);
    });
}

// ====== MAP INTERACTION HANDLERS ======
if (window.map) {
    // Close panel when clicking on map
    map.on('click', () => {
        closeMapOnlySurfaces({ clearActivePin: true, resetPanel: true });
        document.getElementById('filter-panel').classList.add('collapsed');
    });

    // Auto-collapse filter when user pans
    map.on('movestart', () => {
        const fp = document.getElementById('filter-panel');
        if (fp && !fp.classList.contains('collapsed')) fp.classList.add('collapsed');
    });
}

// Toggle filter panel
const toggleFilterBtn = document.getElementById('toggle-filter-btn');
if (toggleFilterBtn) {
    toggleFilterBtn.addEventListener('click', () => {
        document.getElementById('filter-panel').classList.toggle('collapsed');
    });
}

// ====== VISITED FILTER DROPDOWN ======
const visitedFilterEl = document.getElementById('visited-filter');
if (visitedFilterEl) {
    visitedFilterEl.value = window.BARK.visitedFilterState;
    visitedFilterEl.addEventListener('change', (e) => {
        const requestedFilter = e.target.value;
        const authPremiumUi = window.BARK && window.BARK.authPremiumUi;
        const allowedFilter = authPremiumUi && typeof authPremiumUi.getAllowedVisitedFilter === 'function'
            ? authPremiumUi.getAllowedVisitedFilter(requestedFilter)
            : requestedFilter;

        if (allowedFilter !== requestedFilter) {
            e.target.value = allowedFilter;
            if (authPremiumUi && typeof authPremiumUi.openPremiumPrompt === 'function') {
                authPremiumUi.openPremiumPrompt('premium-visited-filter');
            }
        }

        window.BARK.visitedFilterState = allowedFilter;
        localStorage.setItem('barkVisitedFilter', window.BARK.visitedFilterState);
        window.syncState();
    });
}

// ====== SCORING MODAL ======
document.addEventListener('click', (e) => {
    const modal = document.getElementById('scoring-modal');
    if (!modal) return;
    if (e.target.closest('#scoring-info-btn')) modal.style.display = 'flex';
    if (e.target.closest('#close-scoring-modal') || e.target === modal) modal.style.display = 'none';
});

// ====== UPDATE TOAST ======
const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => window.location.reload(true));
}
};
