const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_ROOT = path.join(__dirname, '..', '01-code', 'app');
const MANIFEST_PATH = path.join(APP_ROOT, 'offline', 'cacheManifest-0.141.js');
const SW_PATH = path.join(APP_ROOT, 'sw.js');
const HTML_PATH = path.join(APP_ROOT, 'index.v141.html');

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

function loadCacheManifest() {
    const context = { self: {} };
    vm.runInNewContext(fs.readFileSync(MANIFEST_PATH, 'utf8'), context, { filename: MANIFEST_PATH });
    return context.self.BARK_OFFLINE_CACHE_MANIFEST;
}

test('offline shell version matches the app release', () => {
    const manifest = loadCacheManifest();
    const version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'version.json'), 'utf8')).version;
    assert.equal(manifest.version, version);
    assert.notEqual(
        version,
        '0.140',
        'the corrective worker must not reuse the active rollback cache name'
    );
});

test('the public 0.140 shell remains byte-identical for dormant legacy workers', () => {
    Object.entries(LEGACY_PUBLIC_HASHES).forEach(([relativePath, expectedHash]) => {
        const bytes = fs.readFileSync(path.join(APP_ROOT, relativePath));
        const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
        assert.equal(actualHash, expectedHash, `${relativePath} must remain immutable during cutover`);
    });
});

test('the corrective worker uses a physical manifest and private entry', () => {
    const manifest = loadCacheManifest();
    const sw = fs.readFileSync(SW_PATH, 'utf8');
    assert.equal(manifest.entry, './index.v141.html');
    assert.match(sw, /cacheManifest-0\.141\.js/);
    assert.doesNotMatch(sw, /cacheManifest\.js\?v=/);
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
