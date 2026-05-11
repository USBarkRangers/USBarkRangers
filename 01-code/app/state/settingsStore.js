/**
 * settingsStore.js - Mirrored persistent settings store.
 * Reads persistent settings directly so boot order cannot corrupt saved preferences.
 */
(function () {
    window.BARK = window.BARK || {};
    window.BARK.bootOrder = window.BARK.bootOrder || {};

    if (!window.BARK.__barkStateReady) {
        console.warn('[B.A.R.K. Settings] settingsStore.js parsed before barkState.js. Persistent settings are still safe, but startup order no longer matches the Phase -1 guardrail.');
    }
    window.BARK.bootOrder.settingsStoreParsedAt = Date.now();

    const STORAGE_KEYS = {
        allowUncheck: 'barkAllowUncheck',
        standardClusteringEnabled: 'barkStandardClustering',
        premiumClusteringEnabled: 'barkPremiumClustering',
        lowGfxEnabled: 'barkLowGfxEnabled',
        simplifyTrails: 'barkSimplifyTrails',
        instantNav: 'barkInstantNav',
        rememberMapPosition: 'remember-map-toggle',
        startNationalView: 'barkNationalView',
        stopAutoMovements: 'barkStopAutoMove',
        reducePinMotion: 'barkReducePinMotion',
        removeShadows: 'barkRemoveShadows',
        stopResizing: 'barkStopResizing',
        viewportCulling: 'barkViewportCulling',
        forcePlainMarkers: 'barkForcePlainMarkers',
        limitZoomOut: 'barkLimitZoomOut',
        simplifyPinsWhileMoving: 'barkSimplifyPinsWhileMoving',
        ultraLowEnabled: 'barkUltraLowEnabled',
        lockMapPanning: 'barkLockMapPanning',
        disable1fingerZoom: 'barkDisable1Finger',
        disableDoubleTap: 'barkDisableDoubleTap',
        disablePinchZoom: 'barkDisablePinchZoom'
    };

    const DERIVED_KEYS = new Set(['clusteringEnabled']);
    const CLUSTER_SETTING_KEYS = new Set(['standardClusteringEnabled', 'premiumClusteringEnabled']);
    const DEFAULT_VALUES = {
        allowUncheck: false,
        standardClusteringEnabled: false,
        premiumClusteringEnabled: false,
        simplifyTrails: false,
        instantNav: false,
        rememberMapPosition: false,
        startNationalView: true,
        stopAutoMovements: false,
        reducePinMotion: false,
        removeShadows: false,
        stopResizing: false,
        viewportCulling: false,
        forcePlainMarkers: false,
        limitZoomOut: false,
        simplifyPinsWhileMoving: false,
        ultraLowEnabled: false,
        lockMapPanning: false,
        disable1fingerZoom: false,
        disableDoubleTap: false,
        disablePinchZoom: false
    };
    Object.entries(window.BARK.SETTINGS_REGISTRY || {}).forEach(([key, setting]) => {
        if (setting.storageKey) STORAGE_KEYS[key] = setting.storageKey;
        if (setting.defaultValue !== undefined) DEFAULT_VALUES[key] = setting.defaultValue;
    });
    const SETTING_KEYS = Object.keys(STORAGE_KEYS);
    const values = {};
    const listeners = new Map();

    function normalizeBoolean(value) {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === undefined || value === null) return false;
        return Boolean(value);
    }

    function getDefaultValue(key) {
        if (key === 'lowGfxEnabled') {
            const deviceRAM = navigator.deviceMemory || 4;
            return deviceRAM < 4;
        }
        return DEFAULT_VALUES[key] === true;
    }

    function readStoredSetting(key) {
        const storageKey = STORAGE_KEYS[key];
        const storedValue = localStorage.getItem(storageKey);
        if (storedValue === null) return getDefaultValue(key);
        return normalizeBoolean(storedValue);
    }

    function assertKnownKey(key) {
        if (!Object.prototype.hasOwnProperty.call(STORAGE_KEYS, key) && !DERIVED_KEYS.has(key)) {
            throw new Error(`Unknown BARK settings key: ${key}`);
        }
    }

    function persist(key, value) {
        const storageKey = STORAGE_KEYS[key];
        if (!storageKey) return;

        try {
            localStorage.setItem(storageKey, normalizeBoolean(value) ? 'true' : 'false');
        } catch (error) {
            console.error(`Failed to persist BARK setting "${key}" to localStorage.`, error);
            throw error;
        }
    }

    function notify(key, value, previousValue) {
        const callbacks = listeners.get(key);
        if (!callbacks) return;

        callbacks.forEach((callback) => {
            try {
                callback(value, previousValue, key);
            } catch (error) {
                console.error(`BARK settings listener failed for "${key}".`, error);
            }
        });
    }

    function getDerivedValue(key) {
        if (key === 'clusteringEnabled') {
            return values.standardClusteringEnabled || values.premiumClusteringEnabled;
        }
        throw new Error(`Unknown derived BARK settings key: ${key}`);
    }

    function get(key) {
        assertKnownKey(key);
        if (DERIVED_KEYS.has(key)) return getDerivedValue(key);
        return values[key];
    }

    function applyValue(key, value) {
        const normalizedValue = normalizeBoolean(value);
        const previousValue = values[key];

        values[key] = normalizedValue;
        persist(key, normalizedValue);

        if (!Object.is(previousValue, normalizedValue)) {
            notify(key, normalizedValue, previousValue);
        }
    }

    function applyPresetValues(presetValues) {
        Object.entries(presetValues || {}).forEach(([presetKey, presetValue]) => {
            if (Object.prototype.hasOwnProperty.call(STORAGE_KEYS, presetKey)) {
                applyValue(presetKey, presetValue);
            }
        });
    }

    function getUltraLowPresetValues(isEnabled) {
        if (!isEnabled) {
            return {
                lowGfxEnabled: false,
                instantNav: false,
                simplifyTrails: false
            };
        }

        return {
            lowGfxEnabled: true,
            ...(window.BARK.LOW_GRAPHICS_PRESET || {}),
            standardClusteringEnabled: false,
            premiumClusteringEnabled: false,
            instantNav: true,
            simplifyTrails: true,
            forcePlainMarkers: false,
            limitZoomOut: true,
            simplifyPinsWhileMoving: true
        };
    }

    function set(key, value) {
        assertKnownKey(key);

        if (DERIVED_KEYS.has(key)) {
            throw new Error(`BARK setting "${key}" is derived and cannot be set directly.`);
        }

        const lowGraphicsPreset = window.BARK.LOW_GRAPHICS_PRESET || {};
        if (key !== 'lowGfxEnabled' && values.lowGfxEnabled && Object.prototype.hasOwnProperty.call(lowGraphicsPreset, key)) {
            value = lowGraphicsPreset[key];
        }

        // Capture ultraLowEnabled previous state before applyValue overwrites it,
        // so we only fire the reset preset when actually turning OFF (true -> false transition).
        const ultraLowWasEnabled = key === 'ultraLowEnabled' ? values.ultraLowEnabled === true : false;

        const previousClusterState = get('clusteringEnabled');
        applyValue(key, value);

        if (CLUSTER_SETTING_KEYS.has(key) && values[key]) {
            const otherKey = key === 'standardClusteringEnabled' ? 'premiumClusteringEnabled' : 'standardClusteringEnabled';
            applyValue(otherKey, false);
        }

        if (key === 'forcePlainMarkers' && values.forcePlainMarkers) {
            applyValue('standardClusteringEnabled', false);
            applyValue('premiumClusteringEnabled', false);
        } else if (CLUSTER_SETTING_KEYS.has(key) && values[key]) {
            applyValue('forcePlainMarkers', false);
        }

        if (key === 'ultraLowEnabled' && values.ultraLowEnabled) {
            applyPresetValues(getUltraLowPresetValues(true));
        } else if (key === 'ultraLowEnabled' && ultraLowWasEnabled) {
            // Only fire the reset preset when ultraLowEnabled is actually being turned OFF (true -> false).
            // This prevents resetting lowGfxEnabled/instantNav/simplifyTrails when ultraLowEnabled was already false.
            applyPresetValues(getUltraLowPresetValues(false));
        }

        if (key === 'lowGfxEnabled' && values.lowGfxEnabled) {
            applyPresetValues(window.BARK.LOW_GRAPHICS_PRESET || {});
        }

        const nextClusterState = get('clusteringEnabled');
        if (!Object.is(previousClusterState, nextClusterState)) {
            notify('clusteringEnabled', nextClusterState, previousClusterState);
        }
    }

    function onChange(key, callback) {
        assertKnownKey(key);

        if (typeof callback !== 'function') {
            throw new Error(`BARK settings listener for "${key}" must be a function.`);
        }

        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(callback);

        return function unsubscribe() {
            listeners.get(key).delete(callback);
        };
    }

    function hydrateFromLocalStorage() {
        SETTING_KEYS.forEach((key) => {
            values[key] = readStoredSetting(key);
        });

        if (values.ultraLowEnabled) {
            Object.assign(values, getUltraLowPresetValues(true));
        }

        if (values.lowGfxEnabled) {
            Object.entries(window.BARK.LOW_GRAPHICS_PRESET || {}).forEach(([presetKey, presetValue]) => {
                if (Object.prototype.hasOwnProperty.call(STORAGE_KEYS, presetKey)) values[presetKey] = presetValue;
            });
        }
    }

    function installLegacyWindowMirrors() {
        SETTING_KEYS.forEach((key) => {
            Object.defineProperty(window, key, {
                configurable: true,
                enumerable: true,
                get() {
                    return get(key);
                },
                set(value) {
                    set(key, value);
                }
            });
        });

        Object.defineProperty(window, 'clusteringEnabled', {
            configurable: true,
            enumerable: true,
            get() {
                return get('clusteringEnabled');
            },
            set() {
                // Legacy callers still assign this after cluster toggles. The value is derived.
            }
        });
    }

    hydrateFromLocalStorage();
    installLegacyWindowMirrors();

    window.BARK.settings = {
        get,
        set,
        onChange
    };
    window.BARK.__settingsStoreReady = true;
})();
