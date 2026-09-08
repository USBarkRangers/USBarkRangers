'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {assertProject} = require('../05-tools/scripts/check-firebase-project.cjs');

test('Bark deployments reject JDDM, unknown and missing projects', () => {
    assert.doesNotThrow(() => assertProject('barkrangermap-auth'));
    for (const project of ['just-dee-dee-music-map', 'unknown', '', undefined]) {
        assert.throws(() => assertProject(project));
    }
});

test('functions, hosting and rules all enforce the project before deployment', () => {
    const config = require('../firebase.json');
    for (const target of [...config.functions, config.hosting, config.firestore]) {
        assert.deepEqual(target.predeploy, ['node "$PROJECT_DIR/05-tools/scripts/check-firebase-project.cjs" "$GCLOUD_PROJECT"']);
    }
    for (const [project, status] of [['barkrangermap-auth', 0], ['just-dee-dee-music-map', 1], ['', 1]]) {
        assert.equal(spawnSync(process.execPath, [path.join(__dirname, '../05-tools/scripts/check-firebase-project.cjs'), project]).status, status);
    }
});
