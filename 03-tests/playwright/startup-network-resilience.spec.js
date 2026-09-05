const { test, expect, chromium, webkit } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const appRoot = path.resolve(__dirname, '../../01-code/app');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv', '.png': 'image/png', '.jpeg': 'image/jpeg' };

async function serveApp() {
    const state = { stall: false, stallAsset: false, stalled: 0 };
    const sockets = new Set();
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (state.stall || (state.stallAsset && pathname.includes('mapEngine.v143.js'))) {
            state.stalled++;
            return; // Real socket stays open: bars present, no response, no offline event.
        }
        const file = path.join(appRoot, pathname === '/' ? 'index.v144.html' : pathname);
        if (!file.startsWith(appRoot) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
        let body = fs.readFileSync(file);
        if (pathname.endsWith('authService.v141.js')) {
            body = Buffer.from(body.toString() + '\nwindow.BARK.services.auth.initFirebase = () => new Promise(() => {});');
        }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
    });
    // WebKit can bypass page routing for requests originating in a worker.
    // Refuse external HTTPS at the proxy too, so 'fake service' cannot secretly
    // reach the live Sheet and legitimately replace our last-known fixture.
    server.on('connect', (_req, socket) => socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'));
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        state, url: `http://127.0.0.1:${server.address().port}`,
        async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
    };
}

for (const [name, browserType] of [['Android Chromium', chromium], ['iPhone WebKit', webkit]]) {
    test(`${name}: saved pins survive hanging service, reload, Sheets rejection, and recovery`, async () => {
        test.setTimeout(60000);
        const server = await serveApp();
        const browser = await browserType.launch({ proxy: { server: server.url, bypass: '127.0.0.1,localhost' } });
        const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        // All third-party services may be unavailable. Essential libraries must be local.
        let sheetRequests = 0;
        await context.route('**/*', route => {
            if (route.request().url().startsWith(server.url)) return route.continue();
            if (route.request().url().includes('docs.google.com')) {
                sheetRequests++;
                return route.fulfill({ status: 429, body: 'Too many requests' });
            }
            return route.abort('failed');
        });
        await context.addInitScript(() => {
            window.__initialCatalog = { len: (localStorage.getItem('barkCSV') || '').length, known: (localStorage.getItem('barkCSV') || '').includes('Last Known Acadia'), journal: localStorage.getItem('bark.unconfirmedVisits.startup-test') };
            localStorage.setItem('barkTermsAgreement', '1');
        });
        try {
            let page = await context.newPage();
            await page.goto(`${server.url}/index.v144.html`, { waitUntil: 'domcontentloaded' });
            await expect(page.locator('#bark-loader')).toHaveCount(0, { timeout: 4000 });
            const count = await page.evaluate(() => window.BARK.repos.ParkRepo.getAll().length);
            expect(count).toBeGreaterThan(300);
            expect(sheetRequests).toBeGreaterThan(0);
            await expect.poll(() => page.evaluate(async () => {
                const cache = await caches.open('bark-offline-shell-0.144');
                return !!(navigator.serviceWorker.controller && await cache.match(new URL('./.bark-shell-ready-0.144', location.href).href));
            }), { timeout: 15000 }).toBe(true);
            // Seed a last-known catalog distinct from the bundled snapshot, and a durable journal.
            await page.evaluate(async () => {
                const csv = await (await fetch('./assets/data/bark-fallback-0.142.csv')).text();
                localStorage.setItem('barkCSV', csv.replaceAll('Acadia National Park', 'Last Known Acadia National Park'));
                localStorage.setItem('barkCSV_time', String(Date.now()));
                localStorage.setItem('bark.unconfirmedVisits.startup-test', '{"kept":"durable"}');
                const park = window.BARK.repos.ParkRepo.getAll()[0];
                localStorage.setItem('startup-saved-green-id', park.id);
                localStorage.setItem('bark.lastAuthenticatedVisitUid', 'startup-test');
                localStorage.setItem('bark.authoritativeVisits.startup-test', JSON.stringify({
                    schemaVersion: 1, uid: 'startup-test', visits: [{ id: park.id, name: park.name, lat: park.lat, lng: park.lng, ts: Date.now(), verified: false }]
                }));
            });
            expect(await page.evaluate(() => (localStorage.getItem('barkCSV') || '').includes('Last Known Acadia'))).toBe(true);
            server.state.stall = true;
            await page.close();
            page = await context.newPage();
            const started = Date.now();
            await page.goto(`${server.url}/?coldFakeCell=1`, { waitUntil: 'domcontentloaded' });
            await expect(page.locator('#bark-loader')).toHaveCount(0, { timeout: 4000 });
            expect(Date.now() - started).toBeLessThan(4500);
            const expectSavedGreen = async () => {
                await expect.poll(() => page.evaluate(() => {
                    const id = localStorage.getItem('startup-saved-green-id');
                    const repo = window.BARK.repos.VaultRepo;
                    const marker = window.BARK.markerManager.markers.get(id);
                    return repo.hasVisit(id) && !repo.hasPendingMutation(id)
                        && !!marker?._icon?.classList.contains('visited-marker');
                }), { timeout: 2500, intervals: [100] }).toBe(true);
            };
            await expectSavedGreen();
            expect(await page.evaluate(() => navigator.onLine)).toBe(true);
            expect(await page.evaluate(() => window.__initialCatalog.known)).toBe(true);
            expect(await page.evaluate(() => ({
                saved: (localStorage.getItem('barkCSV') || '').includes('Last Known Acadia'),
                storageLength: (localStorage.getItem('barkCSV') || '').length,
                displayed: window.BARK.repos.ParkRepo.getAll().some(p => p.name.includes('Last Known Acadia')),
                count: window.BARK.repos.ParkRepo.getAll().length,
                version: window.BARK.releaseVersion
            }))).toEqual({ saved: true, displayed: true, count, version: '0.144', storageLength: expect.any(Number) });
            await page.evaluate(() => window.BARK.showOfflineRecoveryNotice());
            await page.locator('#auth-failure-reload').click();
            await page.waitForLoadState('domcontentloaded');
            await expect(page.locator('#bark-loader')).toHaveCount(0, { timeout: 4000 });
            expect(await page.evaluate(() => window.BARK.repos.ParkRepo.getAll().length)).toBe(count);
            await expectSavedGreen();
            expect(await page.evaluate(() => localStorage.getItem('bark.unconfirmedVisits.startup-test'))).toBe('{"kept":"durable"}');
            // Pin cards and navigation must respond, not just paint a screenshot.
            await page.evaluate(() => window.BARK.markerManager.markers.values().next().value.fire('click'));
            await expect(page.locator('#slide-panel')).toHaveClass(/open/);
            if (name.includes('Chromium')) {
                await context.setOffline(true);
                await page.reload({ waitUntil: 'domcontentloaded' });
                await expect(page.locator('#bark-loader')).toHaveCount(0, { timeout: 4000 });
                expect(await page.evaluate(() => window.BARK.repos.ParkRepo.getAll().length)).toBe(count);
                await expectSavedGreen();
                await context.setOffline(false);
            }
            server.state.stall = false;
            expect(await page.evaluate(async () => (await (await fetch('./version.json?recovery=1')).json()).version)).toBe('0.144');
        } finally { await context.close(); await browser.close(); await server.close(); }
    });

    test(`${name}: first visit with a stalled startup file shows recovery before four-second budget expires`, async () => {
        const server = await serveApp(); server.state.stallAsset = true;
        const browser = await browserType.launch({ proxy: { server: server.url, bypass: '127.0.0.1,localhost' } });
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
        await context.route('**/*', route => route.request().url().startsWith(server.url) ? route.continue() : route.abort());
        try {
            const page = await context.newPage();
            await page.goto(`${server.url}/index.v144.html`, { waitUntil: 'commit' });
            await expect(page.locator('#bark-startup-recovery')).toBeVisible({ timeout: 5500 });
            await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
            expect(server.state.stalled).toBeGreaterThan(0);
            server.state.stallAsset = false;
            await page.getByRole('button', { name: 'Retry', exact: true }).click();
            await expect(page.locator('#bark-loader')).toHaveCount(0, { timeout: 4500 });
        } finally { await context.close(); await browser.close(); await server.close(); }
    });
}
