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
    test(`${profile.name} releases cached pins after a fake-cell Firebase stall`, async () => {
        const browser = await profile.browserType.launch();
        const context = await browser.newContext({ ...profile.options, serviceWorkers: 'block' });
        await context.addInitScript(({ ios }) => {
            localStorage.setItem('barkTermsAgreement', '1');
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
        }, { ios: profile.ios });

        try {
            // Seed the exact local cache an installed app already has from a
            // successful earlier launch. This is independent of the live Sheet.
            const seedPage = await context.newPage();
            await seedPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
            await seedPage.evaluate(async () => {
                const csv = await (await fetch('assets/data/bark-fallback.csv')).text();
                localStorage.setItem('barkCSV', csv);
                localStorage.setItem('barkCSV_time', String(Date.now()));
            });
            await seedPage.close();

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
        } finally {
            await context.close();
            await browser.close();
        }
    });
}
