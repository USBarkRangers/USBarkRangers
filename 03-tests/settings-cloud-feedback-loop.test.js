const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadCloudSettingsGuards() {
    const window = { BARK: {} };
    const context = {
        window,
        console,
        JSON,
        Object,
        Set
    };
    window.window = window;

    const source = fs.readFileSync(
        path.join(__dirname, '..', '01-code', 'app', 'modules', 'settingsController.js'),
        'utf8'
    );
    vm.runInNewContext(source, context, { filename: 'modules/settingsController.js' });
    return window.BARK;
}

test('cloud settings fingerprint ignores revision-only changes', () => {
    const bark = loadCloudSettingsGuards();
    const first = {
        lowGfxEnabled: false,
        limitZoomOut: true,
        settingsUpdatedAt: 100
    };
    const replay = {
        settingsUpdatedAt: 200,
        limitZoomOut: true,
        lowGfxEnabled: false
    };

    bark.rememberCloudSettingsSnapshot(first);

    assert.equal(bark.getCloudSettingsFingerprint(first), bark.getCloudSettingsFingerprint(replay));
    assert.equal(bark.cloudSettingsMateriallyChanged(replay), false);
});

test('cloud settings fingerprint still detects a real preference change', () => {
    const bark = loadCloudSettingsGuards();
    bark.rememberCloudSettingsSnapshot({
        lowGfxEnabled: false,
        limitZoomOut: true,
        settingsUpdatedAt: 100
    });

    assert.equal(bark.cloudSettingsMateriallyChanged({
        lowGfxEnabled: false,
        limitZoomOut: false,
        settingsUpdatedAt: 200
    }), true);
});

test('cloud-originated setting changes are never eligible for autosave', () => {
    const bark = loadCloudSettingsGuards();

    bark.isHydratingCloudSettings = true;
    assert.equal(bark.shouldAutosaveCloudSettingsChange(), false);

    bark.isHydratingCloudSettings = false;
    assert.equal(bark.shouldAutosaveCloudSettingsChange(), true);
});
