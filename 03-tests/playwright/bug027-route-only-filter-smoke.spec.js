const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const FREE_STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE || '03-tests/.auth/free-user.json';
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE || '03-tests/.auth/premium-user.json';

function resolveStorageState(storageStatePath) {
    return path.isAbsolute(storageStatePath)
        ? storageStatePath
        : path.join(process.cwd(), storageStatePath);
}

const freeStorageStatePath = resolveStorageState(FREE_STORAGE_STATE);
const premiumStorageStatePath = resolveStorageState(PREMIUM_STORAGE_STATE);
const freeStorageExists = fs.existsSync(freeStorageStatePath);
const premiumStorageExists = fs.existsSync(premiumStorageStatePath);

async function openLoadedApp(page, expectedPremium) {
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}routeOnlyFilterSmoke=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.map &&
        window.BARK &&
        window.BARK.markerManager &&
        window.BARK.tripLayer &&
        window.BARK.services &&
        window.BARK.services.premium &&
        window.BARK.repos &&
        window.BARK.repos.ParkRepo &&
        typeof window.BARK.repos.ParkRepo.getAll === 'function' &&
        window.BARK.repos.ParkRepo.getAll().length > 50 &&
        document.getElementById('visited-filter')
    ), { timeout: 30000 });
    await page.waitForFunction((premium) => {
        const service = window.BARK && window.BARK.services && window.BARK.services.premium;
        if (!service || typeof service.getDebugState !== 'function') return false;
        const state = service.getDebugState();
        return Boolean(
            state &&
            state.meta &&
            /^auth-user-snapshot/.test(state.meta.reason || '') &&
            service.isPremium() === premium
        );
    }, expectedPremium, { timeout: 30000 });
}

async function waitForVisibleIds(page, expectedIds) {
    await page.waitForFunction((ids) => {
        const expected = new Set(ids);
        const visibleIds = window.BARK.repos.ParkRepo.getAll()
            .filter(point => point.marker && point.marker._barkIsVisible === true)
            .map(point => point.id)
            .sort();
        return visibleIds.length === expected.size && visibleIds.every(id => expected.has(id));
    }, expectedIds, { timeout: 15000 });
}

test.describe('BUG-AUDIT-027 route-only pin filter', () => {
    test('premium route-only filter hides every park pin except current trip stops', async ({ browser }) => {
        test.skip(!premiumStorageExists, `Premium storage state not found: ${premiumStorageStatePath}`);

        const context = await newBarkContext(browser, {
            storageState: premiumStorageStatePath,
            viewport: { width: 1280, height: 900 }
        });
        const page = await context.newPage();

        await openLoadedApp(page, true);

        const initialState = await page.evaluate(() => {
            window.BARK.settings.set('premiumClusteringEnabled', false);
            window.BARK.settings.set('standardClusteringEnabled', false);
            window.BARK.settings.set('forcePlainMarkers', true);
            window.BARK.settings.set('viewportCulling', false);
            window.BARK.applyMapPerformancePolicy();
            window.BARK.rebuildMarkerLayer();

            const parks = window.BARK.repos.ParkRepo.getAll().slice(0, 5);
            const routeStops = parks.slice(0, 3).map(park => ({
                id: park.id,
                name: park.name,
                lat: park.lat,
                lng: park.lng
            }));
            window.BARK.tripDays = [{ color: window.BARK.DAY_COLORS[0], stops: routeStops, notes: '' }];
            window.BARK.activeDayIdx = 0;
            window.BARK.updateTripUI();

            const filter = document.getElementById('visited-filter');
            filter.value = 'route';
            filter.dispatchEvent(new Event('change', { bubbles: true }));
            window.syncState();

            return {
                routeIds: routeStops.map(stop => stop.id).sort(),
                extraPark: {
                    id: parks[3].id,
                    name: parks[3].name,
                    lat: parks[3].lat,
                    lng: parks[3].lng
                },
                filterDisabled: filter.disabled,
                filterValue: filter.value,
                filterState: window.BARK.visitedFilterState,
                storedFilter: window.localStorage.getItem('barkVisitedFilter')
            };
        });

        expect(initialState.filterDisabled).toBe(false);
        expect(initialState.filterValue).toBe('route');
        expect(initialState.filterState).toBe('route');
        expect(initialState.storedFilter).toBe('route');
        await waitForVisibleIds(page, initialState.routeIds);

        const expandedRouteIds = await page.evaluate((extraPark) => {
            window.addStopToTrip(extraPark);
            return window.BARK.tripDays.flatMap(day => day.stops.map(stop => stop.id)).filter(Boolean).sort();
        }, initialState.extraPark);
        await waitForVisibleIds(page, expandedRouteIds);

        const resetState = await page.evaluate(() => {
            const filter = document.getElementById('visited-filter');
            filter.value = 'all';
            filter.dispatchEvent(new Event('change', { bubbles: true }));
            window.syncState();
            return {
                filterValue: filter.value,
                filterState: window.BARK.visitedFilterState
            };
        });

        expect(resetState.filterValue).toBe('all');
        expect(resetState.filterState).toBe('all');
        await page.waitForFunction((routeCount) => {
            const visibleCount = window.BARK.repos.ParkRepo.getAll()
                .filter(point => point.marker && point.marker._barkIsVisible === true)
                .length;
            return visibleCount > routeCount;
        }, expandedRouteIds.length, { timeout: 15000 });

        await context.close();
    });

    test('free account cannot unlock route-only filter from stored state', async ({ browser }) => {
        test.skip(!freeStorageExists, `Free storage state not found: ${freeStorageStatePath}`);

        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        await context.addInitScript(() => {
            window.localStorage.setItem('barkVisitedFilter', 'route');
        });
        const page = await context.newPage();

        await openLoadedApp(page, false);

        const freeState = await page.evaluate(() => {
            const filter = document.getElementById('visited-filter');
            return {
                filterDisabled: filter.disabled,
                filterValue: filter.value,
                filterState: window.BARK.visitedFilterState,
                storedFilter: window.localStorage.getItem('barkVisitedFilter'),
                visibleCount: window.BARK.repos.ParkRepo.getAll()
                    .filter(point => point.marker && point.marker._barkIsVisible === true)
                    .length
            };
        });

        expect(freeState.filterDisabled).toBe(true);
        expect(freeState.filterValue).toBe('all');
        expect(freeState.filterState).toBe('all');
        expect(freeState.storedFilter).toBe('all');
        expect(freeState.visibleCount).toBeGreaterThan(50);

        await context.close();
    });
});
