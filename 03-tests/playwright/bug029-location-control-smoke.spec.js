const { test, expect, devices } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

async function openMapWithMockLocation(browser, geolocationImpl, contextOptions = {}) {
    const context = await newBarkContext(browser, contextOptions);
    await context.addInitScript((impl) => {
        Object.defineProperty(window.navigator, 'geolocation', {
            configurable: true,
            value: {
                getCurrentPosition(success, error) {
                    if (impl.mode === 'success') {
                        success({
                            coords: {
                                latitude: impl.latitude,
                                longitude: impl.longitude,
                                accuracy: 5
                            }
                        });
                        return;
                    }

                    error({
                        code: impl.code || 1,
                        message: impl.message || 'Location blocked'
                    });
                },
                watchPosition() {
                    return 1;
                },
                clearWatch() {}
            }
        });

        if (window.navigator.permissions && typeof window.navigator.permissions.query === 'function') {
            const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
            window.navigator.permissions.query = (descriptor) => {
                if (descriptor && descriptor.name === 'geolocation') {
                    return Promise.resolve({ state: impl.permissionState || 'prompt' });
                }
                return originalQuery(descriptor);
            };
        }
    }, geolocationImpl);

    const page = await context.newPage();
    await page.goto(BASE_URL);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => (
        window.map &&
        window.BARK &&
        typeof window.BARK.requestMapLocation === 'function' &&
        document.querySelector('.custom-locate-btn a')
    ), null, { timeout: 30000 });

    return { context, page };
}

test.describe('BUG-029 location control', () => {
    test('manual locate click centers the map and creates the user location marker', async ({ browser }) => {
        const { context, page } = await openMapWithMockLocation(browser, {
            mode: 'success',
            latitude: 38.8977,
            longitude: -77.0365,
            permissionState: 'prompt'
        });

        try {
            await page.locator('.custom-locate-btn a').click();
            await page.waitForFunction(() => Boolean(
                window.BARK.getUserLocationMarker &&
                window.BARK.getUserLocationMarker()
            ), null, { timeout: 5000 });

            const state = await page.evaluate(() => ({
                center: window.map.getCenter(),
                zoom: window.map.getZoom(),
                marker: window.BARK.getUserLocationMarker().getLatLng()
            }));

            expect(state.center.lat).toBeCloseTo(38.8977, 4);
            expect(state.center.lng).toBeCloseTo(-77.0365, 4);
            expect(state.marker.lat).toBeCloseTo(38.8977, 4);
            expect(state.marker.lng).toBeCloseTo(-77.0365, 4);
            expect(state.zoom).toBeGreaterThanOrEqual(9);
        } finally {
            await context.close();
        }
    });

    test('manual locate tap works with a phone-sized touch target', async ({ browser }) => {
        const { context, page } = await openMapWithMockLocation(browser, {
            mode: 'success',
            latitude: 44.428,
            longitude: -110.5885,
            permissionState: 'prompt'
        }, devices['iPhone 13']);

        try {
            const controlBox = await page.locator('.custom-locate-btn a').boundingBox();
            expect(controlBox.width).toBeGreaterThanOrEqual(44);
            expect(controlBox.height).toBeGreaterThanOrEqual(44);

            await page.tap('.custom-locate-btn a');
            await page.waitForFunction(() => Boolean(
                window.BARK.getUserLocationMarker &&
                window.BARK.getUserLocationMarker()
            ), null, { timeout: 5000 });

            const state = await page.evaluate(() => ({
                center: window.map.getCenter(),
                marker: window.BARK.getUserLocationMarker().getLatLng()
            }));

            expect(state.center.lat).toBeCloseTo(44.428, 4);
            expect(state.center.lng).toBeCloseTo(-110.5885, 4);
            expect(state.marker.lat).toBeCloseTo(44.428, 4);
            expect(state.marker.lng).toBeCloseTo(-110.5885, 4);
        } finally {
            await context.close();
        }
    });

    test('manual locate click shows a clear permission message when location is blocked', async ({ browser }) => {
        const { context, page } = await openMapWithMockLocation(browser, {
            mode: 'error',
            code: 1,
            message: 'User denied Geolocation',
            permissionState: 'denied'
        });

        try {
            const dialogMessage = new Promise(resolve => {
                page.once('dialog', async dialog => {
                    const message = dialog.message();
                    await dialog.dismiss();
                    resolve(message);
                });
            });

            await page.locator('.custom-locate-btn a').click({ noWaitAfter: true });
            expect(await dialogMessage).toContain('Location permission is blocked');
        } finally {
            await context.close();
        }
    });
});
