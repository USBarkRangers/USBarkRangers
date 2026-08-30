const { test, expect, chromium, webkit, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const ANDROID_PWA = {
    userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S938U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    deviceScaleFactor: 3.5,
    isMobile: true,
    hasTouch: true
};

for (const profile of [
    { name: 'installed iPhone web app', browserType: webkit, options: devices['iPhone 15 Pro'], ios: true },
    { name: 'installed Android web app', browserType: chromium, options: ANDROID_PWA, ios: false }
]) {
    test(`${profile.name} releases cached pins after a fake-cell Firebase stall`, async () => {
        const browser = await profile.browserType.launch();
        const context = await browser.newContext({ ...profile.options, serviceWorkers: 'block' });
        const csv = fs.readFileSync(path.join(__dirname, '../../01-code/app/assets/data/bark-fallback.csv'), 'utf8');
        // Stable first record in the checked-in fallback cache fixture.
        const pendingVisit = {
            id: '6b5a8134-6afb-4b93-8065-d10d3696eb5e',
            name: 'Acadia National Park Hulls Cove Visitor Center',
            lat: 44.4089658,
            lng: -68.2472733,
            verified: false,
            ts: Date.now(),
            syncToken: 'fake-cell-orange-test'
        };
        const rememberedUid = 'fake-cell-remembered-user';

        // Seed storage before any application script runs. Opening a preliminary
        // app page here creates an auth/sign-out race that is not part of a cold
        // installed-PWA launch and can erase the remembered account pointer.
        await context.addInitScript(({ ios, csv, pendingVisit, rememberedUid }) => {
            localStorage.setItem('barkTermsAgreement', '1');
            localStorage.setItem('barkCSV', csv);
            localStorage.setItem('barkCSV_time', String(Date.now()));
            localStorage.setItem('bark.lastAuthenticatedVisitUid', rememberedUid);
            localStorage.setItem(`bark.unconfirmedVisits.${rememberedUid}`, JSON.stringify({
                [pendingVisit.id]: { visit: pendingVisit, stashedAt: Date.now() }
            }));
            if (ios) {
                Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
            }
            const nativeMatchMedia = window.matchMedia.bind(window);
            window.matchMedia = query => {
                const result = nativeMatchMedia(query);
                if (query !== '(display-mode: standalone)') return result;
                return new Proxy(result, {
                    get(target, property) {
                        if (property === 'matches') return true;
                        const value = target[property];
                        return typeof value === 'function' ? value.bind(target) : value;
                    }
                });
            };
        }, { ios: profile.ios, csv, pendingVisit, rememberedUid });

        try {
            // Preserve the real app and replace only the Firebase initializer
            // with a never-settling fake-cell handshake.
            await context.route('**/services/authService.js*', async route => {
                const response = await route.fetch();
                const source = await response.text();
                await route.fulfill({
                    response,
                    body: `${source}\nwindow.BARK.services.auth.initFirebase = () => new Promise(() => {});`
                });
            });
            await context.route(/https:\/\/docs\.google\.com\/spreadsheets\/d\/e\//, route => route.abort('failed'));

            const page = await context.newPage();
            const startedAt = Date.now();
            await page.goto(`${BASE_URL}?fakeCellBoot=${Date.now()}`, { waitUntil: 'domcontentloaded' });

            await expect.poll(async () => page.evaluate(() => (
                window.BARK?.repos?.ParkRepo?.getAll?.().length || 0
            )), { timeout: 12500 }).toBeGreaterThan(300);

            const elapsedMs = Date.now() - startedAt;
            expect(elapsedMs).toBeGreaterThanOrEqual(9500);
            expect(elapsedMs).toBeLessThan(12500);
            expect(await page.evaluate(() => window.BARK.loadState.getParkState())).toBe('ready');
            expect(await page.evaluate(visitId => {
                const repo = window.BARK.repos.VaultRepo;
                const marker = window.BARK.markerManager?.markers?.get(visitId);
                return {
                    hasVisit: repo.hasVisit(visitId),
                    pending: repo.hasPendingMutation(visitId),
                    awaitingProof: window.BARK.services.checkin.isVisitAwaitingServerProof(visitId),
                    orangeClass: Boolean(marker?._icon?.classList?.contains('visited-pin--pending-sync'))
                };
            }, pendingVisit.id)).toEqual({
                hasVisit: true,
                pending: true,
                awaitingProof: true,
                orangeClass: true
            });
        } finally {
            await context.close();
            await browser.close();
        }
    });
}
