const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const FREE_STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_FREE_STORAGE_STATE = '03-tests/.auth/free-user.json';
const DEFAULT_PREMIUM_STORAGE_STATE = '03-tests/.auth/premium-user.json';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !FREE_STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null,
    !PREMIUM_STORAGE_STATE ? 'BARK_E2E_PREMIUM_STORAGE_STATE' : null
].filter(Boolean);

const freeStorageStatePath = FREE_STORAGE_STATE ? path.resolve(FREE_STORAGE_STATE) : null;
const premiumStorageStatePath = PREMIUM_STORAGE_STATE ? path.resolve(PREMIUM_STORAGE_STATE) : null;

function buildEnvHelp() {
    return [
        'BUG-016 route generation gating smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_FREE_STORAGE_STATE}"`,
        `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
        '  npx playwright test 03-tests/playwright/bug016-route-generation-gating-smoke.spec.js --workers=1 --reporter=list'
    ].join('\n');
}

if (missingEnv.length > 0) {
    console.warn(buildEnvHelp());
}

test.skip(missingEnv.length > 0, buildEnvHelp());

test.beforeAll(() => {
    if (!BASE_URL) return;
    try {
        new URL(BASE_URL);
    } catch (error) {
        throw new Error(`BARK_E2E_BASE_URL is not a valid absolute URL: ${BASE_URL}`);
    }

    for (const [name, storagePath] of [
        ['BARK_E2E_STORAGE_STATE', freeStorageStatePath],
        ['BARK_E2E_PREMIUM_STORAGE_STATE', premiumStorageStatePath]
    ]) {
        if (storagePath && !fs.existsSync(storagePath)) {
            throw new Error(`${name} points to a missing file: ${storagePath}`);
        }
    }
});

function collectRelevantErrors(page, label, errors) {
    const relevantPattern = /FirebaseError|Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|ReferenceError|TypeError|tripPlannerCore|ORS directions request failed|Route failed/i;
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

async function openTripReadyApp(page, expectedPremium) {
    await page.goto(BASE_URL);
    await page.waitForFunction((expected) => {
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
        if (!window.map || typeof window.L === 'undefined') return false;

        const debugState = premiumService.getDebugState();
        const reason = debugState && debugState.meta ? debugState.meta.reason || '' : '';
        return /^auth-user-snapshot/.test(reason) && premiumService.isPremium() === expected;
    }, expectedPremium, { timeout: 30000 });
}

async function seedTwoStopTrip(page) {
    return page.evaluate(() => {
        const parks = window.BARK.repos.ParkRepo.getAll()
            .filter(park => (
                park &&
                park.id &&
                park.name &&
                Number.isFinite(Number(park.lat)) &&
                Number.isFinite(Number(park.lng))
            ))
            .slice(0, 2);

        if (parks.length < 2) throw new Error('Need at least two testable parks for route gating smoke.');

        const stops = parks.map(park => ({
            id: park.id,
            name: park.name,
            lat: park.lat,
            lng: park.lng
        }));

        window.BARK.tripDays = [{
            color: window.BARK.DAY_COLORS[0],
            stops,
            notes: ''
        }];
        window.BARK.activeDayIdx = 0;
        window.tripStartNode = null;
        window.tripEndNode = null;
        window.BARK.updateTripUI();

        return stops;
    });
}

async function installRouteSpies(page) {
    await page.evaluate(() => {
        window.__barkBug016Alerts = [];
        window.__barkBug016Paywalls = [];
        window.__barkBug016DirectionsCalls = [];

        window.alert = (message) => {
            window.__barkBug016Alerts.push(String(message));
        };

        window.BARK.paywall.openPaywall = (options = {}) => {
            window.__barkBug016Paywalls.push({ ...options });
            const overlay = document.getElementById('paywall-overlay');
            if (overlay) {
                overlay.classList.add('active');
                overlay.setAttribute('aria-hidden', 'false');
            }
        };

        window.BARK.services.ors.directions = async (coordinates, options = {}) => {
            window.__barkBug016DirectionsCalls.push({ coordinates, options });
            return {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates
                    },
                    properties: {
                        summary: {
                            distance: 1609.34,
                            duration: 600
                        }
                    }
                }]
            };
        };

        window.BARK.confirmLongRouteWarning = async () => 'continue';
    });
}

async function readRouteState(page) {
    return page.evaluate(() => {
        const button = document.getElementById('start-route-btn');
        const telemetry = document.getElementById('route-telemetry');
        return {
            button: button ? {
                disabled: button.disabled === true,
                ariaDisabled: button.getAttribute('aria-disabled'),
                premiumRequired: button.dataset.premiumRequired || null,
                text: button.textContent.trim(),
                lockedClass: button.classList.contains('planner-action-premium-locked'),
                title: button.getAttribute('title') || ''
            } : null,
            directionsCalls: Array.isArray(window.__barkBug016DirectionsCalls)
                ? window.__barkBug016DirectionsCalls.slice()
                : [],
            paywalls: Array.isArray(window.__barkBug016Paywalls)
                ? window.__barkBug016Paywalls.slice()
                : [],
            alerts: Array.isArray(window.__barkBug016Alerts)
                ? window.__barkBug016Alerts.slice()
                : [],
            telemetry: telemetry ? {
                display: telemetry.style.display,
                text: telemetry.textContent.trim()
            } : null
        };
    });
}

async function forceRouteButtonClick(page) {
    await page.evaluate(() => {
        const button = document.getElementById('start-route-btn');
        if (!button) throw new Error('Missing #start-route-btn');
        button.disabled = false;
        button.setAttribute('aria-disabled', 'false');
        button.click();
    });
}

test.describe('BUG-016 route generation premium product rule', () => {
    test('signed-in free route generation is visually locked and cannot reach ORS when forced', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const page = await context.newPage();
        collectRelevantErrors(page, 'free route generation', errors);

        try {
            await openTripReadyApp(page, false);
            await seedTwoStopTrip(page);
            await installRouteSpies(page);

            const lockedState = await readRouteState(page);
            expect(lockedState.button).toMatchObject({
                disabled: false,
                ariaDisabled: 'true',
                premiumRequired: 'true',
                lockedClass: true,
                text: 'Premium Route',
                title: 'Premium is required to generate driving routes.'
            });

            await forceRouteButtonClick(page);
            await page.waitForFunction(() => (
                Array.isArray(window.__barkBug016Paywalls) &&
                window.__barkBug016Paywalls.length === 1
            ), { timeout: 5000 });

            const forcedState = await readRouteState(page);
            expect(forcedState.directionsCalls).toEqual([]);
            expect(forcedState.paywalls[0]).toMatchObject({ source: 'route-generation' });
            expect(forcedState.button.disabled).toBe(false);
            expect(forcedState.button.ariaDisabled).toBe('true');
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('premium route generation stays enabled and reaches the ORS directions path', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const page = await context.newPage();
        collectRelevantErrors(page, 'premium route generation', errors);

        try {
            await openTripReadyApp(page, true);
            await seedTwoStopTrip(page);
            await installRouteSpies(page);

            const unlockedState = await readRouteState(page);
            expect(unlockedState.button).toMatchObject({
                disabled: false,
                ariaDisabled: 'false',
                premiumRequired: 'false',
                lockedClass: false,
                text: 'Generate Route'
            });

            await page.evaluate(() => {
                const button = document.getElementById('start-route-btn');
                if (!button) throw new Error('Missing #start-route-btn');
                button.click();
            });
            await expect(page.locator('#route-generation-choice-modal')).toBeVisible({ timeout: 5000 });
            await page.locator('#route-skip-generate-btn').click();
            await page.waitForFunction(() => (
                Array.isArray(window.__barkBug016DirectionsCalls) &&
                window.__barkBug016DirectionsCalls.length === 1
            ), { timeout: 15000 });

            const routedState = await readRouteState(page);
            expect(routedState.directionsCalls).toHaveLength(1);
            expect(routedState.paywalls).toEqual([]);
            expect(routedState.telemetry.display).toBe('none');
            expect(routedState.button.text).toMatch(/Route Ready|Generate Route/);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
