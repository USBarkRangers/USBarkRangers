/* global BARK_OFFLINE_CACHE_MANIFEST, importScripts */
/**
 * sw.js — minimum offline shell for the installed B.A.R.K. web app.
 *
 * Scope is intentionally limited to static startup assets and tiles the user
 * actually viewed at high zoom. Firebase/API/payment/routing responses are
 * never stored here.
 */
// This corrective worker must never pair with a mutable or prior manifest.
// The physical release path makes its cache identity inseparable from 0.144.
importScripts('./offline/cacheManifest-0.144.js');

const CONFIG = self.BARK_OFFLINE_CACHE_MANIFEST;
const SHELL_CACHE_PREFIX = 'bark-offline-shell-';
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${CONFIG.version}`;
const TILE_CACHE = 'bark-offline-high-zoom-tiles-v1';
const APP_SCOPE_URL = new URL(self.registration.scope);
const APP_ENTRY_URL = new URL(CONFIG.entry || './index.html', APP_SCOPE_URL).href;
const SHELL_READY_URL = new URL(`./.bark-shell-ready-${CONFIG.version}`, APP_SCOPE_URL).href;
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

// Cover headers AND body. A network timeout must settle even when abort is ignored.
async function fetchComplete(request, timeoutMs) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Network deadline exceeded'));
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            (async () => {
                const response = await fetch(request, { signal: controller.signal });
                if (response.type === 'opaque') return response;
                const body = await response.arrayBuffer();
                return new Response(body, {
                    status: response.status, statusText: response.statusText,
                    headers: response.headers
                });
            })(),
            timeout
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function cacheOne(cache, requestOrUrl, options = {}) {
    const request = requestOrUrl instanceof Request
        ? requestOrUrl
        : new Request(requestOrUrl, {
            credentials: new URL(requestOrUrl).origin === APP_SCOPE_URL.origin ? 'same-origin' : 'omit',
            cache: options.reload ? 'reload' : 'default'
        });
    const response = await fetchComplete(request, options.timeoutMs || CONFIG.staticTimeoutMs || 4000);
    if (!response || (!response.ok && response.type !== 'opaque')) {
        throw new Error(`Offline cache fetch failed: ${request.url}`);
    }
    await cache.put(request, response.clone());
    return response;
}

async function warmShell(urls, options = {}) {
    const existingNames = await caches.keys();
    const cacheAlreadyExisted = existingNames.includes(SHELL_CACHE);
    let cache = await caches.open(SHELL_CACHE);
    const existingReady = await cache.match(SHELL_READY_URL);
    // A versioned shell is immutable once complete. Never refresh its
    // unversioned index.html with a newer release or mutate an active cache.
    if (existingReady) return;
    if (options.required === true && cacheAlreadyExisted) {
        // A worker cannot activate without the ready marker, so a same-version
        // markerless cache is an interrupted candidate. Rebuild it cleanly.
        await caches.delete(SHELL_CACHE);
        cache = await caches.open(SHELL_CACHE);
    }
    const uniqueUrls = Array.from(new Set(urls));
    const requests = uniqueUrls.map(url => cacheOne(cache, url, {
        reload: true,
        timeoutMs: 8000
    }));

    if (options.required === true) {
        try {
            const outcomes = await Promise.allSettled(requests);
            const failure = outcomes.find(result => result.status === 'rejected');
            if (failure) throw failure.reason;
            await cache.put(SHELL_READY_URL, new Response(CONFIG.version, {
                headers: { 'Content-Type': 'text/plain' }
            }));
        } catch (error) {
            // Never activate a partially downloaded release or delete the last
            // complete shell. The browser will keep the prior worker and retry
            // this installation when service improves.
            await caches.delete(SHELL_CACHE);
            throw error;
        }
        return;
    }

    await Promise.allSettled(requests);
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
    const networkRefresh = fetchComplete(event.request, CONFIG.tileTimeoutMs || 4000)
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
    try { return await fetchComplete(request, CONFIG.tileTimeoutMs || 4000); }
    catch (_error) { return offlineTileResponse(); }
}

async function cacheFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    // An already-open prior release can still ask for its immutable files.
    const previousNames = (await caches.keys()).filter(name =>
        name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE).reverse();
    for (const name of previousNames) {
        const previous = await (await caches.open(name)).match(request, { ignoreSearch: false });
        if (previous) return previous;
    }
    return cacheOne(cache, request);
}

async function serveNavigation(request) {
    const cache = await caches.open(SHELL_CACHE);
    const requestUrl = new URL(request.url);
    const appIndexPath = `${APP_SCOPE_URL.pathname}index.html`;
    const isAppEntry = requestUrl.pathname === APP_SCOPE_URL.pathname
        || requestUrl.pathname === appIndexPath
        || requestUrl.pathname === new URL(APP_ENTRY_URL).pathname;
    if (isAppEntry) {
        // A controlling old worker must serve its matching precached HTML. It
        // must not put newer network HTML (which references newer scripts) into
        // the old cache. Once the new shell installs completely, its worker and
        // HTML become active together.
        const coherentEntry = await cache.match(APP_ENTRY_URL, { ignoreSearch: true })
            || await cache.match(toScopedUrl('./'), { ignoreSearch: true });
        if (coherentEntry) return coherentEntry;
    }
    const savedPage = await cache.match(request, { ignoreSearch: true });
    if (savedPage) return savedPage;
    try {
        const response = await fetchComplete(request, CONFIG.navigationTimeoutMs);
        if (response && response.ok) {
            if (!isAppEntry) await cache.put(request, response.clone());
        }
        return response;
    } catch (_error) {
        return await cache.match(request, { ignoreSearch: true })
            || (isAppEntry ? await cache.match(APP_ENTRY_URL, { ignoreSearch: true }) : null)
            || (isAppEntry ? await cache.match(toScopedUrl('./'), { ignoreSearch: true }) : null)
            || new Response('B.A.R.K. offline startup is not prepared on this device yet.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
    }
}

self.addEventListener('install', event => {
    const shellUrls = CONFIG.shell.map(toScopedUrl);
    event.waitUntil((async () => {
        await warmShell([...shellUrls, ...CONFIG.criticalExternal], { required: true });
        // Take control only after every current startup file is local.
        // Keep the previous cache for pages already open during this cutover.
        if (typeof self.skipWaiting === 'function') await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const shellCache = await caches.open(SHELL_CACHE);
        const ready = await shellCache.match(SHELL_READY_URL);
        if (!ready) throw new Error(`Offline shell ${CONFIG.version} is incomplete.`);
        const names = await caches.keys();
        const previousNames = names.filter(name => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE);
        // Retain one prior release for old open clients; keep storage bounded.
        await Promise.all(previousNames.slice(0, -1).map(name => caches.delete(name)));
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
        event.respondWith(serveNavigation(request));
        return;
    }

    const tileZoom = getTileZoom(url);
    if (tileZoom !== null) {
        event.respondWith(tileZoom >= CONFIG.minimumOfflineTileZoom
            ? serveHighZoomTile(event)
            : serveUncachedTile(request));
        return;
    }

    // Older open pages may still request CDN URLs. Serve the identical pinned
    // dependency locally without requiring that CDN during the upgrade.
    const localDependency = CONFIG.legacyExternal && CONFIG.legacyExternal[url.href];
    if (localDependency) {
        event.respondWith(cacheFirst(new Request(toScopedUrl(localDependency))));
        return;
    }
    // The release check is intentionally live, not frozen in the shell cache.
    if (url.origin === APP_SCOPE_URL.origin && url.pathname === new URL('./version.json', APP_SCOPE_URL).pathname) {
        event.respondWith(fetchComplete(request, CONFIG.staticTimeoutMs || 4000)
            .catch(async () => await (await caches.open(SHELL_CACHE)).match(toScopedUrl('./version.json'))
                || new Response('Release check unavailable.', { status: 503 })));
        return;
    }
    if (isCriticalExternalUrl(url) || isAppStaticRequest(request, url)) {
        event.respondWith(cacheFirst(request).catch(() => new Response('This app file is unavailable. Retry when connected.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })));
    }
});
