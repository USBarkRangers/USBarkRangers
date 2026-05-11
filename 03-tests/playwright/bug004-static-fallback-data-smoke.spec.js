const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const GOOGLE_SHEET_PATTERN = /https:\/\/docs\.google\.com\/spreadsheets\/d\/e\//;

function withCacheBuster(url) {
    return `${url}${url.includes('?') ? '&' : '?'}staticFallbackSmoke=${Date.now()}`;
}

test.describe('BUG-AUDIT-004 static data fallback', () => {
    test('cold boot with no local CSV cache still renders hosted fallback pins when Sheet fetch fails', async ({ browser }) => {
        const context = await newBarkContext(browser);
        let fallbackRequested = false;

        await context.addInitScript(() => {
            localStorage.removeItem('barkCSV');
            localStorage.removeItem('barkCSV_time');
        });

        await context.route(GOOGLE_SHEET_PATTERN, route => route.abort('failed'));
        await context.route('**/assets/data/bark-fallback.csv', route => {
            fallbackRequested = true;
            route.continue();
        });

        const page = await context.newPage();
        const unexpectedErrors = [];
        page.on('console', message => {
            const text = message.text();
            if (message.type() !== 'error') return;
            if (/Data poll failed/i.test(text)) return;
            if (/Failed to load resource: net::ERR_(FAILED|CONNECTION_RESET)/i.test(text)) return;
            unexpectedErrors.push(text);
        });
        page.on('pageerror', error => unexpectedErrors.push(error.message));

        await page.goto(withCacheBuster(BASE_URL));
        await expectBarkAppIdentity(page, expect);

        const parkCount = await page.waitForFunction(() => {
            const parkRepo = window.BARK && window.BARK.repos && window.BARK.repos.ParkRepo;
            if (!parkRepo || typeof parkRepo.getAll !== 'function') return 0;
            return parkRepo.getAll().length;
        }, null, { timeout: 15000 });

        expect(await parkCount.jsonValue()).toBeGreaterThan(300);
        expect(fallbackRequested).toBe(true);

        const markerCount = await page.evaluate(() => {
            const markerManager = window.BARK && window.BARK.markerManager;
            return markerManager && markerManager.markers instanceof Map ? markerManager.markers.size : 0;
        });
        expect(markerCount).toBeGreaterThan(300);
        expect(unexpectedErrors).toEqual([]);

        await context.close();
    });
});
