const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadSettingsStore() {
    const values = new Map();
    const localStorage = {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        }
    };
    const window = { BARK: {} };
    const context = {
        window,
        localStorage,
        navigator: { deviceMemory: 8 },
        console,
        Date,
        Map,
        Set,
        Object
    };
    window.window = window;

    const appRoot = path.join(__dirname, '..', '01-code', 'app');
    const registrySource = fs.readFileSync(path.join(appRoot, 'modules', 'settingsRegistry.js'), 'utf8');
    const storeSource = fs.readFileSync(path.join(appRoot, 'state', 'settingsStore.js'), 'utf8');
    vm.runInNewContext(registrySource, context, { filename: 'modules/settingsRegistry.js' });
    vm.runInNewContext(storeSource, context, { filename: 'state/settingsStore.js' });

    return { window, localStorage };
}

test('turning Low Graphics off clears every setting controlled by its preset', () => {
    const { window, localStorage } = loadSettingsStore();
    const store = window.BARK.settings;
    const preset = window.BARK.LOW_GRAPHICS_PRESET;

    store.set('lowGfxEnabled', true);
    Object.entries(preset).forEach(([key, value]) => {
        assert.equal(store.get(key), value, `${key} should follow the enabled preset`);
    });

    store.set('lowGfxEnabled', false);
    assert.equal(store.get('lowGfxEnabled'), false);
    Object.keys(preset).forEach((key) => {
        assert.equal(store.get(key), false, `${key} should turn off with the master switch`);
        const storageKey = window.BARK.SETTINGS_REGISTRY[key] && window.BARK.SETTINGS_REGISTRY[key].storageKey;
        if (storageKey) assert.equal(localStorage.getItem(storageKey), 'false');
    });
});

test('individual performance settings remain usable after Low Graphics is turned off', () => {
    const { window } = loadSettingsStore();
    const store = window.BARK.settings;

    store.set('lowGfxEnabled', true);
    store.set('lowGfxEnabled', false);
    store.set('viewportCulling', true);

    assert.equal(store.get('lowGfxEnabled'), false);
    assert.equal(store.get('viewportCulling'), true);
    assert.equal(store.get('removeShadows'), false);
    assert.equal(store.get('stopResizing'), false);
});

test('repeatedly hydrating disabled Low Graphics preserves every independently enabled child', () => {
    const { window } = loadSettingsStore();
    const store = window.BARK.settings;
    const enabledChildKeys = Object.entries(window.BARK.LOW_GRAPHICS_PRESET)
        .filter(([, presetValue]) => presetValue === true)
        .map(([key]) => key);
    const changeCounts = Object.fromEntries(enabledChildKeys.map(key => [key, 0]));

    enabledChildKeys.forEach((key) => {
        store.set(key, true);
        store.onChange(key, () => {
            changeCounts[key] += 1;
        });
    });

    for (let replay = 0; replay < 50; replay += 1) {
        store.set('lowGfxEnabled', false);
    }

    assert.equal(store.get('lowGfxEnabled'), false);
    enabledChildKeys.forEach((key) => {
        assert.equal(store.get(key), true, `${key} should survive an already-false master replay`);
        assert.equal(changeCounts[key], 0, `${key} should not emit a synthetic change`);
    });
});

test('turning Ultra Fast off also clears the nested Low Graphics preset', () => {
    const { window } = loadSettingsStore();
    const store = window.BARK.settings;

    store.set('ultraLowEnabled', true);
    assert.equal(store.get('lowGfxEnabled'), true);
    assert.equal(store.get('removeShadows'), true);

    store.set('ultraLowEnabled', false);
    assert.equal(store.get('ultraLowEnabled'), false);
    assert.equal(store.get('lowGfxEnabled'), false);
    Object.keys(window.BARK.LOW_GRAPHICS_PRESET).forEach((key) => {
        assert.equal(store.get(key), false, `${key} should reset when Ultra Low turns off`);
    });
});
