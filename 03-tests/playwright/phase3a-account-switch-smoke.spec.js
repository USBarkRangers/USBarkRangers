const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const STORAGE_STATE_A = process.env.BARK_E2E_STORAGE_STATE;
const STORAGE_STATE_B = process.env.BARK_E2E_STORAGE_STATE_B;
const TEST_PARK_ID = process.env.BARK_E2E_TEST_PARK_ID || null;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_STORAGE_STATE_A = 'node_modules/.cache/bark-e2e/storage-state.json';
const DEFAULT_STORAGE_STATE_B = 'node_modules/.cache/bark-e2e/storage-state-b.json';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !STORAGE_STATE_A ? 'BARK_E2E_STORAGE_STATE' : null,
    !STORAGE_STATE_B ? 'BARK_E2E_STORAGE_STATE_B' : null
].filter(Boolean);

const storageStateAPath = STORAGE_STATE_A ? path.resolve(STORAGE_STATE_A) : null;
const storageStateBPath = STORAGE_STATE_B ? path.resolve(STORAGE_STATE_B) : null;
const storageStateAExists = storageStateAPath ? fs.existsSync(storageStateAPath) : false;
const storageStateBExists = storageStateBPath ? fs.existsSync(storageStateBPath) : false;

function buildEnvHelp() {
    return [
        'Phase 3A account-switch smoke tests are skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE_A}"`,
        `  export BARK_E2E_STORAGE_STATE_B="$PWD/${DEFAULT_STORAGE_STATE_B}"`,
        '',
        'Create User A storage state:',
        `  BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE_A}" npm run e2e:auth:save`,
        '',
        'Create User B storage state:',
        '  export BARK_E2E_AUTH_EMAIL=bark-e2e-test-b@example.com',
        '  export BARK_E2E_AUTH_PASSWORD="<test-only password from the secure vault>"',
        `  BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE_B}" npm run e2e:auth:save`,
        '',
        'Run:',
        '  npm run test:e2e:account-switch',
        '',
        'Optional:',
        '  export BARK_E2E_TEST_PARK_ID=canonical-park-id',
        '',
        'Notes:',
        '  - Storage states should be created with dedicated Firebase Email/Password E2E accounts.',
        '  - Google OAuth remains blocked in Playwright Chromium.',
        '  - Real users still use Google sign-in; no email/password UI was added.'
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

    if (STORAGE_STATE_A && !storageStateAExists) {
        throw new Error([
            `BARK_E2E_STORAGE_STATE points to a missing file: ${storageStateAPath}`,
            'Generate User A storage state with:',
            `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
            `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE_A}"`,
            '  npm run e2e:auth:save'
        ].join('\n'));
    }

    if (STORAGE_STATE_B && !storageStateBExists) {
        throw new Error([
            `BARK_E2E_STORAGE_STATE_B points to a missing file: ${storageStateBPath}`,
            'Generate User B storage state with:',
            `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
            `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE_B}"`,
            '  npm run e2e:auth:save'
        ].join('\n'));
    }
});

function collectRelevantConsoleErrors(page, label, errors) {
    const relevantPattern = /VaultRepo|auth.*snapshot|user snapshot|stale uid|userVisitedPlaces|__legacyMapView/i;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (relevantPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', error => {
        const text = error && error.message ? error.message : String(error);
        if (relevantPattern.test(text)) errors.push(`${label} page error: ${text}`);
    });
}

async function openSignedInApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        const bark = window.BARK;
        const repo = bark && bark.repos && bark.repos.ParkRepo;
        const vaultRepo = bark && bark.repos && bark.repos.VaultRepo;
        const firebaseReady = typeof window.firebase !== 'undefined'
            && firebase.auth
            && firebase.auth().currentUser;
        const visitedSnapshotReconciled = bark &&
            bark.refreshCoordinator &&
            typeof bark.refreshCoordinator.getStats === 'function' &&
            bark.refreshCoordinator.getStats().visitedCacheRefreshCount > 0;
        return Boolean(
            bark
            && repo
            && typeof repo.getAll === 'function'
            && repo.getAll().length > 0
            && vaultRepo
            && typeof vaultRepo.hasVisit === 'function'
            && bark.services
            && bark.services.checkin
            && bark.services.firebase
            && firebaseReady
            && visitedSnapshotReconciled
        );
    }, { timeout: 30000 });
}

async function getCurrentUser(page) {
    return page.evaluate(() => {
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
        return user ? {
            uid: user.uid,
            email: user.email || null
        } : null;
    });
}

async function getVisitSnapshot(page, parkId) {
    return page.evaluate((id) => {
        const vaultRepo = window.BARK.repos.VaultRepo;
        const record = vaultRepo.getVisit(id);
        return {
            count: vaultRepo.size(),
            record: record ? { ...record } : null
        };
    }, parkId);
}

async function getVisitedIds(page) {
    return page.evaluate(() => {
        const vaultRepo = window.BARK.repos.VaultRepo;
        return typeof vaultRepo.getVisitedIds === 'function'
            ? Array.from(vaultRepo.getVisitedIds())
            : vaultRepo.getVisits().map(place => place && place.id).filter(Boolean);
    });
}

async function getParkById(page, parkId) {
    return page.evaluate((id) => {
        const repo = window.BARK.repos.ParkRepo;
        const park = repo && typeof repo.getById === 'function' ? repo.getById(id) : null;
        return park ? {
            id: park.id,
            name: park.name,
            lat: park.lat,
            lng: park.lng,
            state: park.state,
            category: park.category,
            swagType: park.swagType,
            cost: park.cost
        } : null;
    }, parkId);
}

async function pickIsolatedTestPark(pageA, pageB) {
    const visitedA = new Set(await getVisitedIds(pageA));
    const visitedB = new Set(await getVisitedIds(pageB));

    if (TEST_PARK_ID) {
        const requested = await getParkById(pageA, TEST_PARK_ID);
        if (!requested || !requested.id) {
            throw new Error(`BARK_E2E_TEST_PARK_ID was not found in ParkRepo: ${TEST_PARK_ID}`);
        }
        if (visitedB.has(requested.id)) {
            throw new Error(
                `User B already has requested test park ${requested.id} visited. ` +
                'Clean up User B or choose a different BARK_E2E_TEST_PARK_ID.'
            );
        }
        return requested;
    }

    const parks = await pageA.evaluate(() => {
        const repo = window.BARK.repos.ParkRepo;
        return repo.getAll()
            .filter(park => park && park.id && park.lat && park.lng)
            .map(park => ({
                id: park.id,
                name: park.name,
                lat: park.lat,
                lng: park.lng,
                state: park.state,
                category: park.category,
                swagType: park.swagType,
                cost: park.cost
            }));
    });

    const candidate = parks.find(park => !visitedA.has(park.id) && !visitedB.has(park.id));
    if (!candidate) {
        throw new Error('No testable park found that is unvisited by both User A and User B.');
    }
    return candidate;
}

async function waitForVisitState(page, parkId, expectedVisited) {
    await page.waitForFunction(
        ({ id, expected }) => {
            const vaultRepo = window.BARK && window.BARK.repos && window.BARK.repos.VaultRepo;
            return Boolean(
                vaultRepo &&
                typeof vaultRepo.hasVisit === 'function' &&
                vaultRepo.hasVisit(id) === expected
            );
        },
        { id: parkId, expected: expectedVisited },
        { timeout: 30000 }
    );
}

async function markVisited(page, park) {
    const result = await page.evaluate(async (parkData) => {
        window.allowUncheck = true;
        return window.BARK.services.checkin.markAsVisited(parkData);
    }, park);
    expect(result && result.success, JSON.stringify(result)).toBe(true);
    return result;
}

async function ensureUnvisited(page, park) {
    const state = await getVisitSnapshot(page, park.id);
    if (!state.record) return;
    if (state.record.verified) {
        throw new Error(`Test park ${park.id} is verified and cannot be safely unmarked.`);
    }
    const result = await markVisited(page, park);
    expect(result.action).toBe('removed');
    await waitForVisitState(page, park.id, false);
}

async function assertNoRelevantConsoleErrors(errors) {
    expect(errors, errors.join('\n')).toEqual([]);
}

test.describe('Phase 3A account-switch isolation smoke', () => {
    test('visits do not leak between User A and User B', async ({ browser }) => {
        test.setTimeout(90000);

        const relevantErrors = [];
        const contextA = await newBarkContext(browser, { storageState: storageStateAPath });
        const contextB = await newBarkContext(browser, { storageState: storageStateBPath });
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();
        collectRelevantConsoleErrors(pageA, 'User A', relevantErrors);
        collectRelevantConsoleErrors(pageB, 'User B', relevantErrors);

        let park = null;

        try {
            await openSignedInApp(pageA);
            await openSignedInApp(pageB);

            const userA = await getCurrentUser(pageA);
            const userB = await getCurrentUser(pageB);
            expect(userA && userA.uid, 'User A should be signed in').toBeTruthy();
            expect(userB && userB.uid, 'User B should be signed in').toBeTruthy();
            expect(userA.uid, 'User A and User B storage states must be different accounts').not.toBe(userB.uid);

            park = await pickIsolatedTestPark(pageA, pageB);
            const userBBaseline = await getVisitSnapshot(pageB, park.id);
            expect(userBBaseline.record, 'User B should not start with User A test park visited').toBeNull();

            await ensureUnvisited(pageA, park);
            const added = await markVisited(pageA, park);
            expect(added.action).toBe('added');
            await waitForVisitState(pageA, park.id, true);

            await pageA.reload();
            await openSignedInApp(pageA);
            await waitForVisitState(pageA, park.id, true);

            await pageB.reload();
            await openSignedInApp(pageB);
            await waitForVisitState(pageB, park.id, false);
            const userBAfterAVisit = await getVisitSnapshot(pageB, park.id);
            expect(userBAfterAVisit.record, 'User B should not see User A visit').toBeNull();
            expect(userBAfterAVisit.count, 'User B visit count should be unaffected by User A visit').toBe(userBBaseline.count);

            await pageA.reload();
            await openSignedInApp(pageA);
            await waitForVisitState(pageA, park.id, true);

            const removed = await markVisited(pageA, park);
            expect(removed.action).toBe('removed');
            await waitForVisitState(pageA, park.id, false);

            await pageA.reload();
            await openSignedInApp(pageA);
            await waitForVisitState(pageA, park.id, false);

            await pageB.reload();
            await openSignedInApp(pageB);
            await waitForVisitState(pageB, park.id, false);
            const userBAfterCleanup = await getVisitSnapshot(pageB, park.id);
            expect(userBAfterCleanup.record, 'User B should remain unaffected after User A cleanup').toBeNull();
            expect(userBAfterCleanup.count, 'User B visit count should stay isolated after cleanup').toBe(userBBaseline.count);

            await assertNoRelevantConsoleErrors(relevantErrors);
        } finally {
            if (park) {
                try {
                    await openSignedInApp(pageA);
                    await ensureUnvisited(pageA, park);
                } catch (error) {
                    relevantErrors.push(`User A cleanup failed for ${park.id}: ${error.message || error}`);
                }
            }
            await contextB.close();
            await contextA.close();
        }
    });
});
