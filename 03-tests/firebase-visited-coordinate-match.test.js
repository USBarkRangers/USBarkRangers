const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function loadFirebaseServiceWithVisits(visits) {
    const visitMap = new Map(visits.map(visit => [visit.id, visit]));
    const sandbox = {
        console,
        alert() {},
        window: {
            BARK: {
                services: {},
                repos: {
                    VaultRepo: {
                        getVisit(id) {
                            return visitMap.get(id) || null;
                        },
                        entries() {
                            return Array.from(visitMap.entries());
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
