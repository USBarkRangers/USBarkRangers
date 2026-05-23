/**
 * authService.js - Firebase initialization and authentication lifecycle.
 * Phase 3 move-only extraction from dataService.js; hydration stays in place.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

let userSnapshotUnsubscribe = null;
let authenticatedSessionSeen = false;
let lastAuthenticatedUid = null;

function getAuthIntentState() {
    window.BARK = window.BARK || {};
    window.BARK.auth = window.BARK.auth || {};
    return window.BARK.auth;
}

function requestGoogleAccountChooser() {
    getAuthIntentState().forceGoogleAccountChooserOnNextSignIn = true;
}

function consumeGoogleAccountChooserRequest() {
    const authIntent = getAuthIntentState();
    const forceAccountChooser = authIntent.forceGoogleAccountChooserOnNextSignIn === true;
    authIntent.forceGoogleAccountChooserOnNextSignIn = false;
    return forceAccountChooser;
}

function createGoogleProvider(options = {}) {
    const provider = new firebase.auth.GoogleAuthProvider();
    if (options.forceAccountChooser && typeof provider.setCustomParameters === 'function') {
        provider.setCustomParameters({
            prompt: 'select_account'
        });
    }
    return provider;
}

async function ensureLocalAuthPersistence(auth = firebase.auth()) {
    if (!auth || typeof auth.setPersistence !== 'function') return;
    const persistence = firebase.auth.Auth
        && firebase.auth.Auth.Persistence
        && firebase.auth.Auth.Persistence.LOCAL;
    if (!persistence) return;

    try {
        await auth.setPersistence(persistence);
    } catch (error) {
        console.warn('[authService] Could not set LOCAL auth persistence; continuing with Firebase default.', error);
    }
}

function isStandalonePwa() {
    return window.navigator.standalone === true
        || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function isIosDevice() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isIosStandalonePwa() {
    return isStandalonePwa() && isIosDevice();
}

// With authDomain set to the same origin as the app (barkrangermap-auth.web.app),
// signInWithPopup no longer triggers cross-site cookie partitioning on iOS
// Safari, which was the original cause of auth/network-request-failed. Popup is
// also more reliable than redirect on iOS: the redirect handoff back to web.app
// regularly drops the credential under Safari ITP. So we prefer popup
// everywhere; the explicit popup-failure fallback below still escalates to
// redirect if the browser blocks popup or the network call genuinely fails.
// Non-iOS Android browsers stay on redirect because Android Chrome popups don't
// integrate well with the OS account chooser.
function shouldUseRedirectGoogleSignIn() {
    const ua = navigator.userAgent || '';
    if (isIosDevice()) return false;
    const isAndroid = /Android/i.test(ua);
    const isTouchDevice = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    return isAndroid && isTouchDevice;
}

function shouldRetryGoogleSignInWithRedirect(error) {
    const code = error && error.code ? String(error.code) : '';
    return code === 'auth/network-request-failed'
        || code === 'auth/popup-blocked';
}

const GOOGLE_REDIRECT_PENDING_KEY = 'bark.googleRedirect.pending';
const GOOGLE_REDIRECT_RESULT_TIMEOUT_MS = 8000;

function markGoogleRedirectPending() {
    try {
        sessionStorage.setItem(GOOGLE_REDIRECT_PENDING_KEY, String(Date.now()));
    } catch (error) {
        // sessionStorage can throw in private mode; safe to ignore.
    }
}

function consumeGoogleRedirectPendingMarker() {
    try {
        const value = sessionStorage.getItem(GOOGLE_REDIRECT_PENDING_KEY);
        if (value) sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
        return Boolean(value);
    } catch (error) {
        return false;
    }
}

function showIosPwaGoogleSignInNotice(error) {
    console.warn('[authService] Google popup failed in iOS standalone PWA:', error);
    showAuthFailureNotice('Google sign-in was blocked in the installed iPhone app. Open the website in Safari for Google sign-in, or use email sign-in here.');
}

function bindGoogleSignInButton() {
    const googleBtn = document.getElementById('google-login-btn');
    if (!googleBtn || googleBtn.dataset.barkGoogleSignInBound === 'true') return;
    googleBtn.dataset.barkGoogleSignInBound = 'true';
    googleBtn.addEventListener('click', async () => {
        try {
            const provider = createGoogleProvider({
                forceAccountChooser: consumeGoogleAccountChooserRequest()
            });
            if (typeof window.BARK.incrementRequestCount === 'function') {
                window.BARK.incrementRequestCount();
            }
            await signInWithGoogleProvider(provider);
        } catch (error) {
            console.error('[authService] Google sign-in failed:', error);
            alert('Login Error: ' + (error && error.message ? error.message : 'unknown error'));
        }
    });
}

async function signInWithGoogleProvider(provider) {
    const auth = firebase.auth();
    await ensureLocalAuthPersistence(auth);
    if (shouldUseRedirectGoogleSignIn()) {
        markGoogleRedirectPending();
        await auth.signInWithRedirect(provider);
        return;
    }
    try {
        await auth.signInWithPopup(provider);
    } catch (error) {
        if (isIosStandalonePwa()) {
            showIosPwaGoogleSignInNotice(error);
            return;
        }
        if (shouldRetryGoogleSignInWithRedirect(error)) {
            console.warn('[authService] Google popup failed; retrying with redirect:', error);
            markGoogleRedirectPending();
            await auth.signInWithRedirect(provider);
            return;
        }
        throw error;
    }
}

// Complete any pending signInWithRedirect from a prior page load. Must run
// after firebase.initializeApp(). Raced against a hard timeout because on iOS
// Safari getRedirectResult can hang waiting for an iframe handshake that never
// resolves (storage partitioning). Without the timeout, the caller awaits
// forever and the auth observer is never wired, leaving the UI stuck in its
// initial logged-out state even after Google authenticated the user.
async function consumeGoogleRedirectResult() {
    if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') return;
    const auth = firebase.auth();
    if (typeof auth.getRedirectResult !== 'function') return;

    const hadPendingRedirect = consumeGoogleRedirectPendingMarker();
    let timeoutHandle = null;
    const timeoutSentinel = { __barkTimedOut: true };
    const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timeoutSentinel), GOOGLE_REDIRECT_RESULT_TIMEOUT_MS);
    });

    try {
        await ensureLocalAuthPersistence(auth);
        const result = await Promise.race([auth.getRedirectResult(), timeoutPromise]);
        clearTimeout(timeoutHandle);

        if (result === timeoutSentinel) {
            console.warn('[authService] getRedirectResult timed out after',
                GOOGLE_REDIRECT_RESULT_TIMEOUT_MS, 'ms; init continues. The auth observer will still pick up the user if the SDK resolves later.');
            if (hadPendingRedirect) {
                if (isIosStandalonePwa()) {
                    showIosPwaGoogleSignInNotice(new Error('redirect result timed out'));
                } else {
                    showAuthFailureNotice('Google sign-in is taking longer than expected on this browser. If you stay signed out, try email sign-in or open the site in regular Safari (not Private mode).');
                }
            }
            return;
        }

        if (result && result.user) {
            console.log('[authService] Google redirect sign-in completed:', result.user.uid);
            return result;
        }

        if (hadPendingRedirect) {
            console.error('[authService] Google redirect was initiated but no user came back. iOS Safari ITP/storage partitioning likely cleared the auth state.');
            if (isIosStandalonePwa()) {
                showIosPwaGoogleSignInNotice(new Error('redirect returned no user'));
            } else {
                showAuthFailureNotice('Google sign-in did not complete on this browser. Try email sign-in, or sign in from a desktop browser.');
            }
        }
        return result;
    } catch (error) {
        clearTimeout(timeoutHandle);
        const code = error && error.code ? String(error.code) : '';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
            console.warn('[authService] Google redirect canceled:', code);
            return;
        }
        console.error('[authService] getRedirectResult failed:', error);
        const detail = code || (error && error.message) || 'unknown error';
        showAuthFailureNotice('Google sign-in could not be completed (' + detail + '). Please try again or use email sign-in.');
    }
}

function showAuthFailureNotice(message) {
    if (typeof window.BARK.showAuthFailure === 'function') {
        window.BARK.showAuthFailure(message || 'Sign-in failed. Cloud sync and saved progress are offline for this session.');
    }
    if (typeof window.dismissBarkLoader === 'function') window.dismissBarkLoader();
}

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function refreshVisitedCache(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedCache === 'function') {
        coordinator.refreshVisitedCache(reason);
        return true;
    }

    if (window.BARK && typeof window.BARK.invalidateVisitedIdsCache === 'function') {
        window.BARK.invalidateVisitedIdsCache();
        return true;
    }

    return false;
}

function refreshVisitedVisuals(reason, firebaseService = null) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedVisuals === 'function') {
        coordinator.refreshVisitedVisuals(reason);
        return true;
    }

    const fallbackFirebaseService = firebaseService || (window.BARK.services && window.BARK.services.firebase);
    if (fallbackFirebaseService && typeof fallbackFirebaseService.refreshVisitedVisualState === 'function') {
        fallbackFirebaseService.refreshVisitedVisualState();
        return true;
    }

    return false;
}

function hasAuthVisitedPlace(placeOrId) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function') {
        return vaultRepo.hasVisit(placeOrId);
    }

    return false;
}

const STANDALONE_CLOUD_SETTING_CONTROLS = {
    rememberMapPosition: 'remember-map-toggle',
    startNationalView: 'national-view-toggle',
    ultraLowEnabled: 'ultra-low-toggle'
};

function syncCheckboxControl(settingKey, elementId) {
    const input = document.getElementById(elementId);
    if (!input || !('checked' in input)) return;
    input.checked = Boolean(window[settingKey]);
}

function syncRegistrySettingControls(registry) {
    Object.entries(registry || {}).forEach(([settingKey, setting]) => {
        if (!setting || !setting.elementId) return;
        syncCheckboxControl(settingKey, setting.elementId);
    });
}

function syncStandaloneCloudSettingControls() {
    Object.entries(STANDALONE_CLOUD_SETTING_CONTROLS).forEach(([settingKey, elementId]) => {
        syncCheckboxControl(settingKey, elementId);
    });
}

function syncCloudSettingsControls(registry) {
    if (typeof window.BARK.syncSettingsControls === 'function') {
        window.BARK.syncSettingsControls();
    } else {
        syncRegistrySettingControls(registry);
    }

    syncStandaloneCloudSettingControls();
}

function isPremiumEntitlementActive() {
    const premiumService = getPremiumService();
    return Boolean(
        premiumService &&
        typeof premiumService.isPremium === 'function' &&
        premiumService.isPremium()
    );
}

function getCloudSettingsRevision(settings) {
    if (!settings) return 0;

    const revision = settings.settingsUpdatedAt || settings.updatedAt;
    if (typeof revision === 'number' && Number.isFinite(revision)) return revision;
    if (typeof revision === 'string') {
        const parsed = Number(revision);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (revision && typeof revision.toMillis === 'function') return revision.toMillis();
    if (revision && Number.isFinite(Number(revision.seconds))) {
        return (Number(revision.seconds) * 1000) + Math.floor(Number(revision.nanoseconds || 0) / 1000000);
    }
    return 0;
}

function handleCloudSettingsHydration(data, metadata = {}) {
    try {
        if (!data.settings) return;

        if (sessionStorage.getItem('skipCloudHydration') === 'true') {
            sessionStorage.removeItem('skipCloudHydration');
            console.log("☁️ Cloud settings skipped: Preserving local force-reload state.");
            return;
        }

        const s = data.settings;
        const isPremium = isPremiumEntitlementActive();
        const cloudRevision = getCloudSettingsRevision(s);
        const lastAppliedRevision = Number(window._lastAppliedCloudSettingsRevision || 0);
        const savingRevision = Number(window._savingCloudSettingsRevision || 0);
        const pendingLocalChanges = window._pendingLocalSettingsChanges === true;

        // Skip hydration if any of these are true:
        // - User has local changes pending save (would overwrite their changes)
        // - A save is in progress (would race with the save)
        // - Cloud has no newer revision than what we already applied (nothing new to apply)
        if (window._cloudSettingsLoaded && (pendingLocalChanges || savingRevision > 0 || !cloudRevision || cloudRevision <= lastAppliedRevision)) {
            console.log('[authService] Skipping hydration:', { pendingLocalChanges, savingRevision, cloudRevision, lastAppliedRevision });
            return;
        }

        if (!metadata.fromCache) window._cloudSettingsLoaded = true;
        if (cloudRevision) window._lastAppliedCloudSettingsRevision = cloudRevision;

        const store = window.BARK.settings;
        const registry = window.BARK.SETTINGS_REGISTRY || {};

        if (!isPremium) {
            syncCloudSettingsControls(registry);
            console.log('[authService] Cloud settings sync skipped for non-premium user; local settings preserved.');
            return;
        }

        window.BARK.isHydratingCloudSettings = true;

        // lowGfxEnabled must run first — its setter applies LOW_GRAPHICS_PRESET,
        // which individual settings set below can then override.
        if (Object.prototype.hasOwnProperty.call(s, 'lowGfxEnabled')) {
            store.set('lowGfxEnabled', s.lowGfxEnabled === true);
        }

        // standardClustering default: off, matching the public Google My Maps-like view.
        const cloudPremiumClustering = isPremium ? (s.premiumClustering || false) : false;
        const cloudStandardClustering = s.standardClustering === undefined
            ? false
            : s.standardClustering === true;

        Object.entries(registry).forEach(([settingKey, setting]) => {
            if (!setting.cloudKey || settingKey === 'lowGfxEnabled') return;

            let value;
            if (settingKey === 'standardClusteringEnabled') {
                value = cloudStandardClustering;
            } else if (settingKey === 'premiumClusteringEnabled') {
                value = cloudPremiumClustering;
            } else if (Object.prototype.hasOwnProperty.call(s, setting.cloudKey)) {
                value = s[setting.cloudKey] === true;
            } else {
                return;
            }
            store.set(settingKey, value);
        });

        // Non-registry settings: route through store so persist + window mirror stay consistent.
        if (Object.prototype.hasOwnProperty.call(s, 'ultraLowEnabled')) {
            store.set('ultraLowEnabled', s.ultraLowEnabled === true);
        }
        if (Object.prototype.hasOwnProperty.call(s, 'rememberMapPosition')) {
            store.set('rememberMapPosition', s.rememberMapPosition === true);
        }
        if (Object.prototype.hasOwnProperty.call(s, 'startNationalView')) {
            store.set('startNationalView', s.startNationalView === true);
        }

        syncCloudSettingsControls(registry);

        if (s.mapStyle || !isPremium) {
            const mapStyle = isPremium ? s.mapStyle : 'default';
            localStorage.setItem('barkMapStyle', mapStyle);
            const styleEl = document.getElementById('map-style-select');
            if (styleEl) styleEl.value = mapStyle;
            if (typeof window.BARK.loadLayer === 'function') window.BARK.loadLayer(mapStyle);
        }
        if (s.visitedFilter || !isPremium) {
            const visitedFilter = isPremium ? s.visitedFilter : 'all';
            localStorage.setItem('barkVisitedFilter', visitedFilter);
            const filterEl = document.getElementById('visited-filter');
            if (filterEl) filterEl.value = visitedFilter;
            window.BARK.visitedFilterState = visitedFilter;
        }

        window.BARK.applyGlobalStyles();
        if (typeof window.BARK.applyMapPerformancePolicy === 'function') window.BARK.applyMapPerformancePolicy();
        const parkRepo = getParkRepo();
        const hasParkData = parkRepo && parkRepo.getAll().length > 0;
        if (typeof window.syncState === 'function' && hasParkData) {
            window.syncState();
        }

        const mapRef = (typeof map !== 'undefined') ? map : window.map;
        if (window.startNationalView && mapRef) {
            mapRef.setView([39.8283, -98.5795], 4, { animate: false });
        }

        console.log("☁️ Cloud settings loaded and injected perfectly!");
    } catch (error) {
        console.error("[authService] cloud settings hydration failed:", error);
    } finally {
        window.BARK.isHydratingCloudSettings = false;
    }
}

function handleAdminCheck(data, user) {
    try {
        const adminContainer = document.getElementById('admin-controls-container');
        window.isAdmin = data.isAdmin === true;

        if (adminContainer) {
            if (window.isAdmin) {
                adminContainer.innerHTML = `
                    <button onclick="window.location.href='pages/admin.html'" class="glass-btn primary-btn" style="width: 100%; background: #10b981; color: white; border: none; padding: 14px; border-radius: 12px; font-weight: 800; display: flex; justify-content: center; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"></path></svg>
                        Enter Data Refinery
                    </button>`;
            } else {
                adminContainer.innerHTML = '';
            }
        }
    } catch (error) {
        console.error("[authService] admin check failed:", error);
    }
}

function handleExpeditionSync(data = {}) {
    try {
        const expedition = data.virtual_expedition && typeof data.virtual_expedition === 'object'
            ? data.virtual_expedition
            : {};
        const history = Array.isArray(expedition.history) ? expedition.history : [];
        const lifetime = Number(data.lifetime_miles) || 0;
        const activeTrailName = expedition.trail_name || 'Expedition';

        if (expedition.active_trail) {
            const miles = expedition.miles_logged || 0;
            const total = expedition.trail_total_miles || 0;

            if (typeof window.BARK.renderVirtualTrailOverlay === 'function')
                window.BARK.renderVirtualTrailOverlay(expedition.active_trail, miles);
            if (typeof window.hydrateEducationModal === 'function')
                window.hydrateEducationModal(expedition.active_trail);

            const isComplete = total > 0 && miles >= total;

            const introState = document.getElementById('expedition-intro-state');
            const activeState = document.getElementById('expedition-active-state');
            const completeState = document.getElementById('expedition-complete-state');
            if (introState) introState.style.display = 'none';
            if (activeState) activeState.style.display = isComplete ? 'none' : 'block';
            if (completeState) completeState.style.display = isComplete ? 'block' : 'none';

            const nameEl = document.getElementById('expedition-name');
            if (nameEl) {
                nameEl.textContent = isComplete ? "CONQUERED" : activeTrailName;
                nameEl.dataset.trailName = activeTrailName;
            }

            if (isComplete) {
                const celebName = document.getElementById('celebration-trail-name');
                if (celebName) celebName.textContent = activeTrailName;
                const claimBtn = document.getElementById('claim-reward-btn');
                const trailPts = Math.max(1, Math.round(total / 2));
                if (claimBtn) claimBtn.textContent = `🎁 Claim +${trailPts} PTS & Reset`;
            }

            if (typeof window.BARK.renderExpeditionProgress === 'function')
                window.BARK.renderExpeditionProgress(miles, total, lifetime);
            if (typeof window.BARK.renderExpeditionHistory === 'function')
                window.BARK.renderExpeditionHistory(history, activeTrailName);
        } else {
            if (typeof window.BARK.resetActiveExpeditionRuntimeState === 'function') {
                window.BARK.resetActiveExpeditionRuntimeState();
            } else {
                const introState = document.getElementById('expedition-intro-state');
                const activeState = document.getElementById('expedition-active-state');
                const completeState = document.getElementById('expedition-complete-state');
                const nameEl = document.getElementById('expedition-name');
                if (introState) introState.style.display = 'block';
                if (activeState) activeState.style.display = 'none';
                if (completeState) completeState.style.display = 'none';
                if (nameEl) {
                    nameEl.textContent = '';
                    delete nameEl.dataset.trailName;
                }
            }

            if (typeof window.BARK.renderExpeditionProgress === 'function') {
                window.BARK.renderExpeditionProgress(0, 0, lifetime);
            }
            if (typeof window.BARK.renderExpeditionHistory === 'function') {
                window.BARK.renderExpeditionHistory(history, activeTrailName === 'Expedition' ? 'General Walk' : activeTrailName);
            }
        }

        let cExpeditions = [];
        if (Array.isArray(data.completed_expeditions)) {
            cExpeditions = data.completed_expeditions;
        } else if (Array.isArray(data.completedExpeditions)) {
            cExpeditions = data.completedExpeditions;
        }
        if (typeof window.BARK.renderCompletedExpeditions === 'function')
            window.BARK.renderCompletedExpeditions(cExpeditions);
        if (typeof window.BARK.renderCompletedTrailsOverlay === 'function')
            window.BARK.renderCompletedTrailsOverlay(cExpeditions);
    } catch (error) {
        console.error("[authService] expedition sync failed:", error);
    }
}

function refreshActivePinVisitedButton() {
    if (!window.BARK.activePinMarker || !window.BARK.activePinMarker._parkData || !document.getElementById('mark-visited-btn')) return;

    const d = window.BARK.activePinMarker._parkData;
    const btn = document.getElementById('mark-visited-btn');
    const btnText = document.getElementById('mark-visited-text');
    const isVisited = typeof window.BARK.isParkVisited === 'function'
        ? window.BARK.isParkVisited(d)
        : hasAuthVisitedPlace(d);

    if (isVisited) {
        btn.classList.add('visited');
        if (btnText) btnText.textContent = 'Visited!';
    } else {
        btn.classList.remove('visited');
        if (btnText) btnText.textContent = 'Mark as Visited';
    }
}

function refreshAuthSnapshotUi() {
    if (typeof window.syncState === 'function') window.syncState();
    if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
    refreshActivePinVisitedButton();
}

function hasAuthoritativeSnapshotMetadata(metadata) {
    return Boolean(metadata && metadata.fromCache !== true && metadata.hasPendingWrites !== true);
}

function maybeSyncAuthoritativeProfileScore(reason) {
    if (!window._firstServerPayloadReceived || !window._visitedPlacesServerSnapshotReceived) return;
    if (window._authoritativeProfileScoreSyncQueued) return;

    const queuedUser = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
    if (!queuedUser) return;
    const queuedUid = queuedUser.uid;

    window._authoritativeProfileScoreSyncQueued = true;
    setTimeout(() => {
        window._authoritativeProfileScoreSyncQueued = false;

        const currentUser = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
        if (!currentUser || currentUser.uid !== queuedUid) return;
        if (!window._firstServerPayloadReceived || !window._visitedPlacesServerSnapshotReceived) return;

        if (typeof window.BARK.syncScoreToLeaderboard === 'function') {
            Promise.resolve(window.BARK.syncScoreToLeaderboard())
                .catch(error => console.error(`[authService] authoritative score sync failed (${reason || 'snapshot'}):`, error));
        }
    }, 0);
}

function getFirebaseService() {
    return window.BARK.services && window.BARK.services.firebase;
}

function buildVaultRepoSubscriptionOptions() {
    const firebaseRef = typeof firebase !== 'undefined' ? firebase : null;
    const firebaseService = getFirebaseService();

    return {
        firebase: firebaseRef,
        getCurrentUid() {
            const currentUser = firebaseRef && firebaseRef.auth ? firebaseRef.auth().currentUser : null;
            return currentUser ? currentUser.uid : null;
        },
        incrementRequestCount() {
            if (typeof window.BARK.incrementRequestCount === 'function') {
                window.BARK.incrementRequestCount();
            }
        },
        invalidateVisitedIdsCache() {
            refreshVisitedCache('vault-snapshot-reconcile');
        },
        refreshVisitedVisualState: () => refreshVisitedVisuals('vault-snapshot-reconcile', firebaseService),
        normalizeLocalVisitedPlacesToCanonical: firebaseService && typeof firebaseService.normalizeLocalVisitedPlacesToCanonical === 'function'
            ? options => firebaseService.normalizeLocalVisitedPlacesToCanonical(options)
            : null,
        onChange(change) {
            if (hasAuthoritativeSnapshotMetadata(change && change.metadata)) {
                window._visitedPlacesServerSnapshotReceived = true;
            }
            refreshAuthSnapshotUi();
            maybeSyncAuthoritativeProfileScore('visitedPlaces-snapshot');
        },
        onError(error) {
            console.error('[authService] visitedPlaces snapshot failed:', error);
            showAuthFailureNotice('Sign-in connected, but visit sync failed. Saved progress may be offline for this session.');
        }
    };
}

function startVaultRepoVisitSubscription(user) {
    const vaultRepo = getVaultRepo();
    if (!vaultRepo || typeof vaultRepo.startSubscription !== 'function') {
        throw new Error('VaultRepo.startSubscription is required for visited-place sync.');
    }
    return vaultRepo.startSubscription(user.uid, buildVaultRepoSubscriptionOptions());
}

function stopVaultRepoVisitSubscription() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.stopSubscription === 'function') {
        vaultRepo.stopSubscription();
    }
}

function stopUserSnapshotSubscription() {
    if (!userSnapshotUnsubscribe) return;
    const unsubscribe = userSnapshotUnsubscribe;
    userSnapshotUnsubscribe = null;
    try {
        unsubscribe();
    } catch (error) {
        console.error('[authService] user snapshot unsubscribe failed:', error);
    }
}

function handlePremiumGating(isPremium, options = {}) {
    const premiumUi = window.BARK.authPremiumUi;
    if (premiumUi && typeof premiumUi.applyPremiumGating === 'function') {
        premiumUi.applyPremiumGating(isPremium === true, {
            reason: options.reason || null,
            sanitizePremiumState: options.sanitizePremiumState === true
        });
    }
}

function getPremiumService() {
    return window.BARK.services && window.BARK.services.premium;
}

function resetPremiumEntitlement(reason) {
    const premiumService = getPremiumService();
    if (!premiumService || typeof premiumService.reset !== 'function') return;
    try {
        premiumService.reset({ reason });
        refreshPremiumUiFromEntitlement(reason);
    } catch (error) {
        console.error('[authService] premium entitlement reset failed:', error);
    }
}

function updatePremiumEntitlement(rawEntitlement, user, reason) {
    const premiumService = getPremiumService();
    if (!premiumService || typeof premiumService.setEntitlement !== 'function') return;
    try {
        premiumService.setEntitlement(rawEntitlement, {
            uid: user && user.uid ? user.uid : null,
            reason
        });
        refreshPremiumUiFromEntitlement(reason);
    } catch (error) {
        console.error('[authService] premium entitlement update failed:', error);
    }
}

function refreshPremiumUiFromEntitlement(reason) {
    const premiumService = getPremiumService();
    const isPremium = premiumService && typeof premiumService.isPremium === 'function'
        ? premiumService.isPremium()
        : false;
    handlePremiumGating(isPremium, {
        reason,
        sanitizePremiumState: shouldSanitizePremiumRuntime(reason, isPremium)
    });

    const user = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
    const savedRoutesRefresh = window.BARK && window.BARK.refreshSavedRoutesEntitlementState;
    if (typeof savedRoutesRefresh === 'function') {
        savedRoutesRefresh(user && user.uid ? user.uid : null);
    }
}

function shouldSanitizePremiumRuntime(reason, isPremium) {
    if (isPremium) return false;
    return [
        'auth-signed-out',
        'auth-user-changed',
        'auth-user-snapshot',
        'auth-user-snapshot-missing'
    ].includes(reason);
}

function setGuestDefaultSetting(key, value) {
    const store = window.BARK.settings;
    try {
        if (store && typeof store.set === 'function') {
            store.set(key, value);
        } else {
            window[key] = value;
        }
    } catch (error) {
        console.warn(`[authService] failed to reset setting "${key}" on logout:`, error);
    }
}

function resetGuestSettingsToDefaults() {
    const registry = window.BARK.SETTINGS_REGISTRY || {};

    setGuestDefaultSetting('ultraLowEnabled', false);
    if (registry.lowGfxEnabled) setGuestDefaultSetting('lowGfxEnabled', registry.lowGfxEnabled.defaultValue === true);

    Object.entries(registry).forEach(([settingKey, setting]) => {
        if (settingKey === 'lowGfxEnabled') return;
        setGuestDefaultSetting(settingKey, setting.defaultValue === true);
    });

    setGuestDefaultSetting('rememberMapPosition', false);
    setGuestDefaultSetting('startNationalView', true);
    setGuestDefaultSetting('limitZoomOut', true);

    if (typeof window.BARK.syncSettingsControls === 'function') window.BARK.syncSettingsControls();
    if (typeof window.BARK.applyGlobalStyles === 'function') window.BARK.applyGlobalStyles();
    if (typeof window.BARK.applyMapPerformancePolicy === 'function') window.BARK.applyMapPerformancePolicy();

    const mapRef = window.map || (typeof map !== 'undefined' ? map : null);
    if (mapRef) {
        if (mapRef.dragging && typeof mapRef.dragging.enable === 'function') mapRef.dragging.enable();
        if (mapRef.touchZoom && typeof mapRef.touchZoom.enable === 'function') mapRef.touchZoom.enable();
    }
}

function applyGuestZoomLimitDefault() {
    setGuestDefaultSetting('limitZoomOut', true);
    if (typeof window.BARK.syncSettingsControls === 'function') window.BARK.syncSettingsControls();
    if (typeof window.BARK.applyMapPerformancePolicy === 'function') window.BARK.applyMapPerformancePolicy();
}

function resetMapStyleToDefault() {
    localStorage.setItem('barkMapStyle', 'default');

    const mapStyleSelect = document.getElementById('map-style-select');
    if (mapStyleSelect) mapStyleSelect.value = 'default';
    if (typeof window.BARK.loadLayer === 'function') window.BARK.loadLayer('default');
}

function resetSearchAndFilterState() {
    window.BARK.activeSearchQuery = '';
    window.BARK.activeTypeFilter = 'all';
    if (window.BARK.activeSwagFilters && typeof window.BARK.activeSwagFilters.clear === 'function') {
        window.BARK.activeSwagFilters.clear();
    } else {
        window.BARK.activeSwagFilters = new Set();
    }

    window.BARK._searchResultCache = {
        query: '',
        matchedIds: null,
        complete: true,
        processedCount: 0,
        totalCount: 0
    };
    window._lastFilterState = null;

    localStorage.setItem('barkVisitedFilter', 'all');
    window.BARK.visitedFilterState = 'all';

    const searchInput = document.getElementById('park-search');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const searchSuggestions = document.getElementById('search-suggestions');
    const typeFilter = document.getElementById('type-filter');
    const visitedFilter = document.getElementById('visited-filter');

    if (searchInput) searchInput.value = '';
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';
    if (searchSuggestions) {
        searchSuggestions.style.display = 'none';
        searchSuggestions.innerHTML = '';
    }
    if (typeFilter) typeFilter.value = 'all';
    if (visitedFilter) visitedFilter.value = 'all';

    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
}

function resetVisitedAndPanelState() {
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    if (firebaseService && typeof firebaseService.clearVisitedPlacePendingMutations === 'function') {
        firebaseService.clearVisitedPlacePendingMutations();
    }

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.clear === 'function') {
        vaultRepo.clear();
    }

    if (!refreshVisitedCache('auth-reset-visited-panel') && typeof window.BARK.invalidateMarkerVisibility === 'function') {
        window.BARK.invalidateMarkerVisibility();
    }
    refreshVisitedVisuals('auth-reset-visited-panel', firebaseService);

    if (typeof window.BARK.clearActivePin === 'function') window.BARK.clearActivePin();

    const slidePanel = document.getElementById('slide-panel');
    const visitedSection = document.getElementById('panel-visited-section');
    if (slidePanel) slidePanel.classList.remove('open');
    if (visitedSection) visitedSection.style.display = 'none';
}

function resetSavedRouteLists() {
    const savedList = document.getElementById('saved-routes-list');
    const plannerList = document.getElementById('planner-saved-routes-list');
    const savedCount = document.getElementById('saved-routes-count');
    const plannerContainer = document.getElementById('planner-saved-routes-container');

    if (savedList) savedList.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">Sign in to view saved routes.</p>';
    if (plannerList) plannerList.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">Please log in to see saved routes.</p>';
    if (savedCount) savedCount.textContent = '0';
    if (plannerContainer) plannerContainer.style.display = 'none';
}

function resetAdminUi() {
    const adminContainer = document.getElementById('admin-controls-container');
    if (adminContainer) adminContainer.innerHTML = '';
}

function resetMapViewToGuestDefault() {
    const mapRef = window.map || (typeof map !== 'undefined' ? map : null);
    if (!mapRef || typeof mapRef.setView !== 'function') return;

    const guestZoom = 5;

    localStorage.removeItem('mapLat');
    localStorage.removeItem('mapLng');
    localStorage.removeItem('mapZoom');
    mapRef.setView([39.8283, -98.5795], guestZoom, { animate: false });

    if (mapRef.locate && navigator.geolocation) {
        mapRef.locate({ setView: true, maxZoom: guestZoom, watch: false });
    }
}

function restoreGuestMarkerLayer() {
    const parkRepo = getParkRepo();
    const points = parkRepo ? parkRepo.getAll() : [];
    if (!points.length) return;

    points.forEach(point => {
        if (!point || !point.marker) return;
        point.marker._barkIsVisible = true;
        if (point.marker._icon) {
            point.marker._icon.classList.remove('marker-filter-hidden');
            point.marker._icon.classList.remove('visited-pin');
            point.marker._icon.classList.remove('visited-marker');
            point.marker._icon.classList.add('unvisited-marker');
        }
    });

    if (window.BARK.markerManager && typeof window.BARK.markerManager.sync === 'function') {
        window.BARK.markerManager.sync(points);
    }

    if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
        window.BARK.invalidateMarkerVisibility();
    }

    const mapViewActive = typeof window.BARK.isMapVisibleByDefaultViewState !== 'function' || window.BARK.isMapVisibleByDefaultViewState();
    if (mapViewActive && !window.BARK._isZooming && typeof window.BARK.updateMarkers === 'function') {
        window.BARK.updateMarkers();
    } else if (typeof window.syncState === 'function') {
        window.BARK._pendingMarkerSync = true;
        window.syncState();
    }
}

function scheduleGuestMarkerRestore() {
    restoreGuestMarkerLayer();
    requestAnimationFrame(restoreGuestMarkerLayer);
    setTimeout(restoreGuestMarkerLayer, 250);
}

function resetLoggedOutRuntimeState() {
    window._cloudSettingsLoaded = false;
    window._leaderboardLoadedOnce = false;
    window._lastKnownLeaderboardRank = null;
    window._lastSyncedScore = -1;
    window._lastSyncedLeaderboardFingerprint = null;
    window._visitedPlacesServerSnapshotReceived = false;
    window._authoritativeProfileScoreSyncQueued = false;
    window.currentWalkPoints = 0;
    window.isAdmin = false;
    resetAdminUi();

    resetGuestSettingsToDefaults();
    resetMapStyleToDefault();
    resetSearchAndFilterState();
    resetVisitedAndPanelState();

    if (typeof window.BARK.resetTripPlannerRuntime === 'function') {
        window.BARK.resetTripPlannerRuntime();
    }
    if (typeof window.BARK.resetExpeditionRuntimeState === 'function') {
        window.BARK.resetExpeditionRuntimeState();
    }

    resetSavedRouteLists();
    resetMapViewToGuestDefault();

    scheduleGuestMarkerRestore();
    if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
}

function resetAccountScopedRuntimeState() {
    window._leaderboardLoadedOnce = false;
    window._lastKnownRank = null;
    window._lastKnownLeaderboardRank = null;
    window._lastLeaderboardDoc = null;
    window._lastSyncedScore = -1;
    window._lastSyncedLeaderboardFingerprint = null;
    window._visitedPlacesServerSnapshotReceived = false;
    window._authoritativeProfileScoreSyncQueued = false;
    window.currentWalkPoints = 0;
    window.isAdmin = false;
    resetAdminUi();
    resetVisitedAndPanelState();

    if (typeof window.BARK.resetTripPlannerRuntime === 'function') {
        window.BARK.resetTripPlannerRuntime();
    }
    if (typeof window.BARK.resetExpeditionRuntimeState === 'function') {
        window.BARK.resetExpeditionRuntimeState();
    }

    resetSavedRouteLists();
    if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
}

async function initFirebase() {
    if (typeof firebase === 'undefined') return;

    const loadSavedRoutes = window.BARK.loadSavedRoutes;

    try {
        firebase.initializeApp(window.BARK.firebaseConfig);
        await ensureLocalAuthPersistence();
    } catch (error) {
        console.error("[authService] initializeApp failed:", error);
        throw error;
    }

    // Bind the auth observer and Google button BEFORE awaiting the redirect
    // result so the UI is responsive while iOS Safari's getRedirectResult
    // resolves (or times out). When the redirect completes after this point,
    // the observer fires a second time with the signed-in user.
    bindGoogleSignInButton();

    try {
        firebase.auth().onAuthStateChanged((user) => {
            try {
                if (!Number.isFinite(Number(window._lastSyncedScore))) window._lastSyncedScore = -1;
                if (typeof window._lastSyncedLeaderboardFingerprint !== 'string') {
                    window._lastSyncedLeaderboardFingerprint = null;
                }
                window.isAdmin = false;
                window._serverPayloadSettled = false;
                window._firstServerPayloadReceived = false;
                window._lastKnownRank = null;
                window._lastKnownLeaderboardRank = null;
                window.currentWalkPoints = window.currentWalkPoints || 0;

                const loginContainer = document.getElementById('login-container');
                const offlineStatusContainer = document.getElementById('offline-status-container');
                const profileName = document.getElementById('user-profile-name');

                if (user) {
                    const previousAuthenticatedUid = lastAuthenticatedUid;
                    const isAuthenticatedUserChange = Boolean(previousAuthenticatedUid && previousAuthenticatedUid !== user.uid);

                    if (lastAuthenticatedUid !== user.uid) {
                        window._cloudSettingsLoaded = false;
                        resetPremiumEntitlement('auth-user-changed');
                    }
                    authenticatedSessionSeen = true;
                    lastAuthenticatedUid = user.uid;
                    window._serverPayloadSettled = false;
                    window._firstServerPayloadReceived = false;
                    window._lastSyncedScore = -1;

                    if (loginContainer) loginContainer.style.display = 'none';
                    if (offlineStatusContainer) offlineStatusContainer.style.display = 'block';
                    if (profileName) profileName.textContent = user.displayName || user.email || 'Bark Ranger';

                    stopUserSnapshotSubscription();
                    if (isAuthenticatedUserChange) {
                        stopVaultRepoVisitSubscription();
                        resetAccountScopedRuntimeState();
                    }

                    try {
                        startVaultRepoVisitSubscription(user);
                    } catch (error) {
                        console.error("[authService] subscribe visited places failed:", error);
                        showAuthFailureNotice('Sign-in connected, but visit sync could not start. Saved progress may be offline for this session.');
                    }

                    try {
                        window.BARK.incrementRequestCount();
                        userSnapshotUnsubscribe = firebase.firestore().collection('users').doc(user.uid)
                            .onSnapshot((doc) => {
                                try {
                                    const currentUser = firebase.auth().currentUser;
                                    if (!currentUser || currentUser.uid !== user.uid) return;

                                    if (!doc.metadata.fromCache && !window._firstServerPayloadReceived) {
                                        window._firstServerPayloadReceived = true;
                                        setTimeout(() => { window._serverPayloadSettled = true; }, 1000);
                                    }

                                    if (doc.exists) {
                                        const data = doc.data();

                                        updatePremiumEntitlement(data.entitlement, user, 'auth-user-snapshot');

                                        handleCloudSettingsHydration(data, doc.metadata);

                                        handleAdminCheck(data, user);

                                        // Streak & Walk Points
                                        const streakVal = data.streakCount || 0;
                                        let walkVal = data.walkPoints || 0;

                                        const streakLabel = document.getElementById('streak-count-label');
                                        if (streakLabel) streakLabel.textContent = streakVal;

                                        window.currentWalkPoints = Math.round(walkVal * 100) / 100;

                                        handleExpeditionSync(data);
                                    } else {
                                        updatePremiumEntitlement(null, user, 'auth-user-snapshot-missing');
                                        window.currentWalkPoints = 0;
                                        handleAdminCheck({}, user);
                                        handleExpeditionSync({});
                                    }
                                    refreshAuthSnapshotUi();
                                    maybeSyncAuthoritativeProfileScore('user-snapshot');

                                    if (!window._leaderboardLoadedOnce) {
                                        window._leaderboardLoadedOnce = true;
                                        if (typeof window.BARK.loadLeaderboard === 'function') window.BARK.loadLeaderboard();
                                    }

                                    window.dismissBarkLoader();
                                } catch (error) {
                                    console.error("[authService] user snapshot handling failed:", error);
                                    showAuthFailureNotice('Sign-in failed while syncing your account. Cloud sync and saved progress are offline for this session.');
                                }
                            }, (error) => {
                                console.error("[authService] user snapshot failed:", error);
                                showAuthFailureNotice('Sign-in connected, but account sync failed. Saved progress may be offline for this session.');
                            });
                    } catch (error) {
                        console.error("[authService] subscribe user document failed:", error);
                        showAuthFailureNotice('Sign-in connected, but account sync could not start. Saved progress may be offline for this session.');
                    }

                    if (typeof window.BARK.refreshSavedRoutesEntitlementState === 'function') {
                        window.BARK.refreshSavedRoutesEntitlementState(user.uid);
                    } else if (typeof loadSavedRoutes === 'function') {
                        loadSavedRoutes(user.uid);
                    }
                    refreshPremiumUiFromEntitlement('auth-signed-in');
                } else {
                    const shouldResetRuntime = authenticatedSessionSeen || lastAuthenticatedUid !== null;
                    authenticatedSessionSeen = false;
                    lastAuthenticatedUid = null;

                    stopUserSnapshotSubscription();
                    stopVaultRepoVisitSubscription();
                    resetPremiumEntitlement('auth-signed-out');

                    if (loginContainer) loginContainer.style.display = 'block';
                    if (offlineStatusContainer) offlineStatusContainer.style.display = 'none';

                    if (shouldResetRuntime) {
                        resetLoggedOutRuntimeState();
                    } else {
                        const vaultRepo = getVaultRepo();
                        if (vaultRepo && typeof vaultRepo.clear === 'function') {
                            vaultRepo.clear();
                        }
                        refreshVisitedCache('auth-no-session-visit-clear');
                        const firebaseService = window.BARK.services && window.BARK.services.firebase;
                        refreshVisitedVisuals('auth-no-session-visit-clear', firebaseService);
                        if (typeof window.BARK.clearActivePin === 'function') window.BARK.clearActivePin();
                        applyGuestZoomLimitDefault();
                        resetMapViewToGuestDefault();
                        window.syncState();
                        if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
                    }

                    window.dismissBarkLoader();
                    if (typeof window.BARK.loadLeaderboard === 'function') window.BARK.loadLeaderboard();

                    resetSavedRouteLists();

                    refreshPremiumUiFromEntitlement('auth-signed-out');
                }
            } catch (error) {
                console.error("[authService] auth state callback failed:", error);
                showAuthFailureNotice('Sign-in failed while syncing your account. Cloud sync and saved progress are offline for this session.');
            }
        });
    } catch (error) {
        console.error("[authService] onAuthStateChanged setup failed:", error);
        throw error;
    }

    // Process any pending signInWithRedirect. Runs at the end so the button
    // and auth observer above are already responsive while iOS Safari resolves
    // (or times out) the redirect handshake.
    await consumeGoogleRedirectResult();

    // Email Suggestion Template
    const emailSuggestBtn = document.getElementById('email-suggest-btn');
    if (emailSuggestBtn) {
        const subject = encodeURIComponent("B.A.R.K. Map: Suggest a New Place");
        const bodyTemplate = [
            "--- B.A.R.K. Ranger Map Suggestion ---",
            "Park Name:", "State:",
            "Swag Available (Tag/Bandana/Certificate/Other):",
            "Cost (Free/$$/Other):", "Park Entrance Fee:",
            "ADA Accessibility Areas:", "Useful Info / Rules:",
            "Official Website Link:", "",
            "--- IMPORTANT ---",
            "Please attach photos of the swag, the park entrance, or any relevant signage to help us verify this location! 🐾"
        ].join("\n");
        emailSuggestBtn.href = `mailto:usbarkrangers@gmail.com?subject=${subject}&body=${encodeURIComponent(bodyTemplate)}`;
    }
}

window.BARK.services.auth = {
    initFirebase,
    createGoogleProvider,
    ensureLocalAuthPersistence,
    isStandalonePwa,
    isIosStandalonePwa,
    shouldUseRedirectGoogleSignIn,
    signInWithGoogleProvider,
    consumeGoogleRedirectResult,
    requestGoogleAccountChooser
};
window.BARK.initFirebase = initFirebase;
