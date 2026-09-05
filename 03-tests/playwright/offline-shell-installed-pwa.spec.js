const { test, expect, chromium, webkit, devices } = require('@playwright/test');

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
    const behavior = profile.ios
        ? 'prepares its complete offline shell and keeps the open app usable offline'
        : 'cold-starts pins, popups, tabs, and viewed high-zoom tiles offline';
    test(`${profile.name} ${behavior}`, async () => {
        const browser = await profile.browserType.launch();
        const context = await browser.newContext({ ...profile.options, serviceWorkers: 'allow' });
        await context.addInitScript(ios => {
            localStorage.setItem('barkTermsAgreement', '1');
            localStorage.setItem('barkRememberMapPosition', 'true');
            if (ios) {
                Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
            }
        }, profile.ios);

        try {
            const onlinePage = await context.newPage();
            await onlinePage.goto(`${BASE_URL}?offlineInstall=${Date.now()}`, { waitUntil: 'domcontentloaded' });
            await expect.poll(() => onlinePage.evaluate(() => (
                window.BARK?.repos?.ParkRepo?.getAll?.().length || 0
            )), { timeout: 10000 }).toBeGreaterThan(300);

            await onlinePage.evaluate(async () => {
                await navigator.serviceWorker.ready;
                if (!navigator.serviceWorker.controller) {
                    await new Promise(resolve => {
                        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
                        setTimeout(resolve, 5000);
                    });
                }
            });
            expect(await onlinePage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

            // A static Beta/test origin may begin on the immutable public 0.140
            // shell. Once the current worker has claimed the page, the next
            // navigation must use the current private entry.
            await onlinePage.reload({ waitUntil: 'domcontentloaded' });
            await expect(onlinePage.locator('script[src="modules/dataService.v143.js"]')).toHaveCount(1);
            await expect(onlinePage.locator('script[src="core/app.v144.js"]')).toHaveCount(1);
            await expect.poll(() => onlinePage.evaluate(() => (
                window.BARK?.repos?.ParkRepo?.getAll?.().length || 0
            )), { timeout: 10000 }).toBeGreaterThan(300);

            // Load only the visible detailed area. The worker never downloads a
            // region or nationwide pack; it remembers normal high-zoom viewing.
            await onlinePage.evaluate(() => {
                window.rememberMapPosition = true;
                window.map.setView([44.4089658, -68.2472733], 12, { animate: false });
            });
            await expect.poll(() => onlinePage.evaluate(async () => (
                (await (await caches.open('bark-offline-high-zoom-tiles-v1')).keys()).length
            )), { timeout: 15000 }).toBeGreaterThan(0);

            const cachedTileCount = await onlinePage.evaluate(async () => (
                (await (await caches.open('bark-offline-high-zoom-tiles-v1')).keys()).length
            ));
            expect(cachedTileCount).toBeLessThanOrEqual(350);

            const appVersion = await onlinePage.evaluate(async () => (
                await (await fetch('./version.json', { cache: 'no-store' })).json()
            ).version);
            const shellCoverage = await onlinePage.evaluate(async (version) => {
                const shellName = (await caches.keys()).find(name => name === `bark-offline-shell-${version}`);
                if (!shellName) return {
                    entry: false,
                    libraries: false,
                    app: false,
                    data: false,
                    parks: false
                };
                const urls = (await (await caches.open(shellName)).keys()).map(request => request.url);
                return {
                    entry: urls.some(url => /\/index\.v144\.html(?:\?|$)/.test(url)),
                    libraries: urls.some(url => /\/vendor\/leaflet-1\.9\.4\/leaflet\.js$/.test(url)),
                    app: urls.some(url => /\/core\/app\.v144\.js$/.test(url)),
                    data: urls.some(url => /\/modules\/dataService\.v143\.js$/.test(url)),
                    parks: urls.some(url => /\/assets\/data\/bark-fallback-0\.142\.csv$/.test(url))
                };
            }, appVersion);
            expect(shellCoverage).toEqual({
                entry: true,
                libraries: true,
                app: true,
                data: true,
                parks: true
            });

            await context.setOffline(true);

            let offlinePage;
            if (profile.ios) {
                // Playwright WebKit does not route emulated-offline navigation
                // or fetch through service workers. Cache contents above prove
                // installation; the open document still verifies offline UI.
                offlinePage = onlinePage;
            } else {
                await onlinePage.close();
                offlinePage = await context.newPage();
                await offlinePage.goto(`${BASE_URL}?coldAirplane=${Date.now()}`, { waitUntil: 'domcontentloaded' });
            }
            await expect.poll(() => offlinePage.evaluate(() => (
                window.BARK?.repos?.ParkRepo?.getAll?.().length || 0
            )), { timeout: 7000 }).toBeGreaterThan(300);
            await expect(offlinePage.locator('script[src="modules/dataService.v143.js"]')).toHaveCount(1);
            await expect(offlinePage.locator('#bark-loader')).toHaveCount(0, { timeout: 10000 });

            // Cached pins still own the full card UI.
            const firstParkId = await offlinePage.evaluate(() => window.BARK.repos.ParkRepo.getAll()[0].id);
            await offlinePage.evaluate(id => window.BARK.markerManager.markers.get(id).fire('click'), firstParkId);
            await expect(offlinePage.locator('#slide-panel')).toHaveClass(/open/);
            await expect(offlinePage.locator('#panel-title')).not.toHaveText('Park Name');

            // The SPA tabs remain usable even though their cloud-backed values
            // may truthfully show loading/offline states.
            for (const target of ['home-view', 'planner-view', 'profile-view', 'map-view']) {
                await offlinePage.locator(`.nav-item[data-target="${target}"]`).click();
                await expect(offlinePage.locator(`.nav-item[data-target="${target}"]`)).toHaveClass(/active/);
            }

            if (!profile.ios) {
                await offlinePage.evaluate(() => window.map.setView([44.4089658, -68.2472733], 12, { animate: false }));
                await expect.poll(() => offlinePage.locator('.leaflet-tile-loaded').count(), { timeout: 7000 }).toBeGreaterThan(0);
            }
        } finally {
            await context.setOffline(false).catch(() => {});
            await context.close();
            await browser.close();
        }
    });
}
