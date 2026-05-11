/**
 * uiController.js — Navigation, Slide Panel, Filter Panel, Modals, iOS Fixes
 * Loaded TWELFTH in the boot sequence.
 */
window.BARK = window.BARK || {};

window.BARK.initUI = function initUI() {
let keyboardFocusContext = null;

// ====== iOS SAFARI MAGNIFIER PROTECTION ======
document.addEventListener('contextmenu', function (e) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
});

function isTextEntryElement(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;

    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return ['email', 'number', 'password', 'search', 'tel', 'text', 'url'].includes(type);
}

function isAppTabActive() {
    return Boolean(document.querySelector('.ui-view.active'));
}

function syncAppTabMode() {
    document.body.classList.toggle('app-tab-active', isAppTabActive());
}

function closeMapOnlySurfaces() {
    const panel = document.getElementById('slide-panel');
    if (panel) panel.classList.remove('open');
}

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

    if (isTextEntryElement(activeElement) && typeof activeElement.blur === 'function') {
        activeElement.blur();
    }

    if (isAppTabActive()) closeMapOnlySurfaces();
    scheduleAppViewportSettle();
}

// ====== iOS KEYBOARD LAYOUT FIX ======
if (window.visualViewport) {
    let initialHeight = window.visualViewport.height;

    window.visualViewport.addEventListener('resize', () => {
        const isKeyboardOpen = (initialHeight - window.visualViewport.height) > window.screen.height * 0.2;
        const wasKeyboardOpen = document.body.classList.contains('keyboard-open');

        if (!isKeyboardOpen && wasKeyboardOpen) {
            dismissKeyboardTransientUi();
        }

        document.body.classList.toggle('keyboard-open', isKeyboardOpen);

        if (isKeyboardOpen && window.innerWidth < 768) {
            closeMapOnlySurfaces();
        }
    });

    window.addEventListener('orientationchange', () => {
        setTimeout(() => { initialHeight = window.visualViewport.height; }, 500);
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
    if (!isTextEntryElement(e.target) || !isAppTabActive()) return;
    const activeView = document.querySelector('.ui-view.active');
    keyboardFocusContext = activeView
        ? { view: activeView, scrollTop: activeView.scrollTop }
        : null;
    closeMapOnlySurfaces();
});

document.addEventListener('focusout', (e) => {
    if (!isTextEntryElement(e.target) || !isAppTabActive()) return;
    setTimeout(() => {
        if (isTextEntryElement(document.activeElement)) return;
        scheduleAppViewportSettle();
    }, 120);
}, true);

function initUIEventListeners() {
    const bindClick = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
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
    bindFixedSurfaceScrollGuard(bottomNav);
}

// Close panel and clear pin
if (closeSlideBtn) {
    closeSlideBtn.addEventListener('click', () => {
        slidePanel.classList.remove('open');
        window.BARK.clearActivePin();
    });
}

// ====== NAVIGATION LOGIC ======
navItems.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');

        if (typeof window.BARK.closeSettingsModal === 'function') {
            window.BARK.closeSettingsModal();
        }

        navItems.forEach(n => n.classList.remove('active'));
        btn.classList.add('active');

        if (targetId === 'map-view') {
            uiViews.forEach(v => v.classList.remove('active'));
            syncAppTabMode();
            closeMapOnlySurfaces();
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
        } else {
            uiViews.forEach(v => {
                if (v.id === targetId) v.classList.add('active');
                else v.classList.remove('active');
            });
            syncAppTabMode();
            if (filterPanel) filterPanel.style.display = 'none';
            if (slidePanel) slidePanel.classList.remove('open');
            if (leafletControls.length) leafletControls[0].style.display = 'none';
        }
    });
});

// ====== MAP INTERACTION HANDLERS ======
if (window.map) {
    // Close panel when clicking on map
    map.on('click', () => {
        if (slidePanel) slidePanel.classList.remove('open');
        window.BARK.clearActivePin();
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

// ====== FEEDBACK PORTAL ======
const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
function isFeedbackEnabled() {
    return !window.BARK ||
        typeof window.BARK.isLaunchFlagEnabled !== 'function' ||
        window.BARK.isLaunchFlagEnabled('feedbackEnabled');
}

function disableFeedbackPortal(message) {
    const portal = document.getElementById('feedback-portal');
    const textArea = document.getElementById('feedback-text');
    const copy = portal ? portal.querySelector('p') : null;
    if (portal) portal.dataset.launchDisabled = 'true';
    if (copy) copy.textContent = message;
    if (textArea) {
        textArea.value = '';
        textArea.placeholder = message;
        textArea.disabled = true;
    }
    if (submitFeedbackBtn) {
        submitFeedbackBtn.textContent = 'Feedback paused';
        submitFeedbackBtn.disabled = true;
    }
}

if (submitFeedbackBtn && !isFeedbackEnabled()) {
    const message = window.BARK && typeof window.BARK.getLaunchFlagMessage === 'function'
        ? window.BARK.getLaunchFlagMessage('feedbackEnabled')
        : 'In-app feedback is paused for beta safety. Use the email suggestion option above for now.';
    disableFeedbackPortal(message);
} else if (submitFeedbackBtn && typeof firebase !== 'undefined') {
    submitFeedbackBtn.addEventListener('click', async () => {
        const textArea = document.getElementById('feedback-text');
        const text = textArea ? textArea.value : '';
        if (!text || text.trim() === '') return;
        if (textArea && typeof textArea.blur === 'function') textArea.blur();
        dismissKeyboardTransientUi();

        const user = firebase.auth().currentUser;
        if (!user) {
            submitFeedbackBtn.textContent = 'Sign in to send';
            setTimeout(() => { submitFeedbackBtn.textContent = 'Submit Feedback'; }, 3000);
            return;
        }

        submitFeedbackBtn.textContent = 'Submitting...';
        submitFeedbackBtn.disabled = true;

        try {
            window.BARK.incrementRequestCount();
            const submitFeedback = firebase.functions().httpsCallable('submitFeedback');
            await submitFeedback({
                message: text,
                type: 'general',
                browser: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform,
                    language: navigator.language,
                    path: window.location ? window.location.pathname : '',
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight
                }
            });
            submitFeedbackBtn.textContent = 'Feedback Sent!';
            if (textArea) textArea.value = '';
            setTimeout(() => { submitFeedbackBtn.textContent = 'Submit Feedback'; submitFeedbackBtn.disabled = false; }, 3000);
        } catch (err) {
            console.error('Feedback error:', err);
            const code = String(err && err.code ? err.code : '').replace(/^functions\//, '');
            submitFeedbackBtn.textContent = code === 'resource-exhausted'
                ? 'Try again later'
                : code === 'unauthenticated'
                    ? 'Sign in to send'
                    : 'Error. Try again';
            submitFeedbackBtn.disabled = false;
        }
    });
}

// ====== UPDATE TOAST ======
const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => window.location.reload(true));
}
};
