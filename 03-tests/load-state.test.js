const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', '01-code', 'app', 'modules', 'loadState.js'),
    'utf8'
);

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createHarness({ online = true, parks = [], authUser = null } = {}) {
    const elements = new Map([
        ['park-data-status', { hidden: true, dataset: {} }],
        ['park-data-status-title', { textContent: '' }],
        ['park-data-status-detail', { textContent: '' }]
    ]);
    const windowListeners = new Map();
    const repoListeners = new Set();
    const parkRecords = parks.slice();

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        navigator: { onLine: online },
        document: { getElementById: id => elements.get(id) || null },
        firebase: { auth: () => ({ currentUser: authUser }) },
        window: {
            _authStateResolved: false,
            _firstServerPayloadReceived: false,
            _visitedPlacesServerSnapshotReceived: false,
            addEventListener(type, listener) { windowListeners.set(type, listener); },
            BARK: {
                repos: {
                    ParkRepo: {
                        getAll: () => parkRecords,
                        subscribe(listener) {
                            repoListeners.add(listener);
                            return () => repoListeners.delete(listener);
                        }
                    }
                }
            }
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    return {
        sandbox,
        elements,
        setOnline(value) {
            sandbox.navigator.onLine = value;
            const listener = windowListeners.get(value ? 'online' : 'offline');
            if (listener) listener();
        },
        publishParks(next) {
            parkRecords.splice(0, parkRecords.length, ...next);
            repoListeners.forEach(listener => listener({ type: 'replaceAll' }));
        }
    };
}

test('cold park data stays quiet briefly, then shows a truthful slow-load banner', async () => {
    const { sandbox, elements } = createHarness();
    const loadState = sandbox.window.BARK.loadState;

    loadState.beginParkLoad({ slowAfterMs: 8 });
    assert.equal(elements.get('park-data-status').hidden, true, 'normal startup must not flash a warning');

    await wait(20);
    assert.equal(loadState.getParkState(), 'slow');
    assert.equal(elements.get('park-data-status').hidden, false);
    assert.match(elements.get('park-data-status-title').textContent, /longer than usual/i);
});

test('park publication clears the banner immediately and a warm cache never shows it', async () => {
    const harness = createHarness();
    const loadState = harness.sandbox.window.BARK.loadState;
    loadState.beginParkLoad({ slowAfterMs: 5 });
    await wait(12);
    assert.equal(loadState.getParkState(), 'slow');

    harness.publishParks([{ id: 'park-1' }]);
    assert.equal(loadState.getParkState(), 'ready');
    assert.equal(harness.elements.get('park-data-status').hidden, true);

    loadState.beginParkLoad({ slowAfterMs: 0 });
    await wait(5);
    assert.equal(loadState.getParkState(), 'ready');
    assert.equal(harness.elements.get('park-data-status').hidden, true);
});

test('offline and unavailable are distinct, recoverable states', async () => {
    const harness = createHarness({ online: false });
    const loadState = harness.sandbox.window.BARK.loadState;
    loadState.beginParkLoad({ slowAfterMs: 0 });
    await wait(5);
    assert.equal(loadState.getParkState(), 'offline');
    assert.match(harness.elements.get('park-data-status-title').textContent, /connection/i);

    harness.setOnline(true);
    assert.equal(loadState.getParkState(), 'loading');
    loadState.markParkDataUnavailable();
    assert.equal(loadState.getParkState(), 'unavailable');

    harness.publishParks([{ id: 'park-2' }]);
    assert.equal(loadState.getParkState(), 'ready');
});

test('profile data is never called ready from cache-only or half-hydrated snapshots', () => {
    const { sandbox } = createHarness({ authUser: { uid: 'u1' } });
    const loadState = sandbox.window.BARK.loadState;

    assert.equal(loadState.isProfileDataReady(), false, 'auth has not resolved');
    sandbox.window._authStateResolved = true;
    assert.equal(loadState.isProfileDataReady(), false, 'neither authoritative snapshot arrived');
    sandbox.window._firstServerPayloadReceived = true;
    assert.equal(loadState.isProfileDataReady(), false, 'one of two authoritative snapshots is insufficient');
    sandbox.window._visitedPlacesServerSnapshotReceived = true;
    assert.equal(loadState.isProfileDataReady(), true);
});

test('resolved signed-out sessions may show a legitimate local zero', () => {
    const { sandbox } = createHarness({ authUser: null });
    sandbox.window._authStateResolved = true;
    assert.equal(sandbox.window.BARK.loadState.isProfileDataReady(), true);
});
