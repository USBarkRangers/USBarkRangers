const fs = require('fs');
const path = require('path');
const { test, expect, webkit, devices } = require('@playwright/test');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const FALLBACK_CSV = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '01-code', 'app', 'assets', 'data', 'bark-fallback.csv'),
    'utf8'
);
const ACADIA_ID = '6b5a8134-6afb-4b93-8065-d10d3696eb5e';

test('installed iOS slow load stays truthful, preserves a visit, and clears itself when pins arrive', async () => {
    const browser = await webkit.launch();
    const context = await browser.newContext({
        ...devices['iPhone 15 Pro'],
        serviceWorkers: 'block'
    });

    await context.addInitScript(() => {
        localStorage.setItem('barkTermsAgreement', '1');
        localStorage.removeItem('barkCSV');
        localStorage.removeItem('barkCSV_time');
        Object.defineProperty(navigator, 'standalone', {
            configurable: true,
            get: () => true
        });
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
    });

    await context.route(/https:\/\/docs\.google\.com\/spreadsheets\/d\/e\//, route => route.abort('failed'));
    await context.route('**/assets/data/bark-fallback.csv', async route => {
        await new Promise(resolve => setTimeout(resolve, 5600));
        await route.fulfill({
            status: 200,
            contentType: 'text/csv',
            body: FALLBACK_CSV
        });
    });

    const page = await context.newPage();
    try {
        await page.goto(`${BASE_URL}?slowLoadTruth=${Date.now()}`);
        await page.waitForFunction(() => Boolean(window.BARK && window.BARK.loadState));
        await page.waitForFunction(() => window._authStateResolved === true, null, { timeout: 15000 });

        await page.evaluate(parkId => {
            const visit = {
                id: parkId,
                name: 'Acadia National Park Hulls Cove Visitor Center',
                verified: false,
                ts: Date.now(),
                syncToken: 'slow-load-test'
            };
            const vaultRepo = window.BARK.repos.VaultRepo;
            vaultRepo.addVisit(visit);
            vaultRepo.stageUpsert(visit);
            window.syncState();
        }, ACADIA_ID);

        const banner = page.locator('#park-data-status');
        await expect(banner).toBeVisible({ timeout: 7000 });
        await expect(page.locator('#park-data-status-title')).toContainText('longer than usual');

        await page.waitForFunction(() => window.BARK.repos.ParkRepo.getAll().length > 300, null, { timeout: 15000 });
        await expect(banner).toBeHidden();

        const finalState = await page.evaluate(parkId => ({
            parkState: window.BARK.loadState.getParkState(),
            parkExists: Boolean(window.BARK.repos.ParkRepo.getById(parkId)),
            visitExists: window.BARK.repos.VaultRepo.hasVisit(parkId),
            visitPending: window.BARK.repos.VaultRepo.hasPendingMutation(parkId),
            renderRecognizesVisit: window.BARK.isParkVisited(
                window.BARK.repos.ParkRepo.getById(parkId)
            )
        }), ACADIA_ID);

        expect(finalState).toEqual({
            parkState: 'ready',
            parkExists: true,
            visitExists: true,
            visitPending: true,
            renderRecognizesVisit: true
        });
    } finally {
        await context.close();
        await browser.close();
    }
});

test('park loading status stays on-screen and clears navigation across phone, landscape, and tablet sizes', async () => {
    const browser = await webkit.launch();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
        await page.goto(BASE_URL);
        await page.waitForFunction(() => Boolean(window.BARK && window.BARK.loadState));
        await page.evaluate(() => {
            const banner = document.getElementById('park-data-status');
            banner.hidden = false;
            banner.dataset.state = 'slow';
        });

        for (const viewport of [
            { width: 320, height: 568 },
            { width: 393, height: 852 },
            { width: 915, height: 412 },
            { width: 768, height: 1024 },
            { width: 1024, height: 600 }
        ]) {
            await page.setViewportSize(viewport);
            const boxes = await page.evaluate(() => {
                const banner = document.getElementById('park-data-status').getBoundingClientRect();
                const nav = document.getElementById('main-nav').getBoundingClientRect();
                return {
                    banner: { left: banner.left, top: banner.top, right: banner.right, bottom: banner.bottom },
                    navTop: nav.top
                };
            });

            expect(boxes.banner.left, JSON.stringify(viewport)).toBeGreaterThanOrEqual(0);
            expect(boxes.banner.top, JSON.stringify(viewport)).toBeGreaterThanOrEqual(0);
            expect(boxes.banner.right, JSON.stringify(viewport)).toBeLessThanOrEqual(viewport.width + 1);
            expect(boxes.banner.bottom, JSON.stringify(viewport)).toBeLessThanOrEqual(boxes.navTop + 1);
        }
    } finally {
        await context.close();
        await browser.close();
    }
});
