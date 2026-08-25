const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

test('live location moves in an isolated pane without repainting the park marker pane', async ({ browser }) => {
    const context = await newBarkContext(browser, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        permissions: ['geolocation'],
        geolocation: { latitude: 39.1, longitude: -77.1, accuracy: 5 }
    });

    await context.addInitScript(() => {
        const geolocation = navigator.geolocation;
        window.__locationAudit = { watchCalls: 0, clearCalls: 0 };
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
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}isolatedLocation=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.map &&
        window.BARK &&
        window.BARK.getUserLocationMarker &&
        window.BARK.getUserLocationMarker() &&
        window.map.getPane('markerPane') &&
        window.map.getPane('barkUserLocation') &&
        window.BARK.repos &&
        window.BARK.repos.ParkRepo &&
        window.BARK.repos.ParkRepo.getAll().length > 300
    ), { timeout: 30000 });

    await page.waitForTimeout(500);
    const initial = await page.evaluate(() => {
        const marker = window.BARK.getUserLocationMarker();
        const markerPane = window.map.getPane('markerPane');
        const locationPane = window.map.getPane('barkUserLocation');
        window.__initialLocationMarker = marker;
        window.__locationSyncCalls = 0;
        const originalSyncState = window.syncState;
        window.syncState = (...args) => {
            window.__locationSyncCalls += 1;
            return originalSyncState(...args);
        };
        window.__defaultMarkerPaneMutations = 0;
        window.__defaultMarkerPaneObserver = new MutationObserver(records => {
            window.__defaultMarkerPaneMutations += records.length;
        });
        window.__defaultMarkerPaneObserver.observe(markerPane, {
            attributes: true,
            childList: true,
            subtree: true
        });
        const center = window.map.getCenter();
        return {
            watchCalls: window.__locationAudit.watchCalls,
            markerUsesIsolatedPane: marker._icon.parentElement === locationPane,
            locationPaneClass: locationPane.className,
            paneWillChange: getComputedStyle(locationPane).willChange,
            dotAnimation: getComputedStyle(marker._icon.querySelector('.pulse-location-dot')).animationName,
            hasPopup: Boolean(marker.getPopup && marker.getPopup()),
            center: { lat: center.lat, lng: center.lng }
        };
    });

    expect(initial.watchCalls).toBe(1);
    expect(initial.markerUsesIsolatedPane).toBe(true);
    expect(initial.locationPaneClass).toContain('bark-user-location-pane');
    expect(initial.paneWillChange).toContain('transform');
    expect(initial.dotAnimation).toBe('none');
    expect(initial.hasPopup).toBe(false);

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
        window.__defaultMarkerPaneObserver.disconnect();
        const marker = window.BARK.getUserLocationMarker();
        const center = window.map.getCenter();
        return {
            sameMarker: marker === window.__initialLocationMarker,
            lat: marker.getLatLng().lat,
            lng: marker.getLatLng().lng,
            syncCalls: window.__locationSyncCalls,
            watchCalls: window.__locationAudit.watchCalls,
            defaultMarkerPaneMutations: window.__defaultMarkerPaneMutations,
            stillInIsolatedPane: marker._icon.parentElement === window.map.getPane('barkUserLocation'),
            center: { lat: center.lat, lng: center.lng }
        };
    });

    expect(afterBurst.sameMarker).toBe(true);
    expect(afterBurst.lat).toBeCloseTo(39.112, 5);
    expect(afterBurst.lng).toBeCloseTo(-77.088, 5);
    expect(afterBurst.syncCalls).toBe(0);
    expect(afterBurst.watchCalls).toBe(1);
    expect(afterBurst.defaultMarkerPaneMutations).toBe(0);
    expect(afterBurst.stillInIsolatedPane).toBe(true);
    expect(afterBurst.center.lat).toBeCloseTo(initial.center.lat, 5);
    expect(afterBurst.center.lng).toBeCloseTo(initial.center.lng, 5);

    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__locationAudit.clearCalls)).toBe(1);
    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__locationAudit.watchCalls)).toBe(2);

    await context.close();
});
