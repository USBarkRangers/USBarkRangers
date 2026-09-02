/* global BARK_OFFLINE_CACHE_MANIFEST, importScripts */
/**
 * sw.js — minimum offline shell for the installed B.A.R.K. web app.
 *
 * Scope is intentionally limited to static startup assets and tiles the user
 * actually viewed at high zoom. Firebase/API/payment/routing responses are
 * never stored here.
 */
importScripts('./offline/cacheManifest.js?v=3');

const CONFIG = self.BARK_OFFLINE_CACHE_MANIFEST;
const SHELL_CACHE_PREFIX = 'bark-offline-shell-';
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${CONFIG.version}`;
const TILE_CACHE = 'bark-offline-high-zoom-tiles-v1';
const APP_SCOPE_URL = new URL(self.registration.scope);
const OFFLINE_TILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#e5e7eb"/><path d="M0 64h256M0 128h256M0 192h256M64 0v256M128 0v256M192 0v256" stroke="#d1d5db" stroke-width="1"/></svg>';
let tileWritesSinceTrim = 0;

function toScopedUrl(value) {
    return new URL(value, APP_SCOPE_URL).href;
}

function isCriticalExternalUrl(url) {
    return CONFIG.criticalExternal.some(value => url.href === value);
}

function isAppStaticRequest(request, url) {
    if (url.origin !== APP_SCOPE_URL.origin || !url.pathname.startsWith(APP_SCOPE_URL.pathname)) return false;
    if (request.method !== 'GET') return false;
    return ['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)
        || /\.(?:js|css|csv|json|png|jpe?g|webp|svg|woff2?)$/i.test(url.pathname);
}

function getTileZoom(url) {
    const host = url.hostname.toLowerCase();
    if (host.endsWith('tile.openstreetmap.org') || host === 'tile.opentopomap.org' || host.endsWith('.tile.opentopomap.org')) {
        const match = url.pathname.match(/^\/(\d+)\/\d+\/\d+\.png$/);
        return match ? Number(match[1]) : null;
    }
    if (host === 'server.arcgisonline.com') {
        const match = url.pathname.match(/\/tile\/(\d+)\/\d+\/\d+$/);
        return match ? Number(match[1]) : null;
    }
    return null;
}

function offlineTileResponse() {
    return new Response(OFFLINE_TILE_SVG, {
        status: 200,
        headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'no-store'
        }
    });
}

async function cacheOne(cache, requestOrUrl, options = {}) {
    const request = requestOrUrl instanceof Request
        ? requestOrUrl
        : new Request(requestOrUrl, {
            credentials: new URL(requestOrUrl).origin === APP_SCOPE_URL.origin ? 'same-origin' : 'omit',
            cache: options.reload ? 'reload' : 'default'
        });
    const controller = options.timeoutMs ? new AbortController() : null;
    const timeoutId = controller
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : null;
    try {
        const response = await fetch(request, controller ? { signal: controller.signal } : undefined);
        if (!response || (!response.ok && response.type !== 'opaque')) {
            throw new Error(`Offline cache fetch failed: ${request.url}`);
        }
        await cache.put(request, response.clone());
        return response;
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}

async function warmShell(urls) {
    const cache = await caches.open(SHELL_CACHE);
    const uniqueUrls = Array.from(new Set(urls));
    await Promise.allSettled(uniqueUrls.map(url => cacheOne(cache, url, {
        reload: true,
        timeoutMs: 8000
    })));
}

async function trimTileCache(cache) {
    const keys = await cache.keys();
    const excess = keys.length - CONFIG.maximumOfflineTiles;
    if (excess <= 0) return;
    await Promise.all(keys.slice(0, excess).map(key => cache.delete(key)));
}

async function rememberTile(cache, request, response) {
    if (!response || (!response.ok && response.type !== 'opaque')) return;
    await cache.put(request, response.clone());
    tileWritesSinceTrim += 1;
    if (tileWritesSinceTrim < 12) return;
    tileWritesSinceTrim = 0;
    await trimTileCache(cache);
}

async function serveHighZoomTile(event) {
    const cache = await caches.open(TILE_CACHE);
    const cached = await cache.match(event.request);
    const networkRefresh = fetch(event.request)
        .then(async response => {
            await rememberTile(cache, event.request, response);
            return response;
        });

    if (cached) {
        event.waitUntil(networkRefresh.catch(() => {}));
        return cached;
    }

    try {
        return await networkRefresh;
    } catch (_error) {
        return offlineTileResponse();
    }
}

async function serveUncachedTile(request) {
    try { return await fetch(request); }
    catch (_error) { return offlineTileResponse(); }
}

async function cacheFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    return cacheOne(cache, request);
}

async function networkFirstNavigation(request) {
    const cache = await caches.open(SHELL_CACHE);
    const requestUrl = new URL(request.url);
    const appIndexPath = `${APP_SCOPE_URL.pathname}index.html`;
    const isAppEntry = requestUrl.pathname === APP_SCOPE_URL.pathname
        || requestUrl.pathname === appIndexPath;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.navigationTimeoutMs);

    try {
        const response = await fetch(request, { signal: controller.signal });
        if (response && response.ok) {
            await cache.put(isAppEntry ? toScopedUrl('./index.html') : request, response.clone());
        }
        return response;
    } catch (_error) {
        return await cache.match(request, { ignoreSearch: true })
            || (isAppEntry ? await cache.match(toScopedUrl('./index.html'), { ignoreSearch: true }) : null)
            || (isAppEntry ? await cache.match(toScopedUrl('./'), { ignoreSearch: true }) : null)
            || new Response('B.A.R.K. offline startup is not prepared on this device yet.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
    } finally {
        clearTimeout(timeoutId);
    }
}

self.addEventListener('install', event => {
    const shellUrls = CONFIG.shell.map(toScopedUrl);
    event.waitUntil(warmShell([...shellUrls, ...CONFIG.criticalExternal]));
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter(name => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE)
            .map(name => caches.delete(name)));
        // Enforce the bound after restarts too. A browser can stop the worker
        // between the last write and the every-twelve-writes maintenance pass.
        await trimTileCache(await caches.open(TILE_CACHE));
        await self.clients.claim();
    })());
});

self.addEventListener('message', event => {
    if (!event.data || event.data.type !== 'BARK_CACHE_URLS' || !Array.isArray(event.data.urls)) return;
    const allowed = event.data.urls.filter(value => {
        try {
            const url = new URL(value, APP_SCOPE_URL);
            return (url.origin === APP_SCOPE_URL.origin && url.pathname.startsWith(APP_SCOPE_URL.pathname))
                || isCriticalExternalUrl(url);
        } catch (_error) {
            return false;
        }
    });
    event.waitUntil(warmShell(allowed));
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    const tileZoom = getTileZoom(url);
    if (tileZoom !== null) {
        event.respondWith(tileZoom >= CONFIG.minimumOfflineTileZoom
            ? serveHighZoomTile(event)
            : serveUncachedTile(request));
        return;
    }

    if (isCriticalExternalUrl(url) || isAppStaticRequest(request, url)) {
        event.respondWith(cacheFirst(request).catch(() => fetch(request)));
    }
});
