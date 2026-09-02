const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_ROOT = path.join(__dirname, '..', '01-code', 'app');
const SW_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'sw.js'), 'utf8');
const PRIOR_SW_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sw-0.141.js'), 'utf8');
const LEGACY_SW_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sw-0.140.js'), 'utf8');
const PUBLIC_INDEX_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'index.html'), 'utf8');
const PRIOR_PRIVATE_INDEX_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'index.v141.html'), 'utf8');
const PRIVATE_INDEX_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'index.v142.html'), 'utf8');
const MANIFEST_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'offline', 'cacheManifest-0.142.js'), 'utf8');
const PRIOR_MANIFEST_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'offline', 'cacheManifest-0.141.js'), 'utf8');
const LEGACY_MANIFEST_SOURCE = fs.readFileSync(path.join(APP_ROOT, 'offline', 'cacheManifest.js'), 'utf8');

const CUTOVER_STABLE_REFS = Object.freeze([
    'offline/offlineBootstrap.js?v=1',
    'repos/VaultRepo.js?v=6',
    'services/visitMutationCoordinator.js?v=2',
    'services/firebaseService.js?v=25',
    'services/checkinService.js?v=28',
    'services/authService.js?v=86',
    'core/app.js?v=39'
]);

const CORRECTIVE_PRIVATE_REFS = Object.freeze([
    'repos/VaultRepo.v141.js',
    'services/visitMutationCoordinator.v141.js',
    'services/firebaseService.v141.js',
    'services/checkinService.v141.js',
    'services/authService.v141.js',
    'core/app.v141.js'
]);

const RELEASE_0142_REFS = Object.freeze([
    'index.v142.html',
    'modules/dataService.v142.js',
    'assets/data/bark-fallback-0.142.csv'
]);

function cacheKey(requestOrUrl) {
    return typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl.url;
}

function createCacheStore(initial = {}) {
    const stores = new Map();
    Object.entries(initial).forEach(([name, entries]) => {
        stores.set(name, new Map(Object.entries(entries)));
    });

    function cacheFor(name) {
        if (!stores.has(name)) stores.set(name, new Map());
        const entries = stores.get(name);
        return {
            async put(request, response) { entries.set(cacheKey(request), response); },
            async match(request) { return entries.get(cacheKey(request)) || null; },
            async keys() { return Array.from(entries.keys()).map(url => new Request(url)); },
            async delete(request) { return entries.delete(cacheKey(request)); }
        };
    }

    return {
        stores,
        api: {
            async open(name) { return cacheFor(name); },
            async keys() { return Array.from(stores.keys()); },
            async delete(name) { return stores.delete(name); }
        }
    };
}

function loadWorker(fetchImpl, cacheState, manifestOverride = null, source = SW_SOURCE) {
    const handlers = {};
    const manifest = manifestOverride || {
        version: 'atomic-test',
        shell: ['./index.html', './services/checkinService.js?v=test'],
        criticalExternal: ['https://cdn.example.test/firebase.js'],
        maximumOfflineTiles: 10,
        minimumOfflineTileZoom: 11,
        navigationTimeoutMs: 100
    };
    const self = {
        BARK_OFFLINE_CACHE_MANIFEST: manifest,
        registration: { scope: 'https://example.test/app/' },
        clients: { async claim() {} },
        async skipWaiting() {},
        addEventListener(name, handler) { handlers[name] = handler; }
    };
    const context = {
        self,
        importScripts() {},
        caches: cacheState.api,
        fetch: fetchImpl,
        Request,
        Response,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        Promise,
        console
    };
    vm.runInNewContext(source, context, { filename: 'sw.js' });
    return { handlers, manifest };
}

function loadReleaseManifest() {
    const context = { self: {} };
    vm.runInNewContext(MANIFEST_SOURCE, context, { filename: 'cacheManifest.js' });
    return context.self.BARK_OFFLINE_CACHE_MANIFEST;
}

function loadPriorManifest() {
    const context = { self: {} };
    vm.runInNewContext(PRIOR_MANIFEST_SOURCE, context, { filename: 'cacheManifest-0.141.js' });
    return context.self.BARK_OFFLINE_CACHE_MANIFEST;
}

function loadLegacyManifest() {
    const context = { self: {} };
    vm.runInNewContext(LEGACY_MANIFEST_SOURCE, context, { filename: 'cacheManifest.js' });
    return context.self.BARK_OFFLINE_CACHE_MANIFEST;
}

function runExtendable(handler, event = {}) {
    let work = null;
    handler({
        ...event,
        waitUntil(promise) { work = Promise.resolve(promise); },
        respondWith(promise) { work = Promise.resolve(promise); }
    });
    assert.ok(work, 'worker handler must register asynchronous work');
    return work;
}

test('failed critical shell install keeps the prior complete cache', async () => {
    const oldName = 'bark-offline-shell-prior';
    const cacheState = createCacheStore({
        [oldName]: {
            'https://example.test/app/index.html': new Response('old app')
        }
    });
    const failingUrl = 'https://example.test/app/services/checkinService.js?v=test';
    const worker = loadWorker(async request => {
        if (request.url === failingUrl) throw new Error('simulated weak-cell asset failure');
        return new Response(`asset:${request.url}`, { status: 200 });
    }, cacheState);

    await assert.rejects(runExtendable(worker.handlers.install), /weak-cell asset failure/);
    assert.equal(cacheState.stores.has(oldName), true, 'prior complete release must remain');
    assert.equal(
        cacheState.stores.has('bark-offline-shell-atomic-test'),
        false,
        'partial candidate shell must be removed'
    );
});

test('an install never mutates a complete existing same-version cache', async () => {
    const cacheName = 'bark-offline-shell-atomic-test';
    const oldEntry = new Response('currently active app');
    const cacheState = createCacheStore({
        [cacheName]: {
            'https://example.test/app/index.html': oldEntry,
            'https://example.test/app/.bark-shell-ready-atomic-test': new Response('atomic-test')
        }
    });
    let fetchCount = 0;
    const worker = loadWorker(async () => {
        fetchCount++;
        throw new Error('must not fetch into an active cache');
    }, cacheState);

    await runExtendable(worker.handlers.install);
    assert.equal(fetchCount, 0);
    assert.equal(cacheState.stores.has(cacheName), true);
    assert.equal(
        await cacheState.stores.get(cacheName).get('https://example.test/app/index.html').text(),
        'currently active app'
    );
});

test('an interrupted incomplete candidate is rebuilt on the next install', async () => {
    const cacheName = 'bark-offline-shell-atomic-test';
    const cacheState = createCacheStore({
        [cacheName]: {
            'https://example.test/app/index.html': new Response('partial candidate')
        }
    });
    const worker = loadWorker(
        async request => new Response(`fresh:${request.url}`, { status: 200 }),
        cacheState
    );

    await runExtendable(worker.handlers.install);
    const rebuilt = cacheState.stores.get(cacheName);
    assert.equal(rebuilt.has('https://example.test/app/index.html'), true);
    assert.equal(rebuilt.has('https://example.test/app/services/checkinService.js?v=test'), true);
    assert.equal(rebuilt.has('https://cdn.example.test/firebase.js'), true);
    assert.equal(rebuilt.has('https://example.test/app/.bark-shell-ready-atomic-test'), true);
});

test('healthy shell installs completely before activation removes the prior cache', async () => {
    const oldName = 'bark-offline-shell-prior';
    const cacheState = createCacheStore({
        [oldName]: {
            'https://example.test/app/index.html': new Response('old app')
        }
    });
    let fetchCount = 0;
    const worker = loadWorker(async request => {
        fetchCount++;
        return new Response(`asset:${request.url}`, { status: 200 });
    }, cacheState);

    await runExtendable(worker.handlers.install);
    assert.equal(cacheState.stores.has(oldName), true, 'install alone must not delete the active cache');
    const next = cacheState.stores.get('bark-offline-shell-atomic-test');
    assert.equal(fetchCount, 3);
    assert.equal(next.has('https://example.test/app/index.html'), true);
    assert.equal(next.has('https://example.test/app/services/checkinService.js?v=test'), true);
    assert.equal(next.has('https://cdn.example.test/firebase.js'), true);
    assert.equal(next.has('https://example.test/app/.bark-shell-ready-atomic-test'), true);

    await runExtendable(worker.handlers.activate);
    assert.equal(cacheState.stores.has(oldName), false, 'old cache retires only after complete activation');
});

test('a controlling worker serves its matching cached app entry without mixing newer HTML', async () => {
    const cacheName = 'bark-offline-shell-atomic-test';
    const cached = new Response('<html>coherent shell</html>', { status: 200 });
    const cacheState = createCacheStore({
        [cacheName]: {
            'https://example.test/app/index.html': cached
        }
    });
    let fetchCount = 0;
    const worker = loadWorker(async () => {
        fetchCount++;
        return new Response('<html>newer mixed shell</html>', { status: 200 });
    }, cacheState);

    const response = await runExtendable(worker.handlers.fetch, {
        request: {
            method: 'GET',
            mode: 'navigate',
            url: 'https://example.test/app/'
        }
    });
    assert.equal(await response.text(), '<html>coherent shell</html>');
    assert.equal(fetchCount, 0, 'entry navigation must not fetch/cache mismatched HTML');
});

test('the real 0.140 worker cannot poison its cache while private 0.141 installs atomically', async () => {
    const releaseManifest = loadPriorManifest();
    const legacyManifest = loadLegacyManifest();
    assert.equal(releaseManifest.version, '0.141');
    assert.equal(releaseManifest.entry, './index.v141.html');
    assert.equal(legacyManifest.version, '0.140');

    const releaseShell = new Set(releaseManifest.shell.map(value => value.replace(/^\.\//, '')));
    CUTOVER_STABLE_REFS.forEach(ref => {
        assert.match(PUBLIC_INDEX_SOURCE, new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(releaseShell.has(ref), true, `0.141 must retain legacy support for ${ref}`);
    });
    CORRECTIVE_PRIVATE_REFS.forEach(ref => {
        assert.match(PRIOR_PRIVATE_INDEX_SOURCE, new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(releaseShell.has(ref), true, `0.141 must cache private ${ref}`);
    });

    const oldName = 'bark-offline-shell-0.140';
    const oldEntries = {
        'https://example.test/app/index.html': new Response(PUBLIC_INDEX_SOURCE)
    };
    CUTOVER_STABLE_REFS.forEach(ref => {
        oldEntries[`https://example.test/app/${ref}`] = new Response(`legacy:${ref}`);
    });
    const cacheState = createCacheStore({ [oldName]: oldEntries });
    const blockedLegacyUrl = 'https://example.test/app/services/firebaseService.js?v=25';
    const legacyWorker = loadWorker(async request => {
        if (request.url === blockedLegacyUrl) throw new Error('simulated weak-cell legacy refresh failure');
        if (request.url === 'https://example.test/app/' || request.url.endsWith('/index.html')) {
            return new Response(PUBLIC_INDEX_SOURCE, { status: 200 });
        }
        const ref = request.url.replace('https://example.test/app/', '');
        return new Response(`legacy:${ref}`, { status: 200 });
    }, cacheState, legacyManifest, LEGACY_SW_SOURCE);

    // Exercise the actual deployed 0.140 network-first navigation and
    // BARK_CACHE_URLS/Promise.allSettled message path. One refresh fails, but
    // every successful response is byte-identical to the immutable public
    // body, so the active cache remains coherent.
    const navigated = await runExtendable(legacyWorker.handlers.fetch, {
        request: { method: 'GET', mode: 'navigate', url: 'https://example.test/app/' }
    });
    assert.equal(await navigated.text(), PUBLIC_INDEX_SOURCE);
    await runExtendable(legacyWorker.handlers.message, {
        data: {
            type: 'BARK_CACHE_URLS',
            urls: CUTOVER_STABLE_REFS.map(ref => `https://example.test/app/${ref}`)
        }
    });
    const oldCache = await cacheState.api.open(oldName);
    for (const ref of CUTOVER_STABLE_REFS) {
        const response = await oldCache.match(`https://example.test/app/${ref}`);
        assert.ok(response, `legacy cache must retain ${ref}`);
        assert.equal(await response.text(), `legacy:${ref}`);
    }

    // The private candidate may fail independently without touching 0.140.
    const blockedPrivateUrl = 'https://example.test/app/services/checkinService.v141.js';
    const failingWorker = loadWorker(async request => {
        if (request.url === blockedPrivateUrl) throw new Error('simulated private cutover failure');
        return new Response(`candidate:${request.url}`, { status: 200 });
    }, cacheState, releaseManifest, PRIOR_SW_SOURCE);
    await assert.rejects(runExtendable(failingWorker.handlers.install), /private cutover failure/);
    assert.equal(cacheState.stores.has(oldName), true, 'failed private install keeps 0.140');
    assert.equal(cacheState.stores.has('bark-offline-shell-0.141'), false);

    const worker = loadWorker(async request => {
        if (request.url.endsWith('/index.v141.html')) {
            return new Response(PRIOR_PRIVATE_INDEX_SOURCE, { status: 200 });
        }
        if (request.url.endsWith('/index.html') || request.url === 'https://example.test/app/') {
            return new Response(PUBLIC_INDEX_SOURCE, { status: 200 });
        }
        return new Response(`corrective:${request.url}`, { status: 200 });
    }, cacheState, releaseManifest, PRIOR_SW_SOURCE);
    await runExtendable(worker.handlers.install);
    assert.equal(cacheState.stores.has(oldName), true, '0.140 remains during complete install');
    const nextName = 'bark-offline-shell-0.141';
    const next = cacheState.stores.get(nextName);
    assert.ok(next);
    CORRECTIVE_PRIVATE_REFS.forEach(ref => {
        assert.ok(next.has(`https://example.test/app/${ref}`), `0.141 must contain ${ref}`);
    });

    await runExtendable(worker.handlers.activate);
    assert.equal(cacheState.stores.has(oldName), false, '0.140 retires only after complete 0.141');
    const response = await runExtendable(worker.handlers.fetch, {
        request: { method: 'GET', mode: 'navigate', url: 'https://example.test/app/' }
    });
    assert.equal(await response.text(), PRIOR_PRIVATE_INDEX_SOURCE, 'active 0.141 must serve its private entry');
});

test('the active private 0.141 shell survives until private 0.142 installs completely', async () => {
    const releaseManifest = loadReleaseManifest();
    const priorManifest = loadPriorManifest();
    assert.equal(releaseManifest.version, '0.142');
    assert.equal(releaseManifest.entry, './index.v142.html');
    assert.equal(priorManifest.version, '0.141');

    const releaseShell = new Set(releaseManifest.shell);
    priorManifest.shell.forEach(reference => {
        assert.equal(releaseShell.has(reference), true, `0.142 must retain 0.141 asset ${reference}`);
    });
    RELEASE_0142_REFS.forEach(ref => {
        assert.equal(releaseShell.has(`./${ref}`), true, `0.142 must cache ${ref}`);
    });
    assert.match(PRIVATE_INDEX_SOURCE, /modules\/dataService\.v142\.js/);

    const priorName = 'bark-offline-shell-0.141';
    const priorEntries = {
        'https://example.test/app/.bark-shell-ready-0.141': new Response('0.141'),
        'https://example.test/app/index.v141.html': new Response(PRIOR_PRIVATE_INDEX_SOURCE)
    };
    priorManifest.shell.forEach(reference => {
        const url = new URL(reference, 'https://example.test/app/').href;
        if (!priorEntries[url]) priorEntries[url] = new Response(`prior:${reference}`);
    });
    const cacheState = createCacheStore({ [priorName]: priorEntries });

    const blockedUrl = 'https://example.test/app/modules/dataService.v142.js';
    const failingWorker = loadWorker(async request => {
        if (request.url === blockedUrl) throw new Error('simulated 0.142 weak-cell failure');
        return new Response(`candidate:${request.url}`, { status: 200 });
    }, cacheState, releaseManifest);
    await assert.rejects(runExtendable(failingWorker.handlers.install), /0\.142 weak-cell failure/);
    assert.equal(cacheState.stores.has(priorName), true, 'failed 0.142 install must retain 0.141');
    assert.equal(cacheState.stores.has('bark-offline-shell-0.142'), false);

    const worker = loadWorker(async request => {
        if (request.url.endsWith('/index.v142.html')) {
            return new Response(PRIVATE_INDEX_SOURCE, { status: 200 });
        }
        if (request.url.endsWith('/index.v141.html')) {
            return new Response(PRIOR_PRIVATE_INDEX_SOURCE, { status: 200 });
        }
        if (request.url.endsWith('/index.html') || request.url === 'https://example.test/app/') {
            return new Response(PUBLIC_INDEX_SOURCE, { status: 200 });
        }
        return new Response(`release:${request.url}`, { status: 200 });
    }, cacheState, releaseManifest);

    await runExtendable(worker.handlers.install);
    assert.equal(cacheState.stores.has(priorName), true, '0.141 remains active during 0.142 install');
    const nextName = 'bark-offline-shell-0.142';
    const next = cacheState.stores.get(nextName);
    assert.ok(next);
    priorManifest.shell.forEach(reference => {
        const url = new URL(reference, 'https://example.test/app/').href;
        assert.equal(next.has(url), true, `0.142 cache must carry forward ${reference}`);
    });
    RELEASE_0142_REFS.forEach(ref => {
        assert.equal(next.has(`https://example.test/app/${ref}`), true, `0.142 cache must contain ${ref}`);
    });

    await runExtendable(worker.handlers.activate);
    assert.equal(cacheState.stores.has(priorName), false, '0.141 retires only after complete 0.142 activation');
    const response = await runExtendable(worker.handlers.fetch, {
        request: { method: 'GET', mode: 'navigate', url: 'https://example.test/app/' }
    });
    assert.equal(await response.text(), PRIVATE_INDEX_SOURCE, 'active 0.142 must serve its private entry');
});

test('the pinned 0.141 worker can forward-roll an installed 0.142 shell back to the prior private entry', async () => {
    const priorManifest = loadPriorManifest();
    assert.match(PRIOR_SW_SOURCE, /cacheManifest-0\.141\.js/);

    const currentName = 'bark-offline-shell-0.142';
    const cacheState = createCacheStore({
        [currentName]: {
            'https://example.test/app/.bark-shell-ready-0.142': new Response('0.142'),
            'https://example.test/app/index.v142.html': new Response(PRIVATE_INDEX_SOURCE)
        }
    });
    const rollbackWorker = loadWorker(async request => {
        if (request.url.endsWith('/index.v141.html')) {
            return new Response(PRIOR_PRIVATE_INDEX_SOURCE, { status: 200 });
        }
        if (request.url.endsWith('/index.html') || request.url === 'https://example.test/app/') {
            return new Response(PUBLIC_INDEX_SOURCE, { status: 200 });
        }
        return new Response(`rollback:${request.url}`, { status: 200 });
    }, cacheState, priorManifest, PRIOR_SW_SOURCE);

    await runExtendable(rollbackWorker.handlers.install);
    assert.equal(cacheState.stores.has(currentName), true, 'rollback install must not delete active 0.142');
    assert.equal(cacheState.stores.has('bark-offline-shell-0.141'), true);

    await runExtendable(rollbackWorker.handlers.activate);
    assert.equal(cacheState.stores.has(currentName), false);
    const response = await runExtendable(rollbackWorker.handlers.fetch, {
        request: { method: 'GET', mode: 'navigate', url: 'https://example.test/app/' }
    });
    assert.equal(await response.text(), PRIOR_PRIVATE_INDEX_SOURCE);
});
