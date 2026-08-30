const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_ROOT = path.join(__dirname, '..', '01-code', 'app');
const MANIFEST_PATH = path.join(APP_ROOT, 'offline', 'cacheManifest.js');
const SW_PATH = path.join(APP_ROOT, 'sw.js');
const HTML_PATH = path.join(APP_ROOT, 'index.html');

function loadCacheManifest() {
    const context = { self: {} };
    vm.runInNewContext(fs.readFileSync(MANIFEST_PATH, 'utf8'), context, { filename: MANIFEST_PATH });
    return context.self.BARK_OFFLINE_CACHE_MANIFEST;
}

test('offline shell version matches the app release', () => {
    const manifest = loadCacheManifest();
    const version = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'version.json'), 'utf8')).version;
    assert.equal(manifest.version, version);
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
