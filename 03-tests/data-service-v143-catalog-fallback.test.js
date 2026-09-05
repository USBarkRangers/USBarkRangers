const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const serviceSource = fs.readFileSync(
    path.join(repoRoot, '01-code', 'app', 'modules', 'dataService.v143.js'),
    'utf8'
);

function catalogCsv(prefix, count = 300) {
    const rows = ['Location,State,Swag Cost,Type,Useful/Important/Other Info,Website,lat,lng,Park ID'];
    for (let index = 0; index < count; index++) {
        rows.push(`${prefix} Park ${index},MD,Free,State,Tag,https://example.test/${index},39.${String(index).padStart(4, '0')},-77.${String(index).padStart(4, '0')},${prefix}-id-${index}`);
    }
    return rows.join('\n');
}

function parseSimpleCsv(csvString, options) {
    const lines = String(csvString).trim().split(/\r?\n/);
    const headers = lines[0].split(',').map(value => options.transformHeader(value));
    const data = lines.slice(1).map(line => {
        const values = line.split(',').map(value => options.transform(value));
        return headers.reduce((row, header, index) => {
            const value = values[index] || '';
            row[header] = options.dynamicTyping && value !== '' && Number.isFinite(Number(value))
                ? Number(value)
                : value;
            return row;
        }, {});
    });
    options.complete({ data, errors: [] });
}

function response(body, options = {}) {
    const headers = new Map(Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    return {
        ok: options.ok !== false,
        status: options.status || 200,
        url: options.url || '',
        headers: { get: name => headers.get(String(name).toLowerCase()) || null },
        text: async () => body
    };
}

function createHarness(options = {}) {
    const storage = new Map(Object.entries(options.storage || {}));
    const requests = [];
    let points = [];
    let timerId = 0;

    async function fetchStub(url) {
        const value = String(url);
        requests.push(value);
        if (value.includes('docs.google.com')) {
            if (options.liveError) throw options.liveError;
            return response(options.liveCsv || '<html>temporarily overloaded</html>', { url: value });
        }
        if (value.includes('cloudfunctions.net/catalogSnapshot')) {
            return response(options.remoteCsv || catalogCsv('remote'), {
                url: value,
                headers: { 'last-modified': options.remoteLastModified || 'Tue, 01 Sep 2026 12:00:00 GMT' }
            });
        }
        if (value.includes('bark-fallback-0.142.csv')) {
            return response(options.staticCsv || catalogCsv('static'), { url: value });
        }
        throw new Error(`Unexpected fetch: ${value}`);
    }

    const sandbox = {
        AbortController,
        console,
        Date,
        Math,
        Promise,
        fetch: fetchStub,
        setTimeout() { timerId += 1; return timerId; },
        clearTimeout() {},
        alert() {},
        navigator: { onLine: options.online !== false },
        document: { hidden: false, addEventListener() {} },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); }
        },
        Papa: { parse: parseSimpleCsv },
        window: {
            addEventListener() {},
            location: { protocol: 'https:' },
            BARK: {
                services: {},
                repos: {
                    ParkRepo: {
                        getAll: () => points,
                        replaceAll(next) { points = next; return { accepted: true }; }
                    }
                },
                incrementRequestCount() {},
                getSwagType: () => 'Other',
                getParkCategory: value => value || 'Unknown',
                normalizeText: value => String(value || '').toLowerCase()
            },
            syncState() {}
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(serviceSource, sandbox);
    return { sandbox, requests, storage, getPoints: () => points };
}

async function settle() {
    for (let index = 0; index < 12; index++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

test('v142 rejects an invalid live 200, upgrades the physical fallback, and persists the validated snapshot', async () => {
    const remoteCsv = catalogCsv('remote');
    const harness = createHarness({ remoteCsv });

    harness.sandbox.window.BARK.loadData();
    await settle();

    assert.equal(harness.requests.filter(url => url.includes('docs.google.com')).length, 1);
    assert.equal(harness.requests.filter(url => url.includes('cloudfunctions.net/catalogSnapshot')).length, 1);
    assert.equal(harness.getPoints().length, 300);
    assert.equal(harness.getPoints()[0].name, 'remote Park 0');
    assert.equal(harness.storage.get('barkCSV'), remoteCsv);
    assert.equal(
        harness.storage.get('barkCSV_time'),
        String(Date.parse('Tue, 01 Sep 2026 12:00:00 GMT'))
    );
});

test('v142 fetches the fallback after a live failure but cannot replace a newer cached catalog', async () => {
    const cachedCsv = catalogCsv('cached');
    const cachedTime = Date.parse('Wed, 02 Sep 2026 12:00:00 GMT');
    const harness = createHarness({
        storage: { barkCSV: cachedCsv, barkCSV_time: String(cachedTime) },
        liveError: new Error('sheet unavailable'),
        remoteCsv: catalogCsv('older-remote'),
        remoteLastModified: 'Tue, 01 Sep 2026 12:00:00 GMT'
    });

    harness.sandbox.window.BARK.loadData();
    await settle();

    assert.equal(harness.requests.filter(url => url.includes('cloudfunctions.net/catalogSnapshot')).length, 1);
    assert.equal(harness.getPoints().length, 300);
    assert.equal(harness.getPoints()[0].name, 'cached Park 0');
    assert.equal(harness.storage.get('barkCSV'), cachedCsv);
    assert.equal(harness.storage.get('barkCSV_time'), String(cachedTime));
});

test('v142 recovers an offline boot with a corrupt cached key from the physical fallback', async () => {
    const harness = createHarness({
        online: false,
        storage: { barkCSV: '<html>bad cache</html>', barkCSV_time: '1' }
    });

    harness.sandbox.window.BARK.loadData();
    await settle();

    assert.equal(harness.requests.some(url => url.includes('docs.google.com')), false);
    assert.equal(harness.requests.some(url => url.includes('cloudfunctions.net/catalogSnapshot')), false);
    assert.equal(harness.requests.filter(url => url.includes('bark-fallback-0.142.csv')).length, 1);
    assert.equal(harness.getPoints().length, 300);
    assert.equal(harness.getPoints()[0].name, 'static Park 0');
});

test('v142 never requests the remote snapshot after an accepted live Sheet catalog', async () => {
    const cachedCsv = catalogCsv('cached');
    const liveCsv = catalogCsv('live');
    const harness = createHarness({
        storage: { barkCSV: cachedCsv, barkCSV_time: '1' },
        liveCsv
    });

    harness.sandbox.window.BARK.loadData();
    await settle();

    assert.equal(harness.requests.filter(url => url.includes('docs.google.com')).length, 1);
    assert.equal(harness.requests.some(url => url.includes('cloudfunctions.net/catalogSnapshot')), false);
    assert.equal(harness.getPoints()[0].name, 'live Park 0');
    assert.equal(harness.storage.get('barkCSV'), liveCsv);
});

test('catalog deadline includes a body that hangs after successful headers', async () => {
    const context = {
        window: { BARK: {} }, console, AbortController, setTimeout, clearTimeout,
        fetch: async () => ({ ok: true, status: 200, text: () => new Promise(() => {}) })
    };
    // Only exercise the standalone deadline helper; the rest of this file verifies
    // the real catalog acceptance and last-known-data rules through full loadData.
    const helper = serviceSource.slice(serviceSource.indexOf('async function fetchWithDeadline('), serviceSource.indexOf('\nfunction loadStaticFallbackData('));
    vm.runInNewContext(helper, context);
    await assert.rejects(context.fetchWithDeadline('https://example.test/catalog', {}, 25), { name: 'AbortError' });
});
