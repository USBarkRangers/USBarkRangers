'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
test('iOS integration CI launches all native checkpoints against the isolated native backend', () => {
    const workflow = readFileSync(resolve(root, '.github/workflows/ios-checks.yml'), 'utf8');
    assert.match(workflow, /--config firebase\.native\.json/);
    assert.match(workflow, /--project demo-bark-native/);
    assert.match(workflow, /npm ci --prefix 01-code\/functions-native /);
    assert.match(workflow, /seed-native-profile-ui\.cjs/);
    for (const checkpoint of ['profile', 'trips', 'adventures']) assert.match(workflow, new RegExp(`--native-${checkpoint} `));
    assert.equal(workflow.match(/python3 05-tools\/scripts\/test-ios-accounts\.py/g)?.length, 1,
        'Run the union once instead of repeating shared account UI checks');
    for (const retired of ['firebase.ios-emulators.json', 'demo-barkranger-ios', 'seed-ios-emulators.cjs']) {
        assert.equal(workflow.includes(retired), false, retired);
    }
});
test('backend CI also runs when shared Swift/JavaScript contract fixtures change', () => {
    const workflow = readFileSync(resolve(root, '.github/workflows/native-ios-rebuild-checks.yml'), 'utf8');
    assert.equal(workflow.split("'01-code/ios/Packages/BarkDomain/**'").length - 1, 2);
});
test('catalog polling fixture required by the checked-in iOS tests is included', () => {
    const fixture = readFileSync(resolve(root, '05-tools/scripts/serve-ios-catalog.js'), 'utf8');
    assert.match(fixture, /const scenarios = \[[^\]]*"polling"/);
});
