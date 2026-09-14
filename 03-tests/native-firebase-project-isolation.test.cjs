'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { assertNativeProject } = require('../05-tools/scripts/check-native-firebase-project.cjs');
const { assertProject } = require('../05-tools/scripts/check-firebase-project.cjs');
const root = path.resolve(__dirname, '..');

test('native and existing deployment guards have disjoint exact targets', () => {
    assert.doesNotThrow(() => assertNativeProject('bark-ranger-ios'));
    assert.doesNotThrow(() => assertProject('barkrangermap-auth'));
    for (const project of [undefined, '', 'barkrangermap-auth', 'just-dee-dee-music-map', 'demo-bark-native', 'bark-ranger-ios-staging']) {
        assert.throws(() => assertNativeProject(project));
    }
    assert.throws(() => assertProject('bark-ranger-ios'));
});

test('native deployment has no web hosting and guards functions and Firestore', () => {
    const config = JSON.parse(readFileSync(path.join(root, 'firebase.native.json'), 'utf8'));
    assert.equal(config.hosting, undefined);
    assert.equal(config.functions.length, 1);
    assert.equal(config.functions[0].source, '01-code/functions-native');
    assert.equal(config.functions[0].codebase, 'native-ios');
    for (const target of [config.functions[0], config.firestore]) {
        assert.ok(target.predeploy.some(command => command.includes('check-native-firebase-project.cjs') && command.includes('$GCLOUD_PROJECT')));
    }
    assert.equal(config.firestore.rules, '06-config/native-ios/firestore.rules');
    assert.equal(config.emulators.firestore.host, '127.0.0.1');
});
