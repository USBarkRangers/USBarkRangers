const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const FREE_STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_FREE_STORAGE_STATE = '03-tests/.auth/free-user.json';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !FREE_STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null
].filter(Boolean);

const freeStorageStatePath = FREE_STORAGE_STATE ? path.resolve(FREE_STORAGE_STATE) : null;

function buildEnvHelp() {
    return [
        'BUG-021 route upgrade prompt smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_FREE_STORAGE_STATE}"`,
        '  npx playwright test 03-tests/playwright/bug021-route-upgrade-prompt-smoke.spec.js --workers=1 --reporter=list'
    ].join('\n');
}

if (missingEnv.length > 0) {
    console.warn(buildEnvHelp());
}

test.skip(missingEnv.length > 0, buildEnvHelp());

test.beforeAll(() => {
    if (!BASE_URL) return;
    new URL(BASE_URL);

    if (freeStorageStatePath && !fs.existsSync(freeStorageStatePath)) {
        throw new Error(`BARK_E2E_STORAGE_STATE points to a missing file: ${freeStorageStatePath}`);
    }
});

function collectRelevantErrors(page, label, errors) {
    const relevantPattern = /FirebaseError|Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|ReferenceError|TypeError|tripPlannerCore|ORS directions request failed|Route failed|paywall/i;
    const nonFatalConnectivityPattern = /Data poll failed, backing off|Failed to fetch/i;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (nonFatalConnectivityPattern.test(text)) return;
        if (relevantPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', error => {
        errors.push(`${label} page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openTripReadyFreeApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        const bark = window.BARK;
        const parkRepo = bark && bark.repos && bark.repos.ParkRepo;
        const premiumService = bark && bark.services && bark.services.premium;
        const orsService = bark && bark.services && bark.services.ors;
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;

        if (!user || !bark || !parkRepo || !premiumService || !orsService) return false;
        if (typeof parkRepo.getAll !== 'function' || parkRepo.getAll().length < 2) return false;
        if (typeof premiumService.getDebugState !== 'function' || typeof premiumService.isPremium !== 'function') return false;
        if (typeof orsService.directions !== 'function') return false;
        if (typeof bark.updateTripUI !== 'function') return false;
        if (!bark.DOM || typeof bark.DOM.startRouteBtn !== 'function' || !bark.DOM.startRouteBtn()) return false;

        const debugState = premiumService.getDebugState();
        const reason = debugState && debugState.meta ? debugState.meta.reason || '' : '';
        return /^auth-user-snapshot/.test(reason) && premiumService.isPremium() === false;
    }, { timeout: 30000 });
}

async function seedTwoStopTrip(page) {
    await page.evaluate(() => {
        const stops = window.BARK.repos.ParkRepo.getAll()
            .filter(park => (
                park &&
                park.id &&
                park.name &&
                Number.isFinite(Number(park.lat)) &&
                Number.isFinite(Number(park.lng))
            ))
            .slice(0, 2)
            .map(park => ({
                id: park.id,
                name: park.name,
                lat: park.lat,
                lng: park.lng
            }));

        if (stops.length < 2) throw new Error('Need at least two testable parks for route upgrade smoke.');

        window.BARK.tripDays = [{
            color: window.BARK.DAY_COLORS[0],
            stops,
            notes: ''
        }];
        window.BARK.activeDayIdx = 0;
        window.tripStartNode = null;
        window.tripEndNode = null;
        window.BARK.updateTripUI();
    });
}

test.describe('BUG-021 route generation upgrade prompt', () => {
    test('signed-in free user tapping locked route generation sees upgrade path without ORS call', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, {
            storageState: freeStorageStatePath,
            viewport: { width: 390, height: 844 }
        });
        const page = await context.newPage();
        collectRelevantErrors(page, 'free route prompt', errors);

        try {
            await openTripReadyFreeApp(page);
            await seedTwoStopTrip(page);
            await page.locator('.nav-item[data-target="planner-view"]').click();
            await expect(page.locator('#planner-view')).toHaveClass(/active/, { timeout: 15000 });
            await page.evaluate(() => {
                window.__barkBug021DirectionsCalls = [];
                window.BARK.services.ors.directions = async (coordinates, options = {}) => {
                    window.__barkBug021DirectionsCalls.push({ coordinates, options });
                    return { type: 'FeatureCollection', features: [] };
                };
            });

            const button = page.locator('#start-route-btn');
            await expect(button).toHaveAttribute('aria-disabled', 'true');
            await expect(button).toHaveAttribute('data-premium-required', 'true');
            await expect(button).toContainText('Premium Route');
            await expect(button).not.toHaveAttribute('disabled', '');

            await button.click({ force: true });

            await expect(page.locator('#paywall-overlay')).toHaveClass(/active/, { timeout: 5000 });
            await expect(page.locator('#paywall-title')).toHaveText('Route generation is a Premium feature');
            await expect(page.locator('#paywall-body')).toContainText('Upgrade to generate driving routes');
            await expect(page.locator('#paywall-primary-btn')).toContainText('Upgrade Now');
            await expect(page.locator('#paywall-secondary-btn')).toContainText(/Maybe later/i);
            await expect(page.locator('#paywall-close-btn')).toBeVisible();

            const state = await page.evaluate(() => ({
                isPremium: window.BARK.services.premium.isPremium(),
                directionsCalls: window.__barkBug021DirectionsCalls.slice()
            }));
            expect(state.isPremium).toBe(false);
            expect(state.directionsCalls).toEqual([]);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
