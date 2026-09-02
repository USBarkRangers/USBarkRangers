const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_ROOT = path.join(__dirname, '..', '01-code', 'app');
const MANIFEST_PATH = path.join(APP_ROOT, 'offline', 'cacheManifest-0.142.js');
const PRIOR_MANIFEST_PATH = path.join(APP_ROOT, 'offline', 'cacheManifest-0.141.js');
const SW_PATH = path.join(APP_ROOT, 'sw.js');
const HTML_PATH = path.join(APP_ROOT, 'index.v142.html');

const LEGACY_PUBLIC_HASHES = Object.freeze({
    'index.html': '3d77650f4ee452fee1b456b8992f2560321765f8c82a2f3ea7f072f693d02035',
    'offline/cacheManifest.js': '3bcc4f38f103e796c74ef8bb459c34f89ed59dd804aba7ecf9385de6538fb8fb',
    'offline/offlineBootstrap.js': 'd4e70a438c89208625933c8936a1ae382171c4ff8cc42ae9821b2513d4b82e79',
    'core/app.js': '9887df86143984957436bcfde09b92e202745fd23272d95320a4dacc6b404659',
    'repos/VaultRepo.js': 'c0d8a455a9957396e3712e425002b2bc63fbd298087266de6a3b123cdbf779df',
    'services/authService.js': '02668e296fce547e50bb50f357aed790950892cecbd26c25ecedfb5c21d4375d',
    'services/checkinService.js': 'ad4f74120cd399fb614f14515df4b6ce23586dbad2716079d2fd5cd77bc18b19',
    'services/firebaseService.js': '52037f7503ba7c69e91f82743308933466a263d1a5c70b01e70b9747007985b9',
    'services/visitMutationCoordinator.js': '0e8eb9901c785b059f865a579b0eecd456f5d884fa4bde3ca11210993abee531'
});

const PRIOR_PRIVATE_HASHES = Object.freeze({
    'index.v141.html': '4fabbf0d3495884d191e2b66dc04435911e3a4187be11135b0f1e6a753ffa575',
    'offline/cacheManifest-0.141.js': 'b9a35f9c39072a7484efbd32b1df39eba175aa79d9d847681454aa9c8ac3df59',
    'styles.v141.css': '93466e931366f3d9fc8483e3317eeb00daf26627e5e490c03b6645665d6dc3fd',
    'core/app.v141.js': 'a09ab3b74a18f9bb564a9704df6d5fcceb3bafc35f7ce832bb482244a40d0907',
    'repos/VaultRepo.v141.js': '6341eff0ad79d3d27aef940fe7c72237c4c1c8f4698551e4c248b3a65cc8fcde',
    'services/authService.v141.js': '68ec6455eaa6000c597941e18fa7024648e1b9e6e60a57769e08b876190d7f2d',
    'services/checkinService.v141.js': 'f63d711da5a6642b8c2119342d631e45ba13e9ce51dd94be962cbc3359557b8a',
    'services/firebaseService.v141.js': '599e345b8296f6648d46e4a2b453763cf1f0f621c5b6b8d10f2fc3c07e04f0f6',
    'services/visitMutationCoordinator.v141.js': '4d0797eb81f62d927d81406d1a66f8ab8330dd7d86822a9fa0766a0e7373f219',
    'assets/data/bark-fallback.csv': 'bfaafe6b0787cfc4a18568998b5248b917fb4e9193f3151264cf44e2128374bc'
});

function loadCacheManifest(manifestPath = MANIFEST_PATH) {
    const context = { self: {} };
    vm.runInNewContext(fs.readFileSync(manifestPath, 'utf8'), context, { filename: manifestPath });
    return context.self.BARK_OFFLINE_CACHE_MANIFEST;
}

test('offline shell version matches the app release', () => {
    const manifest = loadCacheManifest();
    const version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'version.json'), 'utf8')).version;
    assert.equal(manifest.version, version);
    assert.equal(version, '0.142');
});

test('the public 0.140 shell remains byte-identical for dormant legacy workers', () => {
    Object.entries(LEGACY_PUBLIC_HASHES).forEach(([relativePath, expectedHash]) => {
        const bytes = fs.readFileSync(path.join(APP_ROOT, relativePath));
        const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
        assert.equal(actualHash, expectedHash, `${relativePath} must remain immutable during cutover`);
    });
});

test('the private 0.141 shell and fallback remain byte-identical for active prior workers', () => {
    Object.entries(PRIOR_PRIVATE_HASHES).forEach(([relativePath, expectedHash]) => {
        const bytes = fs.readFileSync(path.join(APP_ROOT, relativePath));
        const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
        assert.equal(actualHash, expectedHash, `${relativePath} must remain immutable during 0.142 cutover`);
    });

    const priorWorker = fs.readFileSync(path.join(__dirname, 'fixtures', 'sw-0.141.js'));
    const priorWorkerHash = crypto.createHash('sha256').update(priorWorker).digest('hex');
    assert.equal(priorWorkerHash, '1742025c7159d147f0f590d8451ef3b8ae63295f0173fbc2896017b8c4177792');
});

test('the corrective worker uses the physical 0.142 manifest and private entry', () => {
    const manifest = loadCacheManifest();
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.equal(manifest.entry, './index.v142.html');
    assert.match(sw, /cacheManifest-0\.142\.js/);
    assert.doesNotMatch(sw, /cacheManifest-0\.141\.js/);
    assert.doesNotMatch(sw, /cacheManifest\.js\?v=/);
});

test('the 0.142 shell is a complete union of the private 0.141 shell and new physical assets', () => {
    const manifest = loadCacheManifest();
    const priorManifest = loadCacheManifest(PRIOR_MANIFEST_PATH);
    const shell = new Set(manifest.shell);

    priorManifest.shell.forEach(reference => {
        assert.equal(shell.has(reference), true, `0.142 must retain prior shell asset ${reference}`);
    });
    assert.equal(shell.has('./index.v142.html'), true);
    assert.equal(shell.has('./modules/dataService.v142.js'), true);
    assert.equal(shell.has('./assets/data/bark-fallback-0.142.csv'), true);
});

test('every local startup script and stylesheet is in the offline shell', () => {
    const manifest = loadCacheManifest();
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const references = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g), match => match[1])
        .filter(value => !value.startsWith('http') && !value.startsWith('//') && !value.startsWith('#'))
        .filter(value => /\.(?:js|css|json|jpe?g)(?:\?|$)/i.test(value));
    const cached = new Set(manifest.shell.map(value => value.replace(/^\.\//, '')));
    const missing = Array.from(new Set(references.filter(value => !cached.has(value))));
    assert.deepEqual(missing, [], `offline shell is missing: ${missing.join(', ')}`);
    assert.match(html, /modules\/dataService\.v142\.js/);

    const dataService = fs.readFileSync(path.join(APP_ROOT, 'modules', 'dataService.v142.js'), 'utf8');
    assert.match(dataService, /assets\/data\/bark-fallback-0\.142\.csv/);
    assert.doesNotMatch(dataService, /['"]assets\/data\/bark-fallback\.csv['"]/);
});

test('every local 0.142 shell resource exists on disk', () => {
    const manifest = loadCacheManifest();
    const missing = Array.from(
        manifest.shell,
        reference => reference.replace(/^\.\//, '').split('?')[0]
    )
        .filter(Boolean)
        .filter(relativePath => !fs.existsSync(path.join(APP_ROOT, relativePath)));
    assert.deepEqual(missing, [], `offline shell references missing files: ${missing.join(', ')}`);
});

test('critical CDN startup dependencies are cached but cloud data endpoints are not', () => {
    const manifest = loadCacheManifest();
    const external = manifest.criticalExternal.join('\n');
    assert.match(external, /leaflet@1\.9\.4/);
    assert.match(external, /firebase-app-compat\.js/);
    assert.match(external, /papaparse/);
    assert.doesNotMatch(external, /firestore\.googleapis|docs\.google\.com|lemon|openrouteservice/i);
});

test('offline tiles are bounded, high-zoom only, and never prefetched', () => {
    const manifest = loadCacheManifest();
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.ok(manifest.minimumOfflineTileZoom >= 11);
    assert.ok(manifest.maximumOfflineTiles <= 400);
    assert.match(sw, /getTileZoom\(url\)/);
    assert.match(sw, /tileZoom >= CONFIG\.minimumOfflineTileZoom/);
    assert.match(sw, /keys\.slice\(0, excess\)/);
    assert.doesNotMatch(sw, /prefetch|downloadArea|seedTiles/i);
});

test('service worker does not intercept writes or cache Firebase/API responses', () => {
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.match(sw, /if \(request\.method !== 'GET'\) return/);
    assert.doesNotMatch(sw, /firebaseio|firestore\.googleapis|cloudfunctions|lemonsqueezy|openrouteservice/i);
});
