const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadHarness() {
    const context = {
        console,
        alert() {},
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
        RegExp
    };
    context.window = context;
    context.global = context;
    context.syncState = () => {};
    vm.createContext(context);
    [
        '01-code/app/repos/VaultRepo.js',
        '01-code/app/services/visitMutationCoordinator.js',
        '01-code/app/services/firebaseService.js'
    ].forEach(relativePath => {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
            context,
            { filename: relativePath }
        );
    });
    return context;
}

test('snapshot reconciliation refreshes only changed canonical pins and skips no-op snapshots', () => {
    const context = loadHarness();
    const service = context.BARK.services.firebase;
    const repo = context.BARK.repos.VaultRepo;
    const scopes = [];
    let cacheInvalidations = 0;
    const visit = {
        id: 'b7b26034-7d2c-4c3e-9901-29e1b5751230',
        name: 'Fort Caroline',
        lat: 30.385948,
        lng: -81.497541,
        verified: true,
        ts: 10
    };

    context.BARK.invalidateVisitedIdsCache = () => { cacheInvalidations++; };
    context.BARK.markerManager = {
        refreshMarkerStyles(ids) { scopes.push(ids); }
    };
    context.BARK.tripLayer = { refreshBadgeStyles() {} };

    service.reconcileVisitedPlacesSnapshot([visit], { fromCache: false, hasPendingWrites: false });
    assert.equal(cacheInvalidations, 1);
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0].has(visit.id), true);

    service.reconcileVisitedPlacesSnapshot([{ ...visit }], { fromCache: false, hasPendingWrites: false });
    assert.equal(cacheInvalidations, 1);
    assert.equal(scopes.length, 1, 'identical snapshots should not repaint markers');

    repo.stageUpsert(visit);
    service.reconcileVisitedPlacesSnapshot([], { fromCache: true, hasPendingWrites: false });
    assert.equal(repo.hasPendingMutation(visit.id), true);
    assert.equal(scopes.length, 1, 'cached snapshots must leave an offline visit pending without repainting');

    service.reconcileVisitedPlacesSnapshot([visit], { fromCache: false, hasPendingWrites: false });
    assert.equal(repo.hasPendingMutation(visit.id), false);
    assert.equal(cacheInvalidations, 1, 'confirmation does not change visited membership');
    assert.equal(scopes.length, 2);
    assert.equal(scopes[1].has(visit.id), true, 'only the confirmed pin should turn from orange to green');
});
