const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function loadFirebaseServiceWithVisits(visits) {
    const visitMap = new Map(visits.map(visit => [visit.id, visit]));
    let entriesCallCount = 0;
    const sandbox = {
        console,
        alert() {},
        window: {
            BARK: {
                services: {},
                repos: {
                    VaultRepo: {
                        hasVisit(id) {
                            return visitMap.has(id);
                        },
                        getVisit(id) {
                            return visitMap.get(id) || null;
                        },
                        entries() {
                            entriesCallCount++;
                            return Array.from(visitMap.entries());
                        },
                        getRevision() {
                            return 1;
                        },
                        getVisits() {
                            return Array.from(visitMap.values());
                        }
                    }
                }
            },
            syncState() {}
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'services', 'firebaseService.js'), 'utf8'), sandbox);
    sandbox.window.BARK.__getEntriesCallCount = () => entriesCallCount;
    return sandbox.window.BARK;
}

test('canonical visits at the same coordinates do not mark another canonical park visited', () => {
    const fortCaroline = {
        id: 'b7b26034-7d2c-4c3e-9901-29e1b5751230',
        name: 'Fort Caroline/Timucuan Ecological and Historical Preserve',
        lat: 30.4544578,
        lng: -81.4498717
    };
    const kingsleyPlantation = {
        id: 'f1bf6d46-3919-4c0c-838d-555ca47155d2',
        name: 'Timucuan Ecological and Historical Preserve Kingsley Plantation',
        lat: 30.4544578,
        lng: -81.4498717
    };
    const BARK = loadFirebaseServiceWithVisits([fortCaroline]);

    assert.equal(BARK.isParkVisited(fortCaroline), true);
    assert.equal(BARK.isParkVisited(kingsleyPlantation), false);
});

test('legacy coordinate visits still match canonical parks during migration', () => {
    const legacyVisit = {
        id: '30.45_-81.45',
        name: 'Old coordinate-only visit',
        lat: 30.4544578,
        lng: -81.4498717
    };
    const canonicalPark = {
        id: 'b7b26034-7d2c-4c3e-9901-29e1b5751230',
        name: 'Fort Caroline/Timucuan Ecological and Historical Preserve',
        lat: 30.4544578,
        lng: -81.4498717
    };
    const BARK = loadFirebaseServiceWithVisits([legacyVisit]);

    assert.equal(BARK.isParkVisited(canonicalPark), true);
});

test('canonical visited checks use the repository index without cloning all entries', () => {
    const park = {
        id: 'b7b26034-7d2c-4c3e-9901-29e1b5751230',
        lat: 30.4544578,
        lng: -81.4498717
    };
    const BARK = loadFirebaseServiceWithVisits([park]);

    assert.equal(BARK.isParkVisited(park), true);
    assert.equal(BARK.__getEntriesCallCount(), 0);
});

test('legacy coordinate fallback builds its coordinate index once per vault revision', () => {
    const legacyVisit = {
        id: 'legacy-import-record',
        lat: 30.4544578,
        lng: -81.4498717
    };
    const BARK = loadFirebaseServiceWithVisits([legacyVisit]);

    assert.equal(BARK.isParkVisited({
        id: 'b7b26034-7d2c-4c3e-9901-29e1b5751230',
        lat: 30.4544578,
        lng: -81.4498717
    }), true);
    assert.equal(BARK.isParkVisited({
        id: 'f1bf6d46-3919-4c0c-838d-555ca47155d2',
        lat: 31,
        lng: -82
    }), false);
    assert.equal(BARK.__getEntriesCallCount(), 1);
});

test('two thousand pin checks do not rescan a large canonical visit history', () => {
    const visits = Array.from({ length: 200 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        lat: 20 + (index / 1000),
        lng: -80
    }));
    const BARK = loadFirebaseServiceWithVisits(visits);

    for (let index = 0; index < 2000; index++) {
        BARK.isParkVisited({
            id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            lat: 40 + (index / 10000),
            lng: -100
        });
    }

    assert.equal(BARK.__getEntriesCallCount(), 1);
});
