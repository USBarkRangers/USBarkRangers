/**
 * settingsController.js — Settings Modal, Toggles, Cloud Sync, Terminate & Reload
 * Loaded ELEVENTH in the boot sequence.
 */
window.BARK = window.BARK || {};

window.BARK.initSettings = function initSettings() {
    const settingsGearBtn = document.getElementById('settings-gear-btn');
    const settingsOverlay = document.getElementById('settings-overlay');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const standardToggle = document.getElementById('standard-cluster-toggle');
    const premiumToggle = document.getElementById('premium-cluster-toggle');
    const rememberMapToggle = document.getElementById('remember-map-toggle');
    const motionToggle = document.getElementById('reduce-motion-toggle');
    const ultraLowToggle = document.getElementById('ultra-low-toggle');
    const settingsStore = window.BARK.settings;
    const settingsRegistry = window.BARK.SETTINGS_REGISTRY || {};
    const performanceSettingKeys = window.BARK.PERFORMANCE_SETTING_KEYS || [];
    const CLOUD_AUTOSAVE_DELAY_MS = 500;
    const PREMIUM_ONLY_SETTINGS = new Set(['premiumClusteringEnabled']);
    let cloudAutosaveTimer = null;
    const standaloneStorageKeys = {
        ultraLowEnabled: 'barkUltraLowEnabled',
        rememberMapPosition: 'remember-map-toggle',
        startNationalView: 'barkNationalView',
        reducePinMotion: 'barkReducePinMotion'
    };
    const settingsScrollLock = {
        locked: false,
        scrollY: 0,
        activeView: null,
        activeViewScrollTop: 0,
        bodyStyles: null,
        activeViewStyles: null
    };

    const getPageScrollY = () => (
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0
    );

    const lockSettingsScroll = () => {
        if (settingsScrollLock.locked) return;

        const activeView = document.querySelector('.ui-view.active');
        const bodyStyle = document.body.style;

        settingsScrollLock.locked = true;
        settingsScrollLock.scrollY = getPageScrollY();
        settingsScrollLock.activeView = activeView;
        settingsScrollLock.activeViewScrollTop = activeView ? activeView.scrollTop : 0;
        settingsScrollLock.bodyStyles = {
            overflow: bodyStyle.overflow,
            position: bodyStyle.position,
            top: bodyStyle.top,
            left: bodyStyle.left,
            right: bodyStyle.right,
            width: bodyStyle.width
        };
        settingsScrollLock.activeViewStyles = activeView ? {
            overflowY: activeView.style.overflowY
        } : null;

        bodyStyle.overflow = 'hidden';
        bodyStyle.position = 'fixed';
        bodyStyle.top = `-${settingsScrollLock.scrollY}px`;
        bodyStyle.left = '0';
        bodyStyle.right = '0';
        bodyStyle.width = '100%';

        if (activeView) activeView.style.overflowY = 'hidden';
    };

    const restoreSettingsScroll = () => {
        if (!settingsScrollLock.locked) return;

        const bodyStyles = settingsScrollLock.bodyStyles || {};
        const activeView = settingsScrollLock.activeView;
        const activeViewStyles = settingsScrollLock.activeViewStyles || {};
        const restorePageY = settingsScrollLock.scrollY;
        const restoreActiveViewY = settingsScrollLock.activeViewScrollTop;

        Object.keys(bodyStyles).forEach((styleName) => {
            document.body.style[styleName] = bodyStyles[styleName];
        });

        if (activeView) {
            activeView.style.overflowY = activeViewStyles.overflowY || '';
            activeView.scrollTop = restoreActiveViewY;
        }

        window.scrollTo(0, restorePageY);

        settingsScrollLock.locked = false;
        settingsScrollLock.scrollY = 0;
        settingsScrollLock.activeView = null;
        settingsScrollLock.activeViewScrollTop = 0;
        settingsScrollLock.bodyStyles = null;
        settingsScrollLock.activeViewStyles = null;
    };

    const getStorageKeyForSetting = (key) => {
        if (settingsRegistry[key] && settingsRegistry[key].storageKey) return settingsRegistry[key].storageKey;
        return standaloneStorageKeys[key];
    };

    const isPremiumEntitlementActive = () => {
        const premiumService = window.BARK.services && window.BARK.services.premium;
        return Boolean(
            premiumService &&
            typeof premiumService.isPremium === 'function' &&
            premiumService.isPremium()
        );
    };

    const isPremiumOnlySettingLocked = (key) => (
        PREMIUM_ONLY_SETTINGS.has(key) && !isPremiumEntitlementActive()
    );

    const getAllowedSettingValue = (key, value) => (
        isPremiumOnlySettingLocked(key) ? false : value
    );

    const setSettingValue = (key, value) => {
        const allowedValue = getAllowedSettingValue(key, value);

        if (settingsStore && typeof settingsStore.set === 'function') {
            settingsStore.set(key, allowedValue);
            return allowedValue;
        }

        window[key] = allowedValue;
        const storageKey = getStorageKeyForSetting(key);
        if (storageKey) localStorage.setItem(storageKey, window[key] ? 'true' : 'false');
        return allowedValue;
    };

    const enforcePremiumOnlySettings = () => {
        PREMIUM_ONLY_SETTINGS.forEach((key) => {
            if (isPremiumOnlySettingLocked(key) && window[key]) {
                setSettingValue(key, false);
            }
        });
    };

    const buildCloudSettingsPayload = () => {
        enforcePremiumOnlySettings();
        const isPremium = isPremiumEntitlementActive();

        const settingsPayload = {
            rememberMapPosition: window.rememberMapPosition || false,
            startNationalView: window.startNationalView || false,
            ultraLowEnabled: window.ultraLowEnabled || false,
            mapStyle: isPremium ? (localStorage.getItem('barkMapStyle') || 'default') : 'default',
            visitedFilter: isPremium ? (localStorage.getItem('barkVisitedFilter') || 'all') : 'all',
            settingsUpdatedAt: Date.now()
        };

        Object.entries(settingsRegistry).forEach(([key, setting]) => {
            if (setting.cloudKey) {
                settingsPayload[setting.cloudKey] = isPremiumOnlySettingLocked(key) ? false : Boolean(window[key]);
            }
        });

        return settingsPayload;
    };

    window.BARK.buildCloudSettingsPayload = buildCloudSettingsPayload;

    const getCloudSettingsSaveContext = () => {
        const firebaseService = window.BARK.services && window.BARK.services.firebase;
        const firebaseReady = typeof firebase !== 'undefined' &&
            firebase.apps &&
            firebase.apps.length > 0 &&
            typeof firebase.auth === 'function';

        if (!firebaseReady || !firebaseService || typeof firebaseService.getCurrentUser !== 'function') {
            return null;
        }

        let currentUser = null;
        try {
            currentUser = firebaseService.getCurrentUser();
        } catch (error) {
            return null;
        }

        if (!currentUser || typeof firebaseService.saveUserSettings !== 'function') {
            return null;
        }

        return {
            firebaseService,
            currentUser,
            isPremium: isPremiumEntitlementActive()
        };
    };

    const openCloudSettingsPremiumPrompt = () => {
        const paywall = window.BARK && window.BARK.paywall;
        if (paywall && typeof paywall.openPaywall === 'function') {
            paywall.openPaywall({ source: 'cloud-settings-sync' });
            return;
        }

        alert('Cloud settings sync is a Premium feature. Local settings still save on this device.');
    };

    const saveSettingsToCloud = async () => {
        const context = getCloudSettingsSaveContext();
        if (!context) throw new Error('You must be logged in.');
        if (!context.isPremium) {
            const error = new Error('Cloud settings sync is a Premium feature.');
            error.code = 'premium-required';
            throw error;
        }

        clearTimeout(cloudAutosaveTimer);
        cloudAutosaveTimer = null;

        const settingsPayload = buildCloudSettingsPayload();
        console.log('[settingsController] saveSettingsToCloud: Payload being sent:', JSON.stringify(settingsPayload, null, 2));
        // Prevent cloud hydration from reverting local changes while save is in progress
        window._savingCloudSettingsRevision = settingsPayload.settingsUpdatedAt;
        try {
            console.log('[settingsController] About to call saveUserSettings...');
            await context.firebaseService.saveUserSettings(context.currentUser.uid, settingsPayload);
            console.log('[settingsController] saveUserSettings completed successfully');
            window._lastAppliedCloudSettingsRevision = settingsPayload.settingsUpdatedAt;
            window._cloudSettingsLoaded = true;
            // Clear the pending changes flag - cloud is now in sync with local
            window._pendingLocalSettingsChanges = false;
        } catch (error) {
            console.error('[settingsController] saveUserSettings failed:', error);
            throw error;
        } finally {
            // Clear the saving flag so hydration can resume
            window._savingCloudSettingsRevision = 0;
        }
        return settingsPayload;
    };

    const scheduleCloudSettingsAutosave = () => {
        const context = getCloudSettingsSaveContext();
        if (!context) return;

        if (!context.isPremium) {
            window._pendingLocalSettingsChanges = false;
            return;
        }

        // Mark that there are local changes pending save - this blocks hydration from overwriting them
        window._pendingLocalSettingsChanges = true;

        clearTimeout(cloudAutosaveTimer);
        cloudAutosaveTimer = setTimeout(() => {
            // If hydration is in progress, reschedule instead of saving
            if (window.BARK.isHydratingCloudSettings) {
                console.log('[settingsController] hydration in progress, rescheduling autosave');
                scheduleCloudSettingsAutosave();
                return;
            }
            const latestContext = getCloudSettingsSaveContext();
            if (!latestContext || !latestContext.isPremium) {
                window._pendingLocalSettingsChanges = false;
                return;
            }
            saveSettingsToCloud().catch(error => {
                console.error('[settingsController] cloud settings autosave failed:', error);
            });
        }, CLOUD_AUTOSAVE_DELAY_MS);
    };

    window.BARK.scheduleCloudSettingsAutosave = scheduleCloudSettingsAutosave;

    const syncCloudSettingsButton = () => {
        const saveSettingsBtn = document.getElementById('save-settings-cloud-btn');
        const cloudCopy = document.getElementById('save-settings-cloud-copy');
        if (!saveSettingsBtn) return;

        const context = getCloudSettingsSaveContext();
        const signedIn = Boolean(context && context.currentUser);
        const isPremium = Boolean(context && context.isPremium);

        if (isPremium) {
            saveSettingsBtn.textContent = '☁️ Save Settings to Cloud';
            saveSettingsBtn.dataset.mode = 'premium';
            saveSettingsBtn.title = 'Sync these settings to your Premium account.';
            if (cloudCopy) cloudCopy.textContent = 'Syncs your current preferences across all devices.';
            return;
        }

        saveSettingsBtn.textContent = signedIn ? '☁️ Premium Cloud Sync' : '☁️ Sign In for Cloud Sync';
        saveSettingsBtn.dataset.mode = signedIn ? 'free' : 'signed-out';
        saveSettingsBtn.title = signedIn
            ? 'Cloud settings sync is a Premium feature.'
            : 'Sign in before upgrading to cloud settings sync.';
        if (cloudCopy) {
            cloudCopy.textContent = signedIn
                ? 'Local settings save automatically on this device. Cloud settings sync is a Premium feature.'
                : 'Local settings save automatically on this device. Sign in to attach Premium cloud sync to your account.';
        }
    };

    const syncRegisteredControls = () => {
        enforcePremiumOnlySettings();

        const lowGraphicsActive = Boolean(window.lowGfxEnabled);
        const lowGraphicsPreset = window.BARK.LOW_GRAPHICS_PRESET || {};
        Object.keys(settingsRegistry).forEach((key) => {
            const setting = settingsRegistry[key];
            if (!setting) return;

            const input = document.getElementById(setting.elementId);
            const row = input ? input.closest('[data-setting-key]') : null;
            if (!input) return;

            const locked = isPremiumOnlySettingLocked(key);
            input.checked = locked ? false : Boolean(window[key]);
            input.disabled = locked || (lowGraphicsActive && !setting.master && Object.prototype.hasOwnProperty.call(lowGraphicsPreset, key));
            input.setAttribute('aria-disabled', input.disabled ? 'true' : 'false');
            if (row) row.style.opacity = input.disabled ? '0.62' : '1';
        });
        syncClusterToggles();
    };

    const renderPerformanceSettings = () => {
        const masterContainer = document.getElementById('performance-settings-master');
        const container = document.getElementById('performance-settings-registry');
        if (!container || container.dataset.rendered === 'true') return;

        const renderRows = (keys) => keys.map((key) => {
            const setting = settingsRegistry[key];
            if (!setting) return '';

            const rowStyle = setting.master
                ? 'display: flex; justify-content: space-between; align-items: flex-start; gap: 15px; background: rgba(33, 150, 243, 0.06); padding: 10px; border-radius: 8px; border: 1px solid rgba(33, 150, 243, 0.14);'
                : 'display: flex; justify-content: space-between; align-items: flex-start; gap: 15px;';

            return `
                <div data-setting-key="${key}" style="${rowStyle}">
                    <div style="flex: 1;">
                        <div style="font-size: 15px; font-weight: 800; color: #1e293b;">${setting.label}</div>
                        <div style="font-size: 12px; color: #64748b; font-weight: 500; margin-top: 4px; line-height: 1.4;">${setting.description}</div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" id="${setting.elementId}">
                        <span class="slider round"></span>
                    </label>
                </div>
            `;
        }).join('');

        if (masterContainer) {
            masterContainer.innerHTML = renderRows(performanceSettingKeys.filter((key) => settingsRegistry[key] && settingsRegistry[key].master));
        }
        container.innerHTML = renderRows(performanceSettingKeys.filter((key) => settingsRegistry[key] && !settingsRegistry[key].master));
        container.dataset.rendered = 'true';
    };

    const refreshTrailRendering = () => {
        if (window.lastActiveTrailId && typeof window.BARK.renderVirtualTrailOverlay === 'function') {
            window.BARK.renderVirtualTrailOverlay(window.lastActiveTrailId, window.lastMilesCompleted || 0);
        }
        const firebaseService = window.BARK.services && window.BARK.services.firebase;
        if (
            typeof window.BARK.renderCompletedTrailsOverlay === 'function' &&
            firebaseService &&
            typeof firebaseService.getCurrentUser === 'function' &&
            typeof firebaseService.getCompletedExpeditions === 'function'
        ) {
            const user = firebaseService.getCurrentUser();
            if (user) {
                firebaseService.getCompletedExpeditions(user.uid)
                    .then((completedExpeditions) => {
                        window.BARK.renderCompletedTrailsOverlay(completedExpeditions);
                    })
                    .catch((error) => {
                        console.error("[settingsController] refresh completed trails failed:", error);
                    });
            }
        }
    };

    const applyGestureSettings = () => {
        if (!window.map) return;
        if (window.lockMapPanning) window.map.dragging.disable();
        else window.map.dragging.enable();

        if (window.map.touchZoom) {
            if (window.disablePinchZoom) window.map.touchZoom.disable();
            else window.map.touchZoom.enable();
        }
    };

    let effectFrame = null;
    const pendingImpacts = new Set();
    const scheduleRegistrySettingEffects = (setting) => {
        if (!setting) return;
        pendingImpacts.add(setting.impact);
        if (effectFrame) return;

        effectFrame = requestAnimationFrame(() => {
            effectFrame = null;
            const impacts = new Set(pendingImpacts);
            pendingImpacts.clear();

            if (typeof window.BARK.applyGlobalStyles === 'function') window.BARK.applyGlobalStyles();
            if (impacts.has(window.BARK.SETTING_IMPACTS.MAP_GESTURE)) applyGestureSettings();
            if (impacts.has(window.BARK.SETTING_IMPACTS.MAP_BEHAVIOR) && typeof window.BARK.applyMapPerformancePolicy === 'function') {
                window.BARK.applyMapPerformancePolicy();
            }
            const mapViewActive = typeof window.BARK.isMapVisibleByDefaultViewState !== 'function' || window.BARK.isMapVisibleByDefaultViewState();
            if (impacts.has(window.BARK.SETTING_IMPACTS.MARKER_LAYER) && mapViewActive && typeof window.BARK.rebuildMarkerLayer === 'function') {
                window.BARK.rebuildMarkerLayer();
            } else if (impacts.has(window.BARK.SETTING_IMPACTS.MARKER_LAYER) && typeof window.BARK.invalidateMarkerVisibility === 'function') {
                window.BARK.invalidateMarkerVisibility();
            }
            if (impacts.has(window.BARK.SETTING_IMPACTS.TRAIL_RENDER)) {
                refreshTrailRendering();
            }
            if (typeof window.syncState === 'function') window.syncState();
        });
    };

    const setupRegistryToggles = () => {
        Object.keys(settingsRegistry).forEach((key) => {
            const setting = settingsRegistry[key];
            const input = setting ? document.getElementById(setting.elementId) : null;
            if (!setting || !input || input.dataset.bound === 'true') return;

            input.dataset.bound = 'true';
            input.checked = Boolean(window[key]);
            input.addEventListener('change', (e) => {
                const requestedValue = e.target.checked;
                const appliedValue = setSettingValue(key, requestedValue);
                if (appliedValue !== requestedValue) {
                    syncRegisteredControls();
                }
                if (!settingsStore || typeof settingsStore.set !== 'function') {
                    scheduleRegistrySettingEffects(setting);
                }
            });

            if (settingsStore && typeof settingsStore.onChange === 'function') {
                settingsStore.onChange(key, () => {
                    syncRegisteredControls();
                    scheduleRegistrySettingEffects(setting);
                    scheduleCloudSettingsAutosave();
                });
            }
        });

        syncRegisteredControls();
    };

    window.BARK.syncSettingsControls = function syncSettingsControls() {
        syncRegisteredControls();
        syncCloudSettingsButton();
    };

    const syncClusterToggles = () => {
        const lowGraphicsActive = Boolean(window.lowGfxEnabled);
        const preset = window.BARK.LOW_GRAPHICS_PRESET || {};
        const standardRow = standardToggle ? standardToggle.closest('[data-cluster-setting]') : null;
        const premiumRow = premiumToggle ? premiumToggle.closest('[data-cluster-setting]') : null;
        const premiumLocked = isPremiumOnlySettingLocked('premiumClusteringEnabled');

        if (standardToggle) {
            standardToggle.checked = lowGraphicsActive ? preset.standardClusteringEnabled === true : window.standardClusteringEnabled;
            standardToggle.disabled = lowGraphicsActive;
            standardToggle.setAttribute('aria-disabled', standardToggle.disabled ? 'true' : 'false');
        }
        if (premiumToggle) {
            premiumToggle.checked = premiumLocked ? false : (lowGraphicsActive ? preset.premiumClusteringEnabled === true : window.premiumClusteringEnabled);
            premiumToggle.disabled = premiumLocked || lowGraphicsActive;
            premiumToggle.setAttribute('aria-disabled', premiumToggle.disabled ? 'true' : 'false');
        }
        if (standardRow) standardRow.style.opacity = lowGraphicsActive ? '0.62' : '1';
        if (premiumRow) premiumRow.style.opacity = (premiumLocked || lowGraphicsActive) ? '0.62' : '1';
    };

    const subscribePremiumSettingsState = () => {
        const premiumService = window.BARK.services && window.BARK.services.premium;
        if (!premiumService || typeof premiumService.subscribe !== 'function') return;
        premiumService.subscribe(() => {
            enforcePremiumOnlySettings();
            syncRegisteredControls();
            syncCloudSettingsButton();
        });
    };

    if (settingsGearBtn && settingsOverlay) {
        renderPerformanceSettings();
        setupRegistryToggles();
        subscribePremiumSettingsState();

        // Sync visuals to state
        if (rememberMapToggle) rememberMapToggle.checked = window.rememberMapPosition;
        if (motionToggle) motionToggle.checked = window.reducePinMotion;
        if (ultraLowToggle) ultraLowToggle.checked = window.ultraLowEnabled;

        const versionLabel = document.getElementById('settings-app-version');
        if (versionLabel) versionLabel.textContent = window.BARK.APP_VERSION;

        settingsGearBtn.addEventListener('click', () => {
            settingsOverlay.classList.add('active');
            lockSettingsScroll();
        });

        const closeSettings = () => {
            settingsOverlay.classList.remove('active');
            restoreSettingsScroll();
        };

        window.BARK.closeSettingsModal = closeSettings;

        if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
        const bindDismissableOverlay = window.BARK.DOM && window.BARK.DOM.bindDismissableOverlay;
        if (typeof bindDismissableOverlay === 'function') {
            bindDismissableOverlay({
                overlay: settingsOverlay,
                surface: '#settings-modal',
                onDismiss: closeSettings
            });
        } else {
            settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });
        }

        if (motionToggle) {
            motionToggle.checked = window.reducePinMotion;
            motionToggle.addEventListener('change', (e) => {
                const newVal = e.target.checked;
                if (newVal !== window.reducePinMotion) {
                    const msg = newVal
                        ? "Enabling Reduced Pin Resizing requires a page reload. Proceed?"
                        : "Restoring full pin animations requires a page reload. Proceed?";
                    if (window.confirm(msg)) {
                        setSettingValue('reducePinMotion', newVal);
                        scheduleCloudSettingsAutosave();
                        location.reload();
                    } else {
                        e.target.checked = window.reducePinMotion;
                    }
                }
            });
        }

        const reloadAfterUltraLowChange = () => {
            sessionStorage.setItem('skipCloudHydration', 'true');
            setTimeout(() => window.location.reload(true), 150);
        };

        const saveUltraLowBeforeReload = async () => {
            const context = getCloudSettingsSaveContext();
            if (!context || !context.isPremium) return;

            window._pendingLocalSettingsChanges = true;
            await saveSettingsToCloud();
        };

        // Ultra Low Toggle
        if (ultraLowToggle) {
            ultraLowToggle.addEventListener('change', async (e) => {
                const isEnabled = e.target.checked;
                const msg = isEnabled ?
                    "⚠️ ENABLE ULTRA-LOW GRAPHICS?\n\nThis will disable all animations and effects.\nPage will reload." :
                    "Switching to High Graphics requires a page reload. Proceed?";
                if (!window.confirm(msg)) { e.target.checked = !isEnabled; return; }

                setSettingValue('ultraLowEnabled', isEnabled);
                ultraLowToggle.disabled = true;

                try {
                    await saveUltraLowBeforeReload();
                } catch (error) {
                    console.warn('[settingsController] Ultra Low cloud save failed before reload; preserving local setting.', error);
                } finally {
                    reloadAfterUltraLowChange();
                }
            });
        }

        const nationalViewToggle = document.getElementById('national-view-toggle');
        if (rememberMapToggle) {
            rememberMapToggle.addEventListener('change', (e) => {
                setSettingValue('rememberMapPosition', e.target.checked);
                scheduleCloudSettingsAutosave();
                if (window.rememberMapPosition && nationalViewToggle) {
                    nationalViewToggle.checked = false;
                    setSettingValue('startNationalView', false);
                    scheduleCloudSettingsAutosave();
                }
            });
        }

        if (nationalViewToggle) {
            nationalViewToggle.checked = window.startNationalView;
            nationalViewToggle.addEventListener('change', (e) => {
                setSettingValue('startNationalView', e.target.checked);
                scheduleCloudSettingsAutosave();
                if (window.startNationalView && rememberMapToggle) {
                    rememberMapToggle.checked = false;
                    setSettingValue('rememberMapPosition', false);
                    scheduleCloudSettingsAutosave();
                }
            });
        }

        // ☢️ TERMINATE & RELOAD
        const terminateBtn = document.getElementById('terminate-reload-btn');
        if (terminateBtn) {
            terminateBtn.addEventListener('click', async () => {
                const proceed = window.confirm("☢️ WARNING: NUCLEAR OPTION ☢️\n\nThis will wipe all local app memory and log you out.\nCloud data remains safe.\n\nProceed?");
                if (proceed) {
                    terminateBtn.textContent = 'TERMINATING...';
                    terminateBtn.style.opacity = '0.5';
                    terminateBtn.disabled = true;
                    try {
                        if (typeof firebase !== 'undefined' && firebase.auth().currentUser && typeof window.BARK.syncUserProgress === 'function') await window.BARK.syncUserProgress();
                        if (typeof firebase !== 'undefined' && firebase.auth().currentUser) await firebase.auth().signOut();
                    } catch (e) { console.error("Non-fatal error during termination", e); }
                    localStorage.clear();
                    window.location.reload(true);
                }
            });
        }

        // ☁️ SAVE SETTINGS TO CLOUD
        const saveSettingsBtn = document.getElementById('save-settings-cloud-btn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', async () => {
                if (!getCloudSettingsSaveContext()) {
                    alert("You must be logged in.");
                    return;
                }

                const originalText = saveSettingsBtn.innerHTML;
                saveSettingsBtn.innerHTML = '⏳ SAVING...';
                saveSettingsBtn.disabled = true;

                try {
                    await saveSettingsToCloud();
                    saveSettingsBtn.innerHTML = '✅ SAVED TO CLOUD';
                    setTimeout(() => { saveSettingsBtn.innerHTML = originalText; saveSettingsBtn.disabled = false; }, 2000);
                } catch (error) {
                    if (error && error.code === 'premium-required') {
                        openCloudSettingsPremiumPrompt();
                        saveSettingsBtn.innerHTML = originalText;
                        saveSettingsBtn.disabled = false;
                        return;
                    }
                    console.error("Error saving settings:", error);
                    saveSettingsBtn.innerHTML = '❌ ERROR SAVING';
                    saveSettingsBtn.disabled = false;
                }
            });
        }
    }
};
