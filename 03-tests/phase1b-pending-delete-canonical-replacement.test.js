const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadBrowserScripts() {
    const context = {
        console,
        Date,
        Map,
        Set,
        Promise,
        Math,
        Number,
        String,
        Boolean,
        Object,
        Array,
        JSON,
        RegExp,
        setTimeout,
        clearTimeout
    };
    context.window = context;
    context.global = context;
    context.alert = (message) => {
        throw new Error(`Unexpected alert: ${message}`);
    };

    vm.createContext(context);
    [
        '01-code/app/repos/ParkRepo.js',
        '01-code/app/repos/VaultRepo.js',
        '01-code/app/services/firebaseService.js'
    ].forEach((relativePath) => {
        const absolutePath = path.join(ROOT, relativePath);
        vm.runInContext(fs.readFileSync(absolutePath, 'utf8'), context, { filename: relativePath });
    });

    context.window.BARK.invalidateVisitedIdsCache = () => {};
    return context.window.BARK;
}

function assertPendingMissing(vaultRepo, id) {
    const pending = vaultRepo.snapshot().pending;
    assert.equal(pending.has(id), false, `Expected no pending mutation for ${id}`);
}

function assertCanonicalVisit(vaultRepo, canonicalId) {
    assert.equal(vaultRepo.hasVisit(canonicalId), true, 'Expected canonical visit to remain');
    assert.deepEqual({ ...vaultRepo.getVisit(canonicalId) }, {
        id: canonicalId,
        name: 'Test Park',
        lat: 12.34,
        lng: -56.78,
        state: '',
        verified: true,
        ts: 1000
    });
}

async function run() {
    const bark = loadBrowserScripts();
    const parkRepo = bark.repos.ParkRepo;
    const vaultRepo = bark.repos.VaultRepo;
    const firebaseService = bark.services.firebase;

    const legacyId = '12.34_-56.78';
    const canonicalId = 'canonical-park-1';
    const unrelatedId = 'unrelated-visit';
    const legacyVisit = {
        id: legacyId,
        name: 'Test Park',
        lat: 12.34,
        lng: -56.78,
        verified: true,
        ts: 1000
    };
    const canonicalVisit = {
        id: canonicalId,
        name: 'Test Park',
        lat: 12.34,
        lng: -56.78,
        state: '',
        verified: true,
        ts: 1000
    };
    const unrelatedVisit = {
        id: unrelatedId,
        name: 'Unrelated Visit',
        lat: 1,
        lng: 2,
        verified: false,
        ts: 2000
    };

    parkRepo.replaceAll([{
        id: canonicalId,
        name: 'Test Park',
        lat: 12.34,
        lng: -56.78
    }]);

    vaultRepo.clear();
    vaultRepo.addVisit(legacyVisit);
    vaultRepo.addVisit(unrelatedVisit);

    const baseToken = vaultRepo.snapshot();
    vaultRepo.removeVisit(legacyId);
    vaultRepo.stageDelete(legacyId);
    const rollbackToken = vaultRepo.createRollbackToken(baseToken, [legacyId]);

    firebaseService.replaceLocalVisitedPlaces(new Map([
        [canonicalId, canonicalVisit],
        [unrelatedId, unrelatedVisit]
    ]), {
        canonicalReplacements: [{
            sourceId: legacyId,
            visitId: legacyId,
            targetId: canonicalId
        }]
    });

    assert.equal(vaultRepo.hasVisit(legacyId), false, 'Legacy visit should be gone after canonical replacement');
    assertCanonicalVisit(vaultRepo, canonicalId);
    assertPendingMissing(vaultRepo, legacyId);

    vaultRepo.restore(rollbackToken);

    assert.equal(vaultRepo.hasVisit(legacyId), false, 'Rollback must not resurrect the legacy visit id');
    assertCanonicalVisit(vaultRepo, canonicalId);
    assert.equal(vaultRepo.hasVisit(unrelatedId), true, 'Rollback must not remove unrelated visits');
    assert.deepEqual({ ...vaultRepo.getVisit(unrelatedId) }, unrelatedVisit);
    assertPendingMissing(vaultRepo, legacyId);

    vaultRepo.clear();
    vaultRepo.addVisit(legacyVisit);
    vaultRepo.stageDelete(legacyId);

    const normalizeResult = await firebaseService.normalizeLocalVisitedPlacesToCanonical();

    assert.equal(normalizeResult.changed, true, 'Canonical normalization should replace the legacy id');
    assert.equal(vaultRepo.hasVisit(legacyId), false, 'Normalization should remove the legacy id');
    assertCanonicalVisit(vaultRepo, canonicalId);
    assertPendingMissing(vaultRepo, legacyId);
}

run()
    .then(() => {
        console.log('Phase 1B pending-delete canonical replacement repro passed.');
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
