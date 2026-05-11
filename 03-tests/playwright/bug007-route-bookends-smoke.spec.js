const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_PREMIUM_STORAGE_STATE = '03-tests/.auth/premium-user.json';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !PREMIUM_STORAGE_STATE ? 'BARK_E2E_PREMIUM_STORAGE_STATE' : null
].filter(Boolean);

const premiumStorageStatePath = PREMIUM_STORAGE_STATE ? path.resolve(PREMIUM_STORAGE_STATE) : null;

function buildEnvHelp() {
    return [
        'BUG-007 route bookend smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
        '  npx playwright test 03-tests/playwright/bug007-route-bookends-smoke.spec.js --workers=1 --reporter=list'
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

    if (premiumStorageStatePath && !fs.existsSync(premiumStorageStatePath)) {
        throw new Error(`BARK_E2E_PREMIUM_STORAGE_STATE points to a missing file: ${premiumStorageStatePath}`);
    }
});

function collectRelevantErrors(page, errors) {
    const relevantPattern = /FirebaseError|Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|ReferenceError|TypeError|tripPlannerCore|ORS directions request failed|Route failed/i;
    const nonFatalConnectivityPattern = /Data poll failed, backing off|Failed to fetch/i;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (nonFatalConnectivityPattern.test(text)) return;
        if (relevantPattern.test(text)) errors.push(`console error: ${text}`);
    });
    page.on('pageerror', error => {
        errors.push(`page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openPremiumTripReadyApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        const bark = window.BARK;
        const parkRepo = bark && bark.repos && bark.repos.ParkRepo;
        const premiumService = bark && bark.services && bark.services.premium;
        const orsService = bark && bark.services && bark.services.ors;
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;

        if (!user || !bark || !parkRepo || !premiumService || !orsService) return false;
        if (typeof parkRepo.getAll !== 'function' || parkRepo.getAll().length < 2) return false;
        if (typeof premiumService.isPremium !== 'function' || !premiumService.isPremium()) return false;
        if (typeof orsService.directions !== 'function') return false;
        if (typeof bark.updateTripUI !== 'function') return false;
        if (!bark.DOM || typeof bark.DOM.startRouteBtn !== 'function' || !bark.DOM.startRouteBtn()) return false;
        return !!window.map && typeof window.L !== 'undefined';
    }, { timeout: 30000 });
}

async function seedSparseBookendTrip(page) {
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

        if (parks.length < 2) throw new Error('Need at least two parks for BUG-007 route smoke.');

        const firstStop = {
            id: parks[0].id,
            name: parks[0].name,
            lat: Number(parks[0].lat),
            lng: Number(parks[0].lng)
        };
        const lastStop = {
            id: parks[1].id,
            name: parks[1].name,
            lat: Number(parks[1].lat),
            lng: Number(parks[1].lng)
        };

        const startNode = {
            name: 'Regression Trip Start',
            lat: firstStop.lat - 0.25,
            lng: firstStop.lng - 0.25,
            customPlaceId: 'bug007-start'
        };
        const endNode = {
            name: 'Regression Trip End',
            lat: lastStop.lat + 0.25,
            lng: lastStop.lng + 0.25,
            customPlaceId: 'bug007-end'
        };

        window.__barkBug007Alerts = [];
        window.__barkBug007DirectionsCalls = [];
        window.alert = (message) => {
            window.__barkBug007Alerts.push(String(message));
        };
        window.BARK.services.ors.directions = async (coordinates, options = {}) => {
            window.__barkBug007DirectionsCalls.push({ coordinates, options });
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

        window.BARK.tripDays = [
            { color: window.BARK.DAY_COLORS[0], stops: [firstStop], notes: 'First day has only one stop plus start.' },
            { color: window.BARK.DAY_COLORS[1], stops: [], notes: 'Intentionally empty day.' },
            { color: window.BARK.DAY_COLORS[2], stops: [lastStop], notes: 'Last day has only one stop plus end.' }
        ];
        window.BARK.activeDayIdx = 0;
        window.tripStartNode = startNode;
        window.tripEndNode = endNode;
        window.BARK.updateTripUI();

        return { firstStop, lastStop, startNode, endNode };
    });
}

test.describe('BUG-007 sparse trip bookend routing', () => {
    test('start/end bookends are applied before filtering routable days', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const page = await context.newPage();
        collectRelevantErrors(page, errors);

        try {
            await openPremiumTripReadyApp(page);
            const seed = await seedSparseBookendTrip(page);

            await page.evaluate(() => {
                const button = document.getElementById('start-route-btn');
                if (!button) throw new Error('Missing #start-route-btn');
                button.click();
            });
            await expect(page.locator('#route-generation-choice-modal')).toBeVisible({ timeout: 5000 });
            await page.locator('#route-skip-generate-btn').click();

            await page.waitForFunction(() => (
                Array.isArray(window.__barkBug007DirectionsCalls) &&
                window.__barkBug007DirectionsCalls.length === 2
            ), { timeout: 15000 });

            const result = await page.evaluate(() => ({
                alerts: window.__barkBug007Alerts.slice(),
                calls: window.__barkBug007DirectionsCalls.slice(),
                telemetryDisplay: document.getElementById('route-telemetry')?.style.display || '',
                buttonText: document.getElementById('start-route-btn')?.textContent.trim() || ''
            }));

            expect(result.alerts).toEqual([]);
            expect(result.calls).toHaveLength(2);
            expect(result.calls[0].coordinates).toEqual([
                [seed.startNode.lng, seed.startNode.lat],
                [seed.firstStop.lng, seed.firstStop.lat]
            ]);
            expect(result.calls[1].coordinates).toEqual([
                [seed.lastStop.lng, seed.lastStop.lat],
                [seed.endNode.lng, seed.endNode.lat]
            ]);
            expect(result.telemetryDisplay).toBe('none');
            expect(result.buttonText).toMatch(/Route Ready|Generate Route/);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
