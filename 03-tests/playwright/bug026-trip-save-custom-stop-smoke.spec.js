const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const FREE_STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !FREE_STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null,
    !PREMIUM_STORAGE_STATE ? 'BARK_E2E_PREMIUM_STORAGE_STATE' : null
].filter(Boolean);

const freeStorageStatePath = FREE_STORAGE_STATE ? path.resolve(FREE_STORAGE_STATE) : null;
const premiumStorageStatePath = PREMIUM_STORAGE_STATE ? path.resolve(PREMIUM_STORAGE_STATE) : null;

function buildEnvHelp() {
    return [
        'BUG-026 trip save custom-stop smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        '  export BARK_E2E_STORAGE_STATE="$PWD/03-tests/.auth/free-user.json"',
        '  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/03-tests/.auth/premium-user.json"',
        '  npx playwright test 03-tests/playwright/bug026-trip-save-custom-stop-smoke.spec.js --workers=1 --reporter=list'
    ].join('\n');
}

if (missingEnv.length > 0) {
    console.warn(buildEnvHelp());
}

test.skip(missingEnv.length > 0, buildEnvHelp());

test.beforeAll(() => {
    if (!BASE_URL) return;
    new URL(BASE_URL);

    for (const [name, storagePath] of [
        ['BARK_E2E_STORAGE_STATE', freeStorageStatePath],
        ['BARK_E2E_PREMIUM_STORAGE_STATE', premiumStorageStatePath]
    ]) {
        if (storagePath && !fs.existsSync(storagePath)) {
            throw new Error(`${name} points to a missing file: ${storagePath}`);
        }
    }
});

function withCacheBuster(url) {
    return `${url}${url.includes('?') ? '&' : '?'}tripSaveCustomStopSmoke=${Date.now()}`;
}

async function openSignedInApp(page, expectedPremium) {
    await page.goto(withCacheBuster(BASE_URL));
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction((premium) => {
        const repo = window.BARK && window.BARK.repos && window.BARK.repos.ParkRepo;
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
        const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
        const saveRouteBtn = window.BARK && window.BARK.DOM && window.BARK.DOM.saveRouteBtn
            ? window.BARK.DOM.saveRouteBtn()
            : null;
        return Boolean(
            repo &&
            typeof repo.getAll === 'function' &&
            repo.getAll().length > 5 &&
            user &&
            premiumService &&
            typeof premiumService.isPremium === 'function' &&
            premiumService.isPremium() === premium &&
            saveRouteBtn &&
            typeof saveRouteBtn.onclick === 'function' &&
            typeof window.BARK.buildSavedRouteData === 'function'
        );
    }, expectedPremium, { timeout: 30000 });
}

async function seedRouteWithCustomStops(page, tripName) {
    await page.evaluate((name) => {
        const parks = window.BARK.repos.ParkRepo.getAll()
            .filter(park => park && park.id && park.name && park.lat && park.lng)
            .slice(0, 5)
            .map(park => ({
                id: park.id,
                name: park.name,
                lat: Number(park.lat),
                lng: Number(park.lng),
                state: park.state || ''
            }));

        if (parks.length < 5) throw new Error('Need at least five parks for trip-save smoke.');

        window.tripStartNode = {
            name: 'Hinckley Township, OH, USA',
            lat: 41.2392,
            lng: -81.7457
        };
        window.tripEndNode = {
            name: 'Gainesville, FL, USA',
            lat: 29.6516,
            lng: -82.3248
        };
        window.BARK.tripDays = [{
            color: window.BARK.DAY_COLORS[0],
            stops: [
                {
                    id: undefined,
                    name: 'Custom midpoint without canonical id',
                    lat: 39.9612,
                    lng: -82.9988
                },
                ...parks
            ],
            notes: 'Regression smoke for custom geocoded stops.'
        }];
        window.BARK.activeDayIdx = 0;
        window.isTripEditMode = false;

        const nameInput = window.BARK.DOM.tripNameInput();
        if (!nameInput) throw new Error('Missing tripNameInput');
        nameInput.value = name;

        window.BARK.updateTripUI();
    }, tripName);
}

async function findSavedRoute(page, tripName) {
    return page.evaluate(async (name) => {
        const user = firebase.auth().currentUser;
        const snapshot = await firebase.firestore()
            .collection('users').doc(user.uid)
            .collection('savedRoutes')
            .where('tripName', '==', name)
            .limit(1)
            .get();

        if (snapshot.empty) return null;
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    }, tripName);
}

async function deleteSavedRoute(page, routeId) {
    if (!routeId) return;
    await page.evaluate(async (id) => {
        const user = firebase.auth().currentUser;
        await firebase.firestore()
            .collection('users').doc(user.uid)
            .collection('savedRoutes').doc(id)
            .delete();
    }, routeId);
}

test.describe('BUG-026 trip save custom stops', () => {
    test('free users see the saved-route premium gate before Firestore save', async ({ browser }) => {
        test.setTimeout(60000);

        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const page = await context.newPage();
        const tripName = `BUG-026 Free Save Block ${Date.now()}`;

        try {
            await openSignedInApp(page, false);
            await page.evaluate(() => {
                window.__barkBug026Paywalls = [];
                window.BARK.paywall.openPaywall = (options = {}) => {
                    window.__barkBug026Paywalls.push(options);
                };
            });
            await seedRouteWithCustomStops(page, tripName);
            await page.locator('.nav-item[data-target="planner-view"]').click();
            await expect(page.locator('#planner-view')).toHaveClass(/active/);

            await page.locator('#save-route-btn').click();
            const paywalls = await page.waitForFunction(() => {
                return Array.isArray(window.__barkBug026Paywalls) && window.__barkBug026Paywalls.length > 0
                    ? window.__barkBug026Paywalls
                    : false;
            }, null, { timeout: 5000 })
                .then(handle => handle.jsonValue());

            expect(paywalls).toHaveLength(1);
            expect(paywalls[0]).toMatchObject({ source: 'saved-route' });
        } finally {
            await context.close();
        }
    });

    test('saving optimized-style trips omits undefined ids and restores custom bookends', async ({ browser }) => {
        test.setTimeout(90000);

        const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const page = await context.newPage();
        const tripName = `BUG-026 Custom Stop Save ${Date.now()}`;
        let savedRouteId = null;

        try {
            await openSignedInApp(page, true);
            await seedRouteWithCustomStops(page, tripName);
            await page.locator('.nav-item[data-target="planner-view"]').click();
            await expect(page.locator('#planner-view')).toHaveClass(/active/);

            const dialogPromise = page.waitForEvent('dialog');
            await page.locator('#save-route-btn').click();
            const dialog = await dialogPromise;
            const dialogMessage = dialog.message();
            await dialog.accept();
            expect(dialogMessage).toContain('Trip saved');
            expect(dialogMessage).not.toContain('Unsupported field value');

            const savedRoute = await findSavedRoute(page, tripName);
            expect(savedRoute, 'Saved route should exist in Firestore').toBeTruthy();
            savedRouteId = savedRoute.id;

            expect(savedRoute.tripStartNode).toMatchObject({ name: 'Hinckley Township, OH, USA' });
            expect(savedRoute.tripEndNode).toMatchObject({ name: 'Gainesville, FL, USA' });
            expect(savedRoute.tripDays[0].stops).toHaveLength(6);
            expect(Object.prototype.hasOwnProperty.call(savedRoute.tripDays[0].stops[0], 'id')).toBe(false);
            expect(savedRoute.tripDays[0].stops[0]).toMatchObject({
                name: 'Custom midpoint without canonical id',
                lat: 39.9612,
                lng: -82.9988
            });

            await page.evaluate(async (routeId) => {
                const user = firebase.auth().currentUser;
                await window.BARK.loadSavedRoutes(user.uid);
                const loadButton = document.querySelector(`#planner-saved-routes-list .load-route-btn[data-id="${routeId}"]`);
                if (!loadButton) throw new Error('Saved route load button was not rendered.');
                loadButton.click();
            }, savedRouteId);

            await page.waitForFunction(() => {
                return Boolean(
                    window.tripStartNode &&
                    window.tripStartNode.name === 'Hinckley Township, OH, USA' &&
                    window.tripEndNode &&
                    window.tripEndNode.name === 'Gainesville, FL, USA'
                );
            }, null, { timeout: 30000 });
        } finally {
            await deleteSavedRoute(page, savedRouteId);
            await context.close();
        }
    });
});
