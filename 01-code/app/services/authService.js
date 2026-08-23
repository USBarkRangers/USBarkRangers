/**
 * authService.js - Firebase initialization and authentication lifecycle.
 * Phase 3 move-only extraction from dataService.js; hydration stays in place.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

let userSnapshotUnsubscribe = null;
let authenticatedSessionSeen = false;
let lastAuthenticatedUid = null;
let lastExpeditionSyncKey = null;

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

async function handleGoogleSignInClick(event = null) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (handleGoogleSignInClick.inFlight) return;
    handleGoogleSignInClick.inFlight = true;
    try {
        const forceAccountChooser = consumeGoogleAccountChooserRequest();
        const provider = createGoogleProvider({
            forceAccountChooser
        });
        if (typeof window.BARK.incrementRequestCount === 'function') {
            window.BARK.incrementRequestCount();
        }
        await signInWithGoogleProvider(provider, { forceAccountChooser });
    } catch (error) {
        console.error('[authService] Google sign-in failed:', error);
        alert('Login Error: ' + (error && error.message ? error.message : 'unknown error'));
    } finally {
        handleGoogleSignInClick.inFlight = false;
    }
}

function bindGoogleSignInButton() {
    const googleBtn = document.getElementById('google-login-btn');
    if (!googleBtn || googleBtn.dataset.barkGoogleSignInBound === 'true') return;
    googleBtn.dataset.barkGoogleSignInBound = 'true';
    // A single `click` handler only — mirrors the working JDD flow. iOS WKWebView
    // blocks the OAuth popup when signInWithPopup is triggered from touchend or
    // pointerup (surfaces as auth/network-request-failed in the standalone
    // home-screen app), and only allows it from a genuine click. The old
    // touchend/pointerup + delegated authCard bindings were what broke Google
    // sign-in in the installed app on the github.io origin.
    googleBtn.addEventListener('click', handleGoogleSignInClick);
}

function getEffectiveFirebaseConfig() {
    const config = { ...(window.BARK.firebaseConfig || {}) };
    window.BARK.effectiveFirebaseConfig = config;
    return config;
}

function isBenignGoogleSignInError(error) {
    const code = error && error.code ? String(error.code) : '';
    return code === 'auth/popup-closed-by-user'
        || code === 'auth/cancelled-popup-request'
        || code === 'auth/user-cancelled';
}

// iOS home-screen (standalone) web apps can't complete Firebase's popup/redirect
// OAuth: the popup can't open (it just reloads the app) and the firebaseapp.com
// auth-iframe handshake fails with auth/network-request-failed. Detect that mode
// and use Google Identity Services (accounts.google.com, no popup/iframe) to get
// an ID token, then sign in with a credential — verified working in standalone.
function isStandaloneDisplayMode() {
    if (typeof window === 'undefined') return false;
    if (window.navigator && window.navigator.standalone === true) return true;
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(display-mode: standalone)').matches;
}

// Firebase's auto-created Web OAuth client (has usbarkrangers.github.io +
// web.app + firebaseapp.com as authorized JS origins).
const GOOGLE_WEB_CLIENT_ID = '564465144962-m32aoi179l1gjcvqr2r143tm4t5br913.apps.googleusercontent.com';

let gisLoadPromise = null;
function loadGoogleIdentityServices() {
    if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
    if (gisLoadPromise) return gisLoadPromise;
    gisLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = () => { gisLoadPromise = null; reject(new Error('Could not load Google sign-in.')); };
        document.head.appendChild(s);
    });
    return gisLoadPromise;
}

let gisInitialized = false;
function initGoogleIdentityServices() {
    if (gisInitialized) return;
    gisInitialized = true;
    window.google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        use_fedcm_for_prompt: true,
        auto_select: false,
        callback: (response) => {
            if (!response || !response.credential) return;
            const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
            firebase.auth().signInWithCredential(credential)
                .then(() => { setGisSignInPending(false); })
                .catch((error) => {
                    // No scary alert. On a fresh-installed standalone app the very
                    // first attempt only establishes the Google session and can't
                    // hand the credential back to the isolated webview; the return
                    // handler re-prompts once the app is visible again and completes
                    // it silently. Log quietly for diagnostics.
                    console.warn('[authService] GIS credential deferred:', error && error.code);
                });
        }
    });
}

function clearGoogleOneTapCooldown() {
    // One Tap records a dismissal cooldown in the `g_state` cookie
    // (prompt's getNotDisplayedReason() becomes 'suppressed_by_user'), which
    // stops it reopening after the user closes it — up to ~24h. Clearing the
    // cookie before each prompt resets that, so every tap reopens the chooser.
    try {
        document.cookie = 'g_state=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
        document.cookie = 'g_state=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + location.hostname;
    } catch (e) { /* non-fatal */ }
}

// First sign-in on a fresh-installed standalone app has no Google session, so
// Google shows a full sign-in page. That establishes the session but can't return
// the credential to the isolated webview (the first attempt "fails"). Rather than
// show an error, we remember the attempt and, when the app becomes visible again
// (returning from Google's sign-in), silently re-prompt — a session now exists, so
// One Tap completes instantly. Net effect: one tap, sign-in finishes on return.
let gisSignInPending = false;
let gisAutoRetries = 0;
const GIS_MAX_AUTO_RETRIES = 1;

function setGisSignInPending(pending) {
    gisSignInPending = pending;
    try {
        if (pending) localStorage.setItem('bark_gis_pending', String(Date.now()));
        else localStorage.removeItem('bark_gis_pending');
    } catch (e) { /* non-fatal */ }
}

function maybeCompletePendingGisSignIn() {
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    if (firebase.auth().currentUser) { setGisSignInPending(false); gisAutoRetries = 0; return; }
    if (!gisSignInPending || gisAutoRetries >= GIS_MAX_AUTO_RETRIES) return;
    if (!(window.google && window.google.accounts && window.google.accounts.id)) return;
    gisAutoRetries += 1;
    clearGoogleOneTapCooldown();
    try { window.google.accounts.id.prompt(); } catch (e) { /* non-fatal */ }
}

let gisReturnHandlerBound = false;
function ensureGisReturnHandler() {
    if (gisReturnHandlerBound || typeof document === 'undefined') return;
    gisReturnHandlerBound = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') setTimeout(maybeCompletePendingGisSignIn, 500);
    });
}

// Backup for the reload case: if the app reloaded mid first-time sign-in, finish it
// once on boot. Clears the persisted flag immediately so it only gets one shot.
function resumePendingGisSignInOnBoot() {
    let ts = 0;
    try { ts = Number(localStorage.getItem('bark_gis_pending') || 0); } catch (e) {}
    setGisSignInPending(false);
    if (!ts || (Date.now() - ts) > 180000) return;
    if (firebase.auth().currentUser) return;
    gisSignInPending = true;
    gisAutoRetries = 0;
    setTimeout(maybeCompletePendingGisSignIn, 900);
}

async function signInWithGoogleGIS() {
    await loadGoogleIdentityServices();
    initGoogleIdentityServices();
    ensureGisReturnHandler();
    clearGoogleOneTapCooldown();
    gisAutoRetries = 0;
    setGisSignInPending(true);
    window.google.accounts.id.prompt();
}

// --- Standalone "switch / add account" via top-level OIDC redirect ---
// One Tap only offers accounts already in the webview's Google session, so in a
// standalone PWA it can't switch to or add a different account, and a popup-based
// chooser just reloads the webview. Proven on-device: after "Switch account" the
// One Tap prompt DOES display, but only for the account already signed in.
//
// A full-page redirect straight to Google (NOT through firebaseapp.com, which is
// what breaks Firebase's signInWithRedirect here) shows Google's real account
// chooser with prompt=select_account. Google returns an OIDC ID token in the URL
// fragment; on the way back we exchange it for a Firebase credential. No popup,
// no iframe, so it survives the standalone webview.
const GOOGLE_OIDC_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_REDIRECT_STATE_KEY = 'bark_google_redirect';

// Must EXACTLY match an "Authorized redirect URI" on the Web OAuth client
// (GOOGLE_WEB_CLIENT_ID). Derived from the running origin so beta and production
// each use their own registered URI. The URL fragment is ignored for matching.
function getGoogleRedirectUri() {
    return location.origin + location.pathname.replace(/index\.html?$/i, '');
}

function randomHexToken() {
    const bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function startGoogleRedirectSignIn() {
    const state = randomHexToken();
    const nonce = randomHexToken();
    try {
        localStorage.setItem(GOOGLE_REDIRECT_STATE_KEY, JSON.stringify({ state, ts: Date.now() }));
    } catch (e) { /* non-fatal */ }
    const params = new URLSearchParams({
        client_id: GOOGLE_WEB_CLIENT_ID,
        response_type: 'id_token',
        scope: 'openid email profile',
        redirect_uri: getGoogleRedirectUri(),
        nonce,
        state,
        prompt: 'select_account'
    });
    window.location.assign(GOOGLE_OIDC_AUTH_ENDPOINT + '?' + params.toString());
}

// Called on boot: if we're returning from the redirect above, the fragment holds
// the ID token. Validate the anti-CSRF state, scrub the URL, and sign in.
async function maybeCompleteGoogleRedirectSignIn() {
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    const hash = window.location.hash ? window.location.hash.slice(1) : '';
    if (!hash) return;
    const frag = new URLSearchParams(hash);
    const idToken = frag.get('id_token');
    const returnedState = frag.get('state');
    const errorParam = frag.get('error');
    if (!idToken && !errorParam) return; // not our redirect

    let expectedState = null;
    try {
        const raw = localStorage.getItem(GOOGLE_REDIRECT_STATE_KEY);
        if (raw) expectedState = (JSON.parse(raw) || {}).state;
        localStorage.removeItem(GOOGLE_REDIRECT_STATE_KEY);
    } catch (e) { /* non-fatal */ }
    try {
        history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* non-fatal */ }

    if (errorParam) {
        console.warn('[authService] Google redirect sign-in error:', errorParam);
        return;
    }
    if (!expectedState || returnedState !== expectedState) {
        console.warn('[authService] Google redirect state mismatch; ignoring token.');
        return;
    }

    try {
        const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
        await firebase.auth().signInWithCredential(credential);
    } catch (error) {
        console.error('[authService] Google redirect signInWithCredential failed:', error);
    }
}

async function signInWithGoogleProvider(provider, options = {}) {
    const auth = firebase.auth();

    if (isStandaloneDisplayMode()) {
        // "Switch account" needs a real chooser, which One Tap can't give in
        // standalone — send the user to Google's full account picker via redirect.
        if (options.forceAccountChooser === true) {
            startGoogleRedirectSignIn();
            return;
        }
        await signInWithGoogleGIS();
        return;
    }

    try {
        await auth.signInWithPopup(provider);
    } catch (error) {
        if (isBenignGoogleSignInError(error)) return;
        throw error;
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

function getExpeditionSyncKey(data = {}) {
    const expedition = data.virtual_expedition && typeof data.virtual_expedition === 'object'
        ? data.virtual_expedition
        : {};
    const completed = Array.isArray(data.completed_expeditions)
        ? data.completed_expeditions
        : (Array.isArray(data.completedExpeditions) ? data.completedExpeditions : []);

    // Firestore can emit cache/server/metadata snapshots with identical user
    // data. Only fields consumed by the expedition UI belong in this key.
    return JSON.stringify({
        activeTrail: expedition.active_trail || null,
        trailName: expedition.trail_name || null,
        milesLogged: Number(expedition.miles_logged) || 0,
        trailMiles: Number(expedition.trail_total_miles) || 0,
        history: Array.isArray(expedition.history) ? expedition.history : [],
        lifetimeMiles: Number(data.lifetime_miles) || 0,
        completed
    });
}

function handleExpeditionSync(data = {}) {
    const syncKey = getExpeditionSyncKey(data);
    if (syncKey === lastExpeditionSyncKey) return false;
    lastExpeditionSyncKey = syncKey;

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
                if (claimBtn) claimBtn.textContent = '🎁 Claim +1 PT & Reset';
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
        return true;
    } catch (error) {
        lastExpeditionSyncKey = null;
        console.error("[authService] expedition sync failed:", error);
        return false;
    }
}

function refreshActivePinVisitedButton() {
    if (!window.BARK.activePinMarker || !window.BARK.activePinMarker._parkData || !document.getElementById('mark-visited-btn')) return;

    const d = window.BARK.activePinMarker._parkData;
    const btn = document.getElementById('mark-visited-btn');
    const btnText = document.getElementById('mark-visited-text');
    const vaultRepo = getVaultRepo();
    const isVisited = typeof window.BARK.isParkVisited === 'function'
        ? window.BARK.isParkVisited(d)
        : hasAuthVisitedPlace(d);
    const isPendingSync = vaultRepo
        && typeof vaultRepo.hasPendingMutation === 'function'
        && vaultRepo.hasPendingMutation(d);

    if (isVisited) {
        btn.classList.add('visited');
        btn.classList.toggle('pending-sync', Boolean(isPendingSync));
        if (btnText) btnText.textContent = isPendingSync ? '✓ Visited (syncing…)' : '✓ Visited';
    } else {
        btn.classList.remove('visited');
        btn.classList.remove('pending-sync');
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
                const checkinService = window.BARK.services && window.BARK.services.checkin;
                const currentUser = firebaseRef && firebaseRef.auth ? firebaseRef.auth().currentUser : null;
                if (currentUser && checkinService && typeof checkinService.reconcileUnconfirmedVisits === 'function') {
                    checkinService.reconcileUnconfirmedVisits(currentUser.uid);
                }
                if (checkinService && typeof checkinService.notifyAuthoritativeSnapshot === 'function') {
                    checkinService.notifyAuthoritativeSnapshot();
                }
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

function reconcileVaultRepoFromUserSnapshot(user, data, metadata = {}) {
    const vaultRepo = getVaultRepo();
    if (!user || !vaultRepo || typeof vaultRepo.reconcileSnapshot !== 'function') return false;

    const normalizedMetadata = {
        fromCache: metadata && metadata.fromCache === true,
        hasPendingWrites: metadata && metadata.hasPendingWrites === true
    };
    const placeList = data && Array.isArray(data.visitedPlaces) ? data.visitedPlaces : [];
    const options = buildVaultRepoSubscriptionOptions();

    try {
        const result = vaultRepo.reconcileSnapshot(placeList, normalizedMetadata);

        if (typeof options.invalidateVisitedIdsCache === 'function') options.invalidateVisitedIdsCache();
        if (typeof options.refreshVisitedVisualState === 'function') options.refreshVisitedVisualState();

        if (typeof options.normalizeLocalVisitedPlacesToCanonical === 'function') {
            const canonicalResult = options.normalizeLocalVisitedPlacesToCanonical({
                writeBack: false,
                source: 'user-snapshot'
            });
            if (canonicalResult && typeof canonicalResult.catch === 'function') {
                canonicalResult.catch(error => {
                    console.error('[authService] visited-place canonicalization failed:', error);
                });
            }
        }

        if (typeof options.onChange === 'function') {
            options.onChange(Object.freeze({
                uid: user.uid,
                result,
                metadata: Object.freeze({ ...normalizedMetadata })
            }));
        }

        return true;
    } catch (error) {
        if (typeof options.onError === 'function') {
            options.onError(error);
        } else {
            console.error('[authService] visitedPlaces user snapshot reconcile failed:', error);
        }
        return false;
    }
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
    const checkinService = window.BARK.services && window.BARK.services.checkin;
    if (checkinService && typeof checkinService.cancelPendingServerConfirmations === 'function') {
        checkinService.cancelPendingServerConfirmations('subscription-stopped');
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
    // Leaderboard session state is owned by leaderboardEngine.js; one call clears
    // all of it, so adding a field there needs no change here.
    if (typeof window.BARK.resetLeaderboardState === 'function') {
        window.BARK.resetLeaderboardState();
    }
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

    // Clear the per-user achievement cache so a signed-out session can't reuse
    // the previous user's earned achievements/timestamps.
    if (window.gamificationEngine && typeof window.gamificationEngine.resetSession === 'function') {
        window.gamificationEngine.resetSession();
    }

    scheduleGuestMarkerRestore();
    if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
}

function resetAccountScopedRuntimeState() {
    // _lastKnownRank is the profile TITLE ("Trail Blazer"), owned by profileEngine —
    // not the leaderboard rank, which resetLeaderboardState() handles.
    window._lastKnownRank = null;
    if (typeof window.BARK.resetLeaderboardState === 'function') {
        window.BARK.resetLeaderboardState();
    }
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

    // Clear the per-user achievement cache on account switch so the incoming
    // user never sees the previous user's earned achievements/timestamps.
    if (window.gamificationEngine && typeof window.gamificationEngine.resetSession === 'function') {
        window.gamificationEngine.resetSession();
    }

    if (typeof window.BARK.updateStatsUI === 'function') window.BARK.updateStatsUI();
}

async function initFirebase() {
    if (typeof firebase === 'undefined') return;

    const loadSavedRoutes = window.BARK.loadSavedRoutes;

    try {
        firebase.initializeApp(getEffectiveFirebaseConfig());
        await ensureLocalAuthPersistence();
    } catch (error) {
        console.error("[authService] initializeApp failed:", error);
        throw error;
    }

    // If we just came back from the standalone switch-account redirect, the ID
    // token is waiting in the URL fragment — complete sign-in before anything else.
    maybeCompleteGoogleRedirectSignIn()
        .catch((error) => { console.warn('[authService] redirect completion skipped:', error); });

    // Bind the Google button before the auth observer finishes its first pass
    // so the account card is responsive even while Firebase restores state.
    bindGoogleSignInButton();

    // Pre-warm Google Identity Services in standalone mode. initialize() fetches
    // its One Tap config asynchronously; without this, the FIRST tap calls
    // prompt() before that settles and One Tap silently no-ops (the "first press
    // fails, second press works" symptom). Loading + initializing on boot means
    // the config is ready before the user taps.
    if (isStandaloneDisplayMode()) {
        loadGoogleIdentityServices()
            .then(() => {
                initGoogleIdentityServices();
                ensureGisReturnHandler();
                resumePendingGisSignInOnBoot();
            })
            .catch((error) => { console.warn('[authService] GIS pre-warm skipped:', error); });
    }

    try {
        firebase.auth().onAuthStateChanged((user) => {
            try {
                lastExpeditionSyncKey = null;
                window.isAdmin = false;
                window._serverPayloadSettled = false;
                window._firstServerPayloadReceived = false;
                window._lastKnownRank = null;

                // Rank is unknown until the leaderboard is re-read for whoever is now
                // signed in. leaderboardEngine owns the value; this is the public way
                // to clear it. (The old defensive normalisation of _lastSyncedScore /
                // _lastSyncedLeaderboardFingerprint is gone: the module now
                // initialises its own defaults.)
                if (typeof window.BARK.setCurrentLeaderboardRank === 'function') {
                    window.BARK.setCurrentLeaderboardRank(null);
                }
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
                    // (Removed: window._lastSyncedScore = -1. That value is written by
                    // the sync and never read as a gate — resyncing is decided by the
                    // fingerprint — so clearing it here did nothing. A genuine account
                    // change is handled by resetAccountScopedRuntimeState() below.)

                    if (loginContainer) loginContainer.style.display = 'none';
                    if (offlineStatusContainer) offlineStatusContainer.style.display = 'block';
                    if (profileName) profileName.textContent = user.displayName || user.email || 'Bark Ranger';

                    stopUserSnapshotSubscription();
                    if (isAuthenticatedUserChange) {
                        stopVaultRepoVisitSubscription();
                        resetAccountScopedRuntimeState();
                    }

                    const checkinService = window.BARK.services && window.BARK.services.checkin;
                    if (checkinService && typeof checkinService.replayUnconfirmedVisits === 'function') {
                        Promise.resolve(checkinService.replayUnconfirmedVisits(user.uid))
                            .catch(error => console.error('[authService] replayUnconfirmedVisits failed:', error));
                    }

                    try {
                        window.BARK.incrementRequestCount();
                        userSnapshotUnsubscribe = firebase.firestore().collection('users').doc(user.uid)
                            .onSnapshot({ includeMetadataChanges: true }, (doc) => {
                                try {
                                    const currentUser = firebase.auth().currentUser;
                                    if (!currentUser || currentUser.uid !== user.uid) return;

                                    if (!doc.metadata.fromCache && !window._firstServerPayloadReceived) {
                                        window._firstServerPayloadReceived = true;
                                        setTimeout(() => { window._serverPayloadSettled = true; }, 1000);
                                    }

                                    if (doc.exists) {
                                        const data = doc.data();

                                        reconcileVaultRepoFromUserSnapshot(user, data, doc.metadata);

                                        // Hand earned achievements to the engine from the
                                        // snapshot we already pay for, so the achievement
                                        // vault costs zero extra Firestore reads.
                                        if (window.gamificationEngine && typeof window.gamificationEngine.primeAchievementsFromUserDoc === 'function') {
                                            window.gamificationEngine.primeAchievementsFromUserDoc(user.uid, data);
                                        }

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
                                        reconcileVaultRepoFromUserSnapshot(user, {}, doc.metadata);
                                        updatePremiumEntitlement(null, user, 'auth-user-snapshot-missing');
                                        window.currentWalkPoints = 0;
                                        handleAdminCheck({}, user);
                                        handleExpeditionSync({});
                                    }
                                    refreshAuthSnapshotUi();
                                    maybeSyncAuthoritativeProfileScore('user-snapshot');

                                    // The engine owns the once-per-session guard now;
                                    // this snapshot handler can fire repeatedly.
                                    if (typeof window.BARK.loadLeaderboardOnce === 'function') {
                                        window.BARK.loadLeaderboardOnce();
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

    // Community feedback entry point. The dialog is the real path; the mailto
    // template below stays on the href as the fallback for a client where the
    // feedback modules did not load.
    const emailSuggestBtn = document.getElementById('email-suggest-btn');
    if (emailSuggestBtn) {
        emailSuggestBtn.onclick = (event) => {
            const feedback = window.BARK.feedback;
            if (!feedback || typeof feedback.open !== 'function') return;
            event.preventDefault();
            feedback.open({ source: 'profile-portal' });
        };

        const subject = "B.A.R.K. Map: Suggestion or App Improvement";
        const bodyTemplate = [
            "--- B.A.R.K. Ranger Map Suggestion ---", "",
            "Suggestion Type (Missing Location / App Improvement / Correction):", "",
            "--- Missing Location Details ---",
            "Park Name:", "State:",
            "Swag Available (Tag/Bandana/Certificate/Other):",
            "Cost (Free/$$/Other):", "Park Entrance Fee:",
            "ADA Accessibility Areas:", "Useful Info / Rules:",
            "Official Website Link:", "",
            "--- App Improvement Details ---",
            "What should we improve?",
            "What happened or what would you like to happen?",
            "Device/browser if relevant:", "",
            "--- IMPORTANT ---",
            "For missing locations, please attach photos of the swag, park entrance, or relevant signage if you have them."
        ].join("\n");
        const transport = window.BARK.feedbackTransport;
        emailSuggestBtn.href = transport
            ? transport.feedbackMailto(subject, bodyTemplate)
            : `mailto:support@usbarkrangersmap.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyTemplate)}`;
    }
}

window.BARK.services.auth = {
    initFirebase,
    createGoogleProvider,
    ensureLocalAuthPersistence,
    signInWithGoogleProvider,
    handleGoogleSignInClick,
    requestGoogleAccountChooser,
    getEffectiveFirebaseConfig,
    startGoogleRedirectSignIn,
    getGoogleRedirectUri,
    maybeCompleteGoogleRedirectSignIn
};
window.BARK.initFirebase = initFirebase;
