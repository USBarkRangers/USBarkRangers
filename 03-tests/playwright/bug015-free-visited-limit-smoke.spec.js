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
const FREE_VISIT_LIMIT = 5;

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !FREE_STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null,
    !PREMIUM_STORAGE_STATE ? 'BARK_E2E_PREMIUM_STORAGE_STATE' : null
].filter(Boolean);

const freeStorageStatePath = FREE_STORAGE_STATE ? path.resolve(FREE_STORAGE_STATE) : null;
const premiumStorageStatePath = PREMIUM_STORAGE_STATE ? path.resolve(PREMIUM_STORAGE_STATE) : null;

function buildEnvHelp() {
    return [
        'BUG-015 free visited limit smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_FREE_STORAGE_STATE}"`,
        `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
        '  npx playwright test 03-tests/playwright/bug015-free-visited-limit-smoke.spec.js --workers=1 --reporter=list'
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
    const relevantPattern = /FirebaseError|Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|ReferenceError|TypeError|checkinService|VaultRepo/i;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (relevantPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', error => {
        errors.push(`${label} page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openVisitReadyApp(page, expectedPremium) {
    await page.goto(BASE_URL);
    await page.waitForFunction((expected) => {
        const bark = window.BARK;
        const parkRepo = bark && bark.repos && bark.repos.ParkRepo;
        const vaultRepo = bark && bark.repos && bark.repos.VaultRepo;
        const premiumService = bark && bark.services && bark.services.premium;
        const checkinService = bark && bark.services && bark.services.checkin;
        const firebaseService = bark && bark.services && bark.services.firebase;
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;

        if (!user || !parkRepo || !vaultRepo || !premiumService || !checkinService || !firebaseService) return false;
        if (typeof parkRepo.getAll !== 'function' || parkRepo.getAll().length < 25) return false;
        if (typeof checkinService.markAsVisited !== 'function' || typeof checkinService.verifyGpsCheckin !== 'function') return false;
        if (typeof premiumService.getDebugState !== 'function' || typeof premiumService.isPremium !== 'function') return false;

        const debugState = premiumService.getDebugState();
        const reason = debugState && debugState.meta ? debugState.meta.reason || '' : '';
        return /^auth-user-snapshot/.test(reason) && premiumService.isPremium() === expected;
    }, expectedPremium, { timeout: 30000 });
}

async function installVisitWriteStubs(page) {
    await page.evaluate(() => {
        const firebaseService = window.BARK.services.firebase;
        window.__barkBug015Writes = [];

        firebaseService.stageVisitedPlaceUpsert = (place) => {
            window.__barkBug015Writes.push({ type: 'stage-upsert', id: place && place.id });
        };
        firebaseService.stageVisitedPlaceDelete = (id) => {
            window.__barkBug015Writes.push({ type: 'stage-delete', id });
        };
        firebaseService.syncUserProgress = async () => {
            window.__barkBug015Writes.push({
                type: 'sync-progress',
                count: window.BARK.repos.VaultRepo.size()
            });
        };
        firebaseService.updateCurrentUserVisitedPlaces = async (visitedArray) => {
            window.__barkBug015Writes.push({
                type: 'update-visited',
                count: Array.isArray(visitedArray) ? visitedArray.length : null
            });
        };
        firebaseService.attemptDailyStreakIncrement = async () => {
            window.__barkBug015Writes.push({ type: 'daily-streak' });
            return { success: true, count: 1 };
        };
    });
}

async function seedLocalVisits(page, count) {
    return page.evaluate((requestedCount) => {
        const parks = window.BARK.repos.ParkRepo.getAll()
            .filter(park => (
                park &&
                park.id &&
                park.name &&
                Number.isFinite(Number(park.lat)) &&
                Number.isFinite(Number(park.lng))
            ));

        if (parks.length < requestedCount + 1) {
            throw new Error(`Need at least ${requestedCount + 1} parks for BUG-015 smoke; found ${parks.length}.`);
        }

        const now = Date.now();
        const visits = parks.slice(0, requestedCount).map((park, index) => ({
            id: park.id,
            name: park.name,
            lat: park.lat,
            lng: park.lng,
            verified: false,
            ts: now - index
        }));

        window.allowUncheck = true;
        window.BARK.repos.VaultRepo.replaceAll(visits);

        const toParkData = (park) => ({
            id: park.id,
            name: park.name,
            lat: park.lat,
            lng: park.lng,
            state: park.state,
            category: park.category,
            swagType: park.swagType,
            cost: park.cost
        });

        return {
            count: window.BARK.repos.VaultRepo.size(),
            firstVisitedPark: toParkData(parks[0]),
            nextUnvisitedPark: toParkData(parks[requestedCount])
        };
    }, count);
}

async function getVisitState(page, parkId) {
    return page.evaluate((id) => {
        const vaultRepo = window.BARK.repos.VaultRepo;
        return {
            count: vaultRepo.size(),
            hasVisit: vaultRepo.hasVisit(id),
            writes: Array.isArray(window.__barkBug015Writes) ? window.__barkBug015Writes.slice() : []
        };
    }, parkId);
}

async function markAsVisited(page, park) {
    return page.evaluate((parkData) => window.BARK.services.checkin.markAsVisited(parkData), park);
}

async function verifyGpsCheckin(page, park) {
    await page.evaluate((parkData) => {
        Object.defineProperty(window.navigator, 'geolocation', {
            configurable: true,
            value: {
                getCurrentPosition(success) {
                    success({
                        coords: {
                            latitude: Number(parkData.lat),
                            longitude: Number(parkData.lng),
                            accuracy: 5
                        }
                    });
                }
            }
        });
    }, park);

    return page.evaluate((parkData) => window.BARK.services.checkin.verifyGpsCheckin(parkData), park);
}

test.describe('BUG-015 free visited limit product rule', () => {
    test('free signed-in user can add the fifth visited park', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const page = await context.newPage();
        collectRelevantErrors(page, 'free add fifth', errors);

        try {
            await openVisitReadyApp(page, false);
            await installVisitWriteStubs(page);
            const scenario = await seedLocalVisits(page, FREE_VISIT_LIMIT - 1);

            const result = await markAsVisited(page, scenario.nextUnvisitedPark);
            const state = await getVisitState(page, scenario.nextUnvisitedPark.id);

            expect(result).toMatchObject({ success: true, action: 'added' });
            expect(state.count).toBe(FREE_VISIT_LIMIT);
            expect(state.hasVisit).toBe(true);
            expect(state.writes.some(write => write.type === 'sync-progress')).toBe(true);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('free signed-in user cannot add the sixth visited park, even with fake localStorage premium', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const page = await context.newPage();
        collectRelevantErrors(page, 'free block sixth', errors);

        try {
            await page.addInitScript(() => {
                window.localStorage.setItem('premiumLoggedIn', 'true');
            });
            await openVisitReadyApp(page, false);
            await installVisitWriteStubs(page);
            const scenario = await seedLocalVisits(page, FREE_VISIT_LIMIT);

            const result = await markAsVisited(page, scenario.nextUnvisitedPark);
            const state = await getVisitState(page, scenario.nextUnvisitedPark.id);

            expect(result).toMatchObject({
                success: false,
                error: 'FREE_VISIT_LIMIT',
                limit: FREE_VISIT_LIMIT,
                currentCount: FREE_VISIT_LIMIT
            });
            expect(state.count).toBe(FREE_VISIT_LIMIT);
            expect(state.hasVisit).toBe(false);
            expect(state.writes).toEqual([]);
            expect(await page.evaluate(() => window.BARK.services.premium.isPremium())).toBe(false);

            const paywallState = await page.evaluate((limitResult) => {
                window.alert = (message) => {
                    window.__barkBug015Alerts = window.__barkBug015Alerts || [];
                    window.__barkBug015Alerts.push(String(message));
                };
                window.BARK.panelRendererSafety.openFreeVisitLimitPaywall(limitResult);
                return {
                    alerts: window.__barkBug015Alerts || [],
                    overlayActive: document.getElementById('paywall-overlay').classList.contains('active'),
                    title: document.getElementById('paywall-title').textContent,
                    body: document.getElementById('paywall-body').textContent,
                    source: document.getElementById('paywall-source').textContent
                };
            }, result);

            expect(paywallState.alerts, 'free visit cap should use the Premium paywall modal instead of alert').toEqual([]);
            expect(paywallState.overlayActive).toBe(true);
            expect(paywallState.title).toBe('Adding more than 5 parks is a Premium feature');
            expect(paywallState.body).toContain('Free accounts can track up to 5 visited parks');
            expect(paywallState.source).toContain('visited place limit');
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('free signed-in user at the limit can still unmark a visit', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const page = await context.newPage();
        collectRelevantErrors(page, 'free remove at limit', errors);

        try {
            await openVisitReadyApp(page, false);
            await installVisitWriteStubs(page);
            const scenario = await seedLocalVisits(page, FREE_VISIT_LIMIT);

            const result = await markAsVisited(page, scenario.firstVisitedPark);
            const state = await getVisitState(page, scenario.firstVisitedPark.id);

            expect(result).toMatchObject({ success: true, action: 'removed' });
            expect(state.count).toBe(FREE_VISIT_LIMIT - 1);
            expect(state.hasVisit).toBe(false);
            expect(state.writes.some(write => write.type === 'update-visited')).toBe(true);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('free signed-in GPS check-in path is also blocked at the limit', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const page = await context.newPage();
        collectRelevantErrors(page, 'free gps block at limit', errors);

        try {
            await openVisitReadyApp(page, false);
            await installVisitWriteStubs(page);
            const scenario = await seedLocalVisits(page, FREE_VISIT_LIMIT);

            const result = await verifyGpsCheckin(page, scenario.nextUnvisitedPark);
            const state = await getVisitState(page, scenario.nextUnvisitedPark.id);

            expect(result).toMatchObject({
                success: false,
                error: 'FREE_VISIT_LIMIT',
                limit: FREE_VISIT_LIMIT,
                currentCount: FREE_VISIT_LIMIT
            });
            expect(state.count).toBe(FREE_VISIT_LIMIT);
            expect(state.hasVisit).toBe(false);
            expect(state.writes).toEqual([]);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('premium user can add beyond the free limit and free context re-applies the limit', async ({ browser }) => {
        const errors = [];
        const premiumContext = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const premiumPage = await premiumContext.newPage();
        collectRelevantErrors(premiumPage, 'premium add over limit', errors);

        try {
            await openVisitReadyApp(premiumPage, true);
            await installVisitWriteStubs(premiumPage);
            const scenario = await seedLocalVisits(premiumPage, FREE_VISIT_LIMIT);

            const result = await markAsVisited(premiumPage, scenario.nextUnvisitedPark);
            const state = await getVisitState(premiumPage, scenario.nextUnvisitedPark.id);

            expect(result).toMatchObject({ success: true, action: 'added' });
            expect(state.count).toBe(FREE_VISIT_LIMIT + 1);
            expect(state.hasVisit).toBe(true);
        } finally {
            await premiumContext.close();
        }

        const freeContext = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const freePage = await freeContext.newPage();
        collectRelevantErrors(freePage, 'free after premium limit', errors);

        try {
            await openVisitReadyApp(freePage, false);
            await installVisitWriteStubs(freePage);
            const scenario = await seedLocalVisits(freePage, FREE_VISIT_LIMIT);

            const result = await markAsVisited(freePage, scenario.nextUnvisitedPark);
            const state = await getVisitState(freePage, scenario.nextUnvisitedPark.id);

            expect(result).toMatchObject({
                success: false,
                error: 'FREE_VISIT_LIMIT',
                limit: FREE_VISIT_LIMIT
            });
            expect(state.count).toBe(FREE_VISIT_LIMIT);
            expect(state.hasVisit).toBe(false);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await freeContext.close();
        }
    });
});
