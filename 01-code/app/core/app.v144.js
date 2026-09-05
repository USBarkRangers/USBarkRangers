/**
 * app.js - B.A.R.K. Ranger Map Bootstrap Orchestrator
 * Owns boot order only. Feature logic lives in modules, engines, services, and state.
 */
(function () {
    window.BARK = window.BARK || {};

    const _bootErrors = [];
    const MAP_READY_TIMEOUT_MS = 5000;
    const FIREBASE_BOOT_WAIT_MS = 10000;
    let offlineNoticeDismissed = false;
    let authNoticeDismissed = false;

    window.BARK._bootErrors = _bootErrors;
    window.BARK.getBootErrors = function getBootErrors() {
        return _bootErrors.slice();
    };

    function bindMapUnavailableActions() {
        const refreshButton = document.getElementById('map-unavailable-refresh');
        if (!refreshButton || refreshButton.dataset.bound === 'true') return;

        refreshButton.dataset.bound = 'true';
        refreshButton.addEventListener('click', () => window.location.reload());
    }

    function bindAuthFailureActions() {
        const reloadButton = document.getElementById('auth-failure-reload');
        if (reloadButton && reloadButton.dataset.bound !== 'true') {
            reloadButton.dataset.bound = 'true';
            // Never wait for the wedged cloud queue or clear local storage.
            // The durable orange journals and last confirmed baseline rebuild
            // the same projection in the fresh page before retrying sync.
            reloadButton.addEventListener('click', () => window.location.reload());
        }

        const dismissButton = document.getElementById('auth-failure-dismiss');
        if (dismissButton && dismissButton.dataset.bound !== 'true') {
            dismissButton.dataset.bound = 'true';
            dismissButton.addEventListener('click', () => {
                const message = document.getElementById('auth-failure-message');
                if (!message) return;
                message.hidden = true;
                if (message.dataset.noticeKind === 'offline') offlineNoticeDismissed = true;
                else authNoticeDismissed = true;
            });
        }

        if (!window._barkOfflineNoticeBound && typeof window.addEventListener === 'function') {
            window._barkOfflineNoticeBound = true;
            window.addEventListener('offline', () => {
                showOfflineRecoveryNotice('Cloud features may not sync until service returns. Reload here if the app stays stuck.');
            });
            window.addEventListener('online', () => {
                hideOfflineRecoveryNotice({ resetDismissal: true });
            });
        }
    }

    function showAuthFailure(reason) {
        const message = document.getElementById('auth-failure-message');
        if (!message) return;

        bindAuthFailureActions();
        if (authNoticeDismissed) return;

        const title = document.getElementById('auth-failure-title');
        if (title) title.textContent = 'Sign-in unavailable';
        const dismissButton = document.getElementById('auth-failure-dismiss');
        if (dismissButton) dismissButton.setAttribute('aria-label', 'Dismiss sign-in warning');

        const detail = document.getElementById('auth-failure-detail');
        if (detail) {
            detail.textContent = reason || 'Cloud sync and saved progress are offline for this session.';
        }

        message.dataset.noticeKind = 'auth';
        message.hidden = false;
    }

    function showOfflineRecoveryNotice(reason) {
        const message = document.getElementById('auth-failure-message');
        if (!message) return;

        bindAuthFailureActions();
        if (offlineNoticeDismissed) return;
        if (!message.hidden && message.dataset.noticeKind === 'auth') return;

        const title = document.getElementById('auth-failure-title');
        if (title) title.textContent = 'You appear offline';
        const dismissButton = document.getElementById('auth-failure-dismiss');
        if (dismissButton) dismissButton.setAttribute('aria-label', 'Dismiss offline warning');
        const detail = document.getElementById('auth-failure-detail');
        if (detail) {
            detail.textContent = reason
                || 'Pending park changes stay saved on this device. Reload here to restart sync.';
        }

        message.dataset.noticeKind = 'offline';
        message.hidden = false;
    }

    function hideOfflineRecoveryNotice(options = {}) {
        if (options.resetDismissal === true) offlineNoticeDismissed = false;
        const message = document.getElementById('auth-failure-message');
        if (!message || message.dataset.noticeKind !== 'offline') return;
        message.hidden = true;
    }

    function assertSettingsStartupOrder() {
        const bootOrder = window.BARK.bootOrder || {};
        const barkStateReady = window.BARK.__barkStateReady === true;
        const settingsStoreReady = window.BARK.__settingsStoreReady === true;
        const reversed = Number.isFinite(bootOrder.barkStateParsedAt)
            && Number.isFinite(bootOrder.settingsStoreParsedAt)
            && bootOrder.settingsStoreParsedAt < bootOrder.barkStateParsedAt;

        // Phase -1 guardrail: barkState owns runtime defaults and must parse before
        // settingsStore hydrates/publishes persistent setting mirrors.
        if (!barkStateReady || !settingsStoreReady || reversed) {
            console.warn('[B.A.R.K. Boot] Settings startup order invariant failed. Expected barkState.js before settingsStore.js.', {
                barkStateReady,
                settingsStoreReady,
                bootOrder
            });
            _bootErrors.push('settingsStartupOrder');
        }
    }

    function dismissLoaderForMapFailure() {
        if (typeof window.dismissBarkLoader === 'function') {
            window.dismissBarkLoader();
            return;
        }

        const loader = document.getElementById('bark-loader');
        if (loader) loader.remove();
    }

    function getMapUnavailableDetail(reason) {
        if (reason === 'initMap-error') {
            return 'The map failed during startup. This is usually a blocked map library, CDN issue, or browser/network problem.';
        }
        if (reason === 'map-timeout') {
            return 'The map did not become ready in time. Refreshing usually retries the missing map resources.';
        }
        if (reason === 'boot-complete') {
            return 'The app finished booting, but no map instance was created.';
        }
        return 'The app could not start the map.';
    }

    function showMapUnavailable(reason) {
        const message = document.getElementById('map-unavailable-message');
        if (!message) return;

        bindMapUnavailableActions();

        const detail = document.getElementById('map-unavailable-detail');
        if (detail) detail.textContent = getMapUnavailableDetail(reason);

        message.hidden = false;
        message.dataset.reason = reason || 'unknown';
        document.body.classList.add('map-unavailable');
        dismissLoaderForMapFailure();
    }

    function hideMapUnavailable() {
        const message = document.getElementById('map-unavailable-message');
        if (message) {
            message.hidden = true;
            delete message.dataset.reason;
        }
        document.body.classList.remove('map-unavailable');
    }

    function checkMapAvailability(reason) {
        if (window.map) {
            hideMapUnavailable();
            return true;
        }

        showMapUnavailable(_bootErrors.includes('initMap') ? 'initMap-error' : reason);
        return false;
    }

    window.BARK.showMapUnavailable = showMapUnavailable;
    window.BARK.checkMapAvailability = checkMapAvailability;
    window.BARK.showAuthFailure = showAuthFailure;
    window.BARK.showOfflineRecoveryNotice = showOfflineRecoveryNotice;
    window.BARK.hideOfflineRecoveryNotice = hideOfflineRecoveryNotice;

    // async so it catches both synchronous throws and rejected Promises from init functions.
    async function callInit(name, label) {
        if (typeof window.BARK[name] !== 'function') return;
        try {
            await window.BARK[name]();
            if (label) console.log(`  ✓ ${label}`);
        } catch (err) {
            _bootErrors.push(name);
            console.error(`[B.A.R.K. Boot] "${name}" failed — this feature will be unavailable.`, err);
        }
    }

    /**
     * Firebase can remain pending for a long time when a phone reports that it
     * is online but its cellular connection cannot actually move data. Park
     * data is independent and has a local CSV cache, so it must not wait
     * forever behind cloud session restoration.
     *
     * This only bounds the boot dependency: Firebase keeps running after the
     * timeout and its normal auth/snapshot callbacks take over when service
     * recovers. Keeping the policy here makes the fallback easy to remove or
     * tune without coupling dataService to authentication internals.
     */
    async function initializeFirebaseForBoot() {
        const authService = window.BARK.services && window.BARK.services.auth;
        if (!authService || typeof authService.initFirebase !== 'function') {
            return { status: 'skipped' };
        }

        let timeoutId = null;
        const firebaseInit = Promise.resolve()
            .then(() => authService.initFirebase())
            .then(() => ({ status: 'ready' }))
            .catch(error => ({ status: 'error', error }));
        const bootTimeout = new Promise(resolve => {
            timeoutId = setTimeout(() => resolve({ status: 'timeout' }), FIREBASE_BOOT_WAIT_MS);
        });
        const result = await Promise.race([firebaseInit, bootTimeout]);

        if (result.status !== 'timeout' && timeoutId !== null) clearTimeout(timeoutId);

        if (result.status === 'timeout') {
            console.warn('[B.A.R.K. Boot] Firebase is still connecting after 10s; loading cached park data now.');
            firebaseInit.then(lateResult => {
                if (lateResult.status === 'ready') {
                    console.log('  ✓ Firebase initialized after cached map startup');
                    return;
                }
                _bootErrors.push('initFirebase');
                console.error('[B.A.R.K. Boot] "initFirebase" failed after cached map startup — auth and cloud sync unavailable.', lateResult.error);
                showAuthFailure('Sign-in failed during startup. Cloud sync and saved progress are offline for this session.');
            });
            return result;
        }

        if (result.status === 'error') {
            _bootErrors.push('initFirebase');
            console.error('[B.A.R.K. Boot] "initFirebase" failed — auth and cloud sync unavailable.', result.error);
            showAuthFailure('Sign-in failed during startup. Cloud sync and saved progress are offline for this session.');
            return result;
        }

        console.log('  ✓ Firebase initialized');
        return result;
    }


    // Display-only startup recovery. The network keeps its existing deadlines;
    // saved visits get an independent one-second grace period after parks exist.
    function createSavedVisitStartup() {
        let started = false;
        let timer = null;
        let unsubscribe = null;
        let rememberedUid = null;
        let restored = false;
        let cancelled = false;

        function checkin() { return window.BARK.services && window.BARK.services.checkin; }
        function currentUid() {
            try { return typeof firebase !== 'undefined' ? firebase.auth().currentUser?.uid || null : null; }
            catch (_error) { return null; }
        }
        function isAccountEligible() {
            if (cancelled || !rememberedUid) return false;
            const service = checkin();
            if (service?.getRememberedAuthenticatedVisitUid?.() !== rememberedUid) return false;
            const uid = currentUid();
            if (uid && uid !== rememberedUid) return false;
            if (window._authStateResolved === true && !uid) return false;
            return window.BARK.auth?.forceGoogleAccountChooserOnNextSignIn !== true;
        }
        function stopWaiting() {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            if (unsubscribe) unsubscribe();
            unsubscribe = null;
        }
        function restore() {
            if (restored || !isAccountEligible() || window._visitedPlacesServerSnapshotReceived === true) return false;
            const service = checkin();
            const storage = window.BARK.services && window.BARK.services.firebase;
            if (!service?.hydrateRememberedUnconfirmedVisits || !storage?.hydrateRememberedPendingVisitDeletions) return false;
            restored = true;
            stopWaiting();
            try {
                // Keep both overlays in the same synchronous turn, before the
                // browser can paint: baseline + pending adds, then pending deletes.
                service.hydrateRememberedUnconfirmedVisits();
                storage.hydrateRememberedPendingVisitDeletions(rememberedUid);
                return true;
            } catch (error) {
                console.warn('[B.A.R.K. Boot] Saved visits could not be restored; normal account recovery remains active.', error);
                return false;
            }
        }
        function start() {
            if (started) return;
            started = true;
            rememberedUid = checkin()?.getRememberedAuthenticatedVisitUid?.() || null;
            const parks = window.BARK.repos && window.BARK.repos.ParkRepo;
            if (!rememberedUid || !parks) return;
            function onParksReady() {
                if (timer !== null || restored || cancelled || !window.map || !parks.getAll().length) return;
                if (unsubscribe) unsubscribe();
                unsubscribe = null;
                timer = setTimeout(() => {
                    timer = null;
                    restore();
                }, 1000);
            }
            if (typeof parks.subscribe === 'function') unsubscribe = parks.subscribe(onParksReady);
            onParksReady();
        }
        function cancelForAccountAction() {
            cancelled = true;
            stopWaiting();
            // Preserve every account's baseline/journals, but stop a reload
            // during sign-out from choosing this account for pre-auth display.
            checkin()?.forgetAuthenticatedVisitUid?.();
        }
        document.addEventListener('click', event => {
            if (event.target?.closest?.('#account-signout-btn, #account-switch-btn')) cancelForAccountAction();
        }, true);
        return Object.freeze({ start, restore, isAccountEligible, cancelForAccountAction });
    }
    const savedVisitStartup = createSavedVisitStartup();
    window.BARK.savedVisitStartup = savedVisitStartup;

    // async so we can await each callInit and preserve boot order even for future async inits.
    document.addEventListener('DOMContentLoaded', async () => {
        console.log('B.A.R.K. Boot Sequence: Initializing...');
        bindMapUnavailableActions();
        bindAuthFailureActions();
        assertSettingsStartupOrder();

        const mapReadyTimeout = setTimeout(() => {
            if (!window.map) checkMapAvailability('map-timeout');
        }, MAP_READY_TIMEOUT_MS);

        // 1. Map must exist before data or UI bind to it
        await callInit('initMap', 'Map initialized');
        if (!window.map) {
            if (!_bootErrors.includes('initMap') && !_bootErrors.includes('initMapNoMap')) {
                _bootErrors.push('initMapNoMap');
                console.error('[B.A.R.K. Boot] "initMap" completed but window.map is unavailable — map feature unavailable.');
            }
            checkMapAvailability('boot-complete');
        }

        // 2. Trip overlay layer — must exist before initTripPlanner so the first
        //    updateTripUI() call has a sync target. No-ops cleanly if map failed.
        await callInit('initTripLayer', 'Trip overlay layer initialized');

        // 3. Controllers and UI
        await callInit('initSettings', 'Settings initialized');
        await callInit('initUI', 'UI initialized');
        await callInit('initSearchEngine', 'Search engine bound');
        await callInit('initTrailToggles', 'Trail toggles bound');
        await callInit('initSpinWheel', 'Spin wheel initialized');
        await callInit('initManualMiles', 'Manual miles initialized');
        await callInit('initTrailOverlays', 'Trail overlays initialized');
        await callInit('initWalkTracker', 'Walk tracker initialized');
        await callInit('initTripPlanner', 'Trip planner initialized');
        await callInit('initWatermarkTool', 'Watermark tool initialized');
        await callInit('initOfficialQRCode', 'Official QR initialized');
        await callInit('initCSVExport', 'Share engine initialized');
        await callInit('initFirstOpenDisclaimer', 'First-open disclaimer initialized');

        // 4. Park data is independent of cloud identity. Hydrate the local CSV
        //    before awaiting Firebase so cached pins and cards never sit behind
        //    a fake-cell handshake. Profile values remain in their truthful
        //    loading state until auth supplies an authoritative account.
        savedVisitStartup.start();
        try {
            if (typeof window.BARK.loadData === 'function') window.BARK.loadData();
        } catch (err) {
            _bootErrors.push('loadData');
            console.error('[B.A.R.K. Boot] "loadData" failed — map may be empty.', err);
        }

        // 5. Firebase still receives the same bounded ten-second startup wait,
        //    but it can no longer delay the cached public park catalog. Firebase
        //    itself is not cancelled and resumes normal auth/sync when usable
        //    service returns.
        const firebaseBootResult = await initializeFirebaseForBoot();

        // Keep the established offline Premium eligibility policy. Early visit
        // display never grants entitlement or supplies fresh server confirmation.
        if (window._authStateResolved !== true && savedVisitStartup.isAccountEligible()) {
            const authService = window.BARK.services && window.BARK.services.auth;
            if (firebaseBootResult.status === 'timeout'
                && typeof authService?.activateOfflinePremiumSession === 'function') {
                authService.activateOfflinePremiumSession();
            }
        }

        // 6. Deferred non-critical initializations
        if (typeof window.BARK.safePoll === 'function') {
            setTimeout(() => {
                try { window.BARK.safePoll(); }
                catch (err) { console.error('[B.A.R.K. Boot] "safePoll" failed.', err); }
            }, 2000);
        }

        if (typeof window.BARK.updateTripUI === 'function') {
            setTimeout(() => {
                try { window.BARK.updateTripUI(); }
                catch (err) { console.error('[B.A.R.K. Boot] "updateTripUI" failed.', err); }
            }, 500);
        }

        clearTimeout(mapReadyTimeout);
        checkMapAvailability('boot-complete');

        if (_bootErrors.length === 0) {
            console.log('✅ B.A.R.K. Boot Sequence: Complete');
        } else {
            console.warn(`⚠️ B.A.R.K. Boot Sequence: Complete with ${_bootErrors.length} error(s): [${_bootErrors.join(', ')}]`);
        }
    });
})();
