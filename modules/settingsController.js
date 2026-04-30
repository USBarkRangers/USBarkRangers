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

    const setSettingValue = (key, value) => {
        if (settingsStore && typeof settingsStore.set === 'function') {
            settingsStore.set(key, value);
            return;
        }

        window[key] = value;
        const storageKey = getStorageKeyForSetting(key);
        if (storageKey) localStorage.setItem(storageKey, window[key] ? 'true' : 'false');
    };

    const buildCloudSettingsPayload = () => {
        const settingsPayload = {
            rememberMapPosition: window.rememberMapPosition || false,
            startNationalView: window.startNationalView || false,
            ultraLowEnabled: window.ultraLowEnabled || false,
            mapStyle: localStorage.getItem('barkMapStyle') || 'default',
            visitedFilter: localStorage.getItem('barkVisitedFilter') || 'all',
            settingsUpdatedAt: Date.now()
        };

        Object.entries(settingsRegistry).forEach(([key, setting]) => {
            if (setting.cloudKey) settingsPayload[setting.cloudKey] = Boolean(window[key]);
        });

        return settingsPayload;
    };

    window.BARK.buildCloudSettingsPayload = buildCloudSettingsPayload;

    const getCloudSettingsSaveContext = () => {
        const firebaseService = window.BARK.services && window.BARK.services.firebase;
        const currentUser = firebaseService && typeof firebaseService.getCurrentUser === 'function'
            ? firebaseService.getCurrentUser()
            : null;

        if (!currentUser || !firebaseService || typeof firebaseService.saveUserSettings !== 'function') {
            return null;
        }

        return { firebaseService, currentUser };
    };

    const saveSettingsToCloud = async () => {
        const context = getCloudSettingsSaveContext();
        if (!context) throw new Error('You must be logged in.');

        clearTimeout(cloudAutosaveTimer);
        cloudAutosaveTimer = null;

        const settingsPayload = buildCloudSettingsPayload();
        await context.firebaseService.saveUserSettings(context.currentUser.uid, settingsPayload);
        window._lastAppliedCloudSettingsRevision = settingsPayload.settingsUpdatedAt;
        window._cloudSettingsLoaded = true;
        return settingsPayload;
    };

    const scheduleCloudSettingsAutosave = () => {
        if (window.BARK.isHydratingCloudSettings) return;
        if (!getCloudSettingsSaveContext()) return;

        clearTimeout(cloudAutosaveTimer);
        cloudAutosaveTimer = setTimeout(() => {
            saveSettingsToCloud().catch(error => {
                console.error('[settingsController] cloud settings autosave failed:', error);
            });
        }, CLOUD_AUTOSAVE_DELAY_MS);
    };

    window.BARK.scheduleCloudSettingsAutosave = scheduleCloudSettingsAutosave;

    const syncRegisteredControls = () => {
        const lowGraphicsActive = Boolean(window.lowGfxEnabled);
        const lowGraphicsPreset = window.BARK.LOW_GRAPHICS_PRESET || {};
        Object.keys(settingsRegistry).forEach((key) => {
            const setting = settingsRegistry[key];
            if (!setting) return;

            const input = document.getElementById(setting.elementId);
            const row = input ? input.closest('[data-setting-key]') : null;
            if (!input) return;

            input.checked = Boolean(window[key]);
            input.disabled = lowGraphicsActive && !setting.master && Object.prototype.hasOwnProperty.call(lowGraphicsPreset, key);
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
                if (settingsStore && typeof settingsStore.set === 'function') {
                    settingsStore.set(key, e.target.checked);
                } else {
                    setSettingValue(key, e.target.checked);
                    syncRegisteredControls();
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
    };

    const syncClusterToggles = () => {
        const lowGraphicsActive = Boolean(window.lowGfxEnabled);
        const preset = window.BARK.LOW_GRAPHICS_PRESET || {};
        const standardRow = standardToggle ? standardToggle.closest('[data-cluster-setting]') : null;
        const premiumRow = premiumToggle ? premiumToggle.closest('[data-cluster-setting]') : null;

        if (standardToggle) {
            standardToggle.checked = lowGraphicsActive ? preset.standardClusteringEnabled === true : window.standardClusteringEnabled;
            standardToggle.disabled = lowGraphicsActive;
        }
        if (premiumToggle) {
            premiumToggle.checked = lowGraphicsActive ? preset.premiumClusteringEnabled === true : window.premiumClusteringEnabled;
            premiumToggle.disabled = lowGraphicsActive;
        }
        if (standardRow) standardRow.style.opacity = lowGraphicsActive ? '0.62' : '1';
        if (premiumRow) premiumRow.style.opacity = lowGraphicsActive ? '0.62' : '1';
    };

    if (settingsGearBtn && settingsOverlay) {
        renderPerformanceSettings();
        setupRegistryToggles();

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

        if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
        settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });

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

        // Ultra Low Toggle
        if (ultraLowToggle) {
            ultraLowToggle.addEventListener('change', (e) => {
                const isEnabled = e.target.checked;
                const msg = isEnabled ?
                    "⚠️ ENABLE ULTRA-LOW GRAPHICS?\n\nThis will disable all animations and effects.\nPage will reload." :
                    "Switching to High Graphics requires a page reload. Proceed?";
                if (!window.confirm(msg)) { e.target.checked = !isEnabled; return; }

                setSettingValue('ultraLowEnabled', isEnabled);
                scheduleCloudSettingsAutosave();

                sessionStorage.setItem('skipCloudHydration', 'true');
                setTimeout(() => window.location.reload(true), 150);
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
                    console.error("Error saving settings:", error);
                    saveSettingsBtn.innerHTML = '❌ ERROR SAVING';
                    saveSettingsBtn.disabled = false;
                }
            });
        }
    }
};
