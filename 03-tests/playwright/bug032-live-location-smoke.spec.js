const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

test('live location reuses one marker and one foreground watcher without broad app syncs', async ({ browser }) => {
    const context = await newBarkContext(browser, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        permissions: ['geolocation'],
        geolocation: { latitude: 39.1, longitude: -77.1, accuracy: 5 }
    });

    await context.addInitScript(() => {
        const geolocation = navigator.geolocation;
        window.__locationAudit = {
            watchCalls: 0,
            clearCalls: 0
        };

        const originalWatch = geolocation.watchPosition.bind(geolocation);
        const originalClear = geolocation.clearWatch.bind(geolocation);
        geolocation.watchPosition = (...args) => {
            window.__locationAudit.watchCalls += 1;
            return originalWatch(...args);
        };
        geolocation.clearWatch = (...args) => {
            window.__locationAudit.clearCalls += 1;
            return originalClear(...args);
        };
    });

    const page = await context.newPage();
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}liveLocationSmoke=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.map &&
        window.BARK &&
        window.BARK.getUserLocationMarker &&
        window.BARK.getUserLocationMarker()
    ), { timeout: 30000 });

    // Let startup/auth settle so the assertions cover only subsequent GPS fixes.
    await page.waitForTimeout(1500);
    const initial = await page.evaluate(() => {
        window.__initialLocationMarker = window.BARK.getUserLocationMarker();
        window.__locationSyncCalls = 0;
        const originalSyncState = window.syncState;
        window.syncState = (...args) => {
            window.__locationSyncCalls += 1;
            return originalSyncState(...args);
        };
        const center = window.map.getCenter();
        return {
            watchCalls: window.__locationAudit.watchCalls,
            lat: window.__initialLocationMarker.getLatLng().lat,
            lng: window.__initialLocationMarker.getLatLng().lng,
            center: { lat: center.lat, lng: center.lng }
        };
    });

    expect(initial.watchCalls).toBe(1);
    expect(initial.lat).toBeCloseTo(39.1, 5);
    expect(initial.lng).toBeCloseTo(-77.1, 5);

    // A burst keeps only the newest fix and must not pan or invoke syncState.
    for (let index = 1; index <= 12; index += 1) {
        await context.setGeolocation({
            latitude: 39.1 + index * 0.001,
            longitude: -77.1 + index * 0.001,
            accuracy: 5
        });
    }

    await page.waitForFunction(() => {
        const marker = window.BARK.getUserLocationMarker();
        return marker && Math.abs(marker.getLatLng().lat - 39.112) < 0.000001;
    });

    const afterBurst = await page.evaluate(() => {
        const marker = window.BARK.getUserLocationMarker();
        const center = window.map.getCenter();
        return {
            sameMarker: marker === window.__initialLocationMarker,
            lat: marker.getLatLng().lat,
            lng: marker.getLatLng().lng,
            syncCalls: window.__locationSyncCalls,
            watchCalls: window.__locationAudit.watchCalls,
            center: { lat: center.lat, lng: center.lng }
        };
    });

    expect(afterBurst.sameMarker).toBe(true);
    expect(afterBurst.lat).toBeCloseTo(39.112, 5);
    expect(afterBurst.lng).toBeCloseTo(-77.088, 5);
    expect(afterBurst.syncCalls).toBe(0);
    expect(afterBurst.watchCalls).toBe(1);
    expect(afterBurst.center.lat).toBeCloseTo(initial.center.lat, 5);
    expect(afterBurst.center.lng).toBeCloseTo(initial.center.lng, 5);

    await page.locator('.custom-locate-btn a').click();
    await expect.poll(() => page.evaluate(() => {
        const center = window.map.getCenter();
        return {
            lat: center.lat,
            lng: center.lng,
            zoom: window.map.getZoom(),
            watchCalls: window.__locationAudit.watchCalls,
            syncCalls: window.__locationSyncCalls
        };
    })).toEqual({
        lat: 39.112,
        lng: -77.088,
        zoom: 10,
        watchCalls: 1,
        syncCalls: 0
    });

    // Safari/Android lifecycle returns must clear the old watcher and create
    // exactly one replacement, even if more than one pageshow signal arrives.
    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__locationAudit.clearCalls)).toBe(1);

    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__locationAudit.watchCalls)).toBe(2);

    await context.setGeolocation({ latitude: 39.2, longitude: -77.0, accuracy: 5 });
    await page.waitForFunction(() => {
        const marker = window.BARK.getUserLocationMarker();
        return marker && Math.abs(marker.getLatLng().lat - 39.2) < 0.000001;
    });

    const afterResume = await page.evaluate(() => ({
        sameMarker: window.BARK.getUserLocationMarker() === window.__initialLocationMarker,
        syncCalls: window.__locationSyncCalls,
        watchCalls: window.__locationAudit.watchCalls,
        clearCalls: window.__locationAudit.clearCalls
    }));
    expect(afterResume).toEqual({
        sameMarker: true,
        syncCalls: 0,
        watchCalls: 2,
        clearCalls: 1
    });

    await context.close();
});
