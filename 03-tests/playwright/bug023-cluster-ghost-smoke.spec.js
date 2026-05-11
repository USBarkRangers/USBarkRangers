const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE || '03-tests/.auth/premium-user.json';

function resolveStorageState(storageStatePath) {
    return path.isAbsolute(storageStatePath)
        ? storageStatePath
        : path.join(process.cwd(), storageStatePath);
}

const premiumStorageStatePath = resolveStorageState(PREMIUM_STORAGE_STATE);
const premiumStorageExists = fs.existsSync(premiumStorageStatePath);

async function openLoadedApp(page) {
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}clusterGhostSmoke=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.map &&
        window.BARK &&
        window.BARK.markerManager &&
        window.BARK.markerClusterGroup &&
        window.BARK.services &&
        window.BARK.services.premium &&
        window.BARK.repos &&
        window.BARK.repos.ParkRepo &&
        typeof window.BARK.repos.ParkRepo.getAll === 'function' &&
        window.BARK.repos.ParkRepo.getAll().length > 50
    ), { timeout: 30000 });

    await page.waitForFunction(() => window.BARK.services.premium.isPremium() === true, { timeout: 30000 });
}

async function setZoomAndWait(page, zoom) {
    await page.evaluate((nextZoom) => new Promise((resolve) => {
        const map = window.map;
        const finish = () => window.setTimeout(resolve, 250);
        map.once('zoomend', finish);
        map.setZoom(nextZoom, { animate: false });
        if (Math.abs(map.getZoom() - nextZoom) < 0.001) finish();
    }), zoom);
}

test.describe('BUG-023 cluster ghost bubble regression', () => {
    test('turning off limit zoom and zooming back in clears stale cluster bubbles', async ({ browser }) => {
        test.skip(!premiumStorageExists, `Premium storage state not found: ${premiumStorageStatePath}`);

        const context = await newBarkContext(browser, {
            storageState: premiumStorageStatePath,
            viewport: { width: 1280, height: 900 }
        });
        const page = await context.newPage();

        await openLoadedApp(page);

        await page.evaluate(() => {
            window.BARK.settings.set('premiumClusteringEnabled', true);
            window.BARK.settings.set('standardClusteringEnabled', false);
            window.BARK.settings.set('forcePlainMarkers', false);
            window.BARK.settings.set('viewportCulling', false);
            window.BARK.settings.set('limitZoomOut', true);
            window.BARK.applyMapPerformancePolicy();
            window.BARK.rebuildMarkerLayer();
            window.syncState();
        });

        await setZoomAndWait(page, 5);
        await page.waitForFunction(() => document.querySelectorAll('.bark-cluster-marker').length > 0, { timeout: 15000 });

        await page.evaluate(() => {
            window.BARK.settings.set('limitZoomOut', false);
            window.BARK.applyMapPerformancePolicy();
            window.BARK.rebuildMarkerLayer();
            window.syncState();
        });

        await setZoomAndWait(page, 4);
        await page.waitForFunction(() => document.querySelectorAll('.bark-cluster-marker').length > 0, { timeout: 15000 });

        await setZoomAndWait(page, 8);
        await page.waitForFunction(() => {
            const policy = window.BARK.getMarkerLayerPolicy(window.map.getZoom());
            const clusterLayerOnMap = window.map.hasLayer(window.BARK.markerClusterGroup);
            const clusterIconCount = document.querySelectorAll('.bark-cluster-marker').length;
            const plainLayerOnMap = window.map.hasLayer(window.BARK.markerLayer);
            return policy.layerType === 'plain' && plainLayerOnMap && !clusterLayerOnMap && clusterIconCount === 0;
        }, { timeout: 15000 });

        const state = await page.evaluate(() => ({
            zoom: window.map.getZoom(),
            layerType: window.BARK.getMarkerLayerPolicy(window.map.getZoom()).layerType,
            clusterLayerOnMap: window.map.hasLayer(window.BARK.markerClusterGroup),
            plainLayerOnMap: window.map.hasLayer(window.BARK.markerLayer),
            clusterIconCount: document.querySelectorAll('.bark-cluster-marker').length,
            plainMarkerCount: document.querySelectorAll('.custom-bark-marker').length
        }));

        expect(state.zoom).toBeGreaterThanOrEqual(8);
        expect(state.layerType).toBe('plain');
        expect(state.clusterLayerOnMap).toBe(false);
        expect(state.plainLayerOnMap).toBe(true);
        expect(state.clusterIconCount).toBe(0);
        expect(state.plainMarkerCount).toBeGreaterThan(0);

        await context.close();
    });
});
