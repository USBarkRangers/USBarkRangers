const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const TEST_PARK_ID = process.env.BARK_E2E_TEST_PARK_ID || null;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_STORAGE_STATE = 'node_modules/.cache/bark-e2e/storage-state.json';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null
].filter(Boolean);

const storageStatePath = STORAGE_STATE ? path.resolve(STORAGE_STATE) : null;
const storageStateExists = storageStatePath ? fs.existsSync(storageStatePath) : false;

function buildEnvHelp() {
    return [
        'Phase 3A trip planner visited styling smoke tests are skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}"`,
        '  npm run e2e:auth:save',
        '  npm run test:e2e:trip-visited',
        '',
        'Optional:',
        '  export BARK_E2E_TEST_PARK_ID=canonical-park-id',
        '',
        'Notes:',
        '  - The storage state should be created with the Firebase Email/Password E2E test account.',
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

    if (STORAGE_STATE && !storageStateExists) {
        throw new Error([
            `BARK_E2E_STORAGE_STATE points to a missing file: ${storageStatePath}`,
            'Generate it with:',
            `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
            `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}"`,
            '  npm run e2e:auth:save'
        ].join('\n'));
    }
});

test.use(storageStateExists ? { storageState: storageStatePath } : {});

function collectRelevantConsoleErrors(page, errors) {
    const relevantPattern = /TripLayerManager|trip planner|tripPlanner|refreshBadgeStyles|RefreshCoordinator|VaultRepo|userVisitedPlaces|__legacyMapView/i;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (relevantPattern.test(text)) errors.push(`console error: ${text}`);
    });
    page.on('pageerror', error => {
        const text = error && error.message ? error.message : String(error);
        if (relevantPattern.test(text)) errors.push(`page error: ${text}`);
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
            && typeof window.addStopToTrip === 'function'
            && typeof bark.updateTripUI === 'function'
            && bark.tripLayer
            && typeof bark.tripLayer.refreshBadgeStyles === 'function'
            && document.getElementById('trip-queue-list')
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

async function pickTestPark(page) {
    return page.evaluate((requestedId) => {
        const repo = window.BARK.repos.ParkRepo;
        const all = repo.getAll();
        const requested = requestedId && typeof repo.getById === 'function'
            ? repo.getById(requestedId)
            : null;
        const fallback = all.find(park => park && park.id && park.lat && park.lng);
        const park = requested || fallback;
        if (!park || !park.id) throw new Error('No testable park found.');
        return {
            id: park.id,
            name: park.name,
            lat: park.lat,
            lng: park.lng,
            state: park.state,
            category: park.category,
            swagType: park.swagType,
            cost: park.cost
        };
    }, TEST_PARK_ID);
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

async function resetTripPlanner(page) {
    await page.evaluate(() => {
        if (window.BARK && typeof window.BARK.resetTripPlannerRuntime === 'function') {
            window.BARK.resetTripPlannerRuntime();
            return;
        }

        window.BARK = window.BARK || {};
        window.BARK.tripDays = [{ color: window.BARK.DAY_COLORS[0], stops: [], notes: '' }];
        window.BARK.activeDayIdx = 0;
        window.tripStartNode = null;
        window.tripEndNode = null;
        window.isTripEditMode = false;
        if (window.BARK.tripLayer && typeof window.BARK.tripLayer.clear === 'function') {
            window.BARK.tripLayer.clear();
        }
        if (typeof window.BARK.updateTripUI === 'function') {
            window.BARK.updateTripUI();
        }
    });
}

async function openPlanner(page) {
    await page.locator('.nav-item[data-target="planner-view"]').click();
    await expect(page.locator('#planner-view')).toHaveClass(/active/);
}

async function addTripStop(page, park) {
    const result = await page.evaluate((parkData) => {
        const added = window.addStopToTrip(parkData);
        return {
            added,
            stopCount: (window.BARK.tripDays || [])
                .reduce((sum, day) => sum + (day.stops ? day.stops.length : 0), 0)
        };
    }, park);
    expect(result.added, JSON.stringify(result)).toBe(true);
    expect(result.stopCount).toBeGreaterThan(0);
}

function getTripStopRow(page, park) {
    return page.locator('#trip-queue-list .stop-list-item', { hasText: park.name }).first();
}

async function waitForTripStopRendered(page, park) {
    const row = getTripStopRow(page, park);
    await expect(row).toBeVisible({ timeout: 30000 });
    return row;
}

async function getTripPlannerSnapshot(page, parkId) {
    return page.evaluate((id) => {
        const days = Array.isArray(window.BARK && window.BARK.tripDays) ? window.BARK.tripDays : [];
        const stops = [];
        days.forEach((day, dayIndex) => {
            (day.stops || []).forEach((stop, stopIndex) => {
                stops.push({ dayIndex, stopIndex, id: stop.id || null, name: stop.name || null });
            });
        });
        const badgeWrappers = Array.from(document.querySelectorAll('.trip-overlay-badge-wrapper--bark'));
        return {
            stopCount: stops.length,
            hasStop: stops.some(stop => stop.id === id),
            stops,
            badgeCount: badgeWrappers.length,
            badgeStates: badgeWrappers.map(wrapper => {
                if (wrapper.classList.contains('trip-overlay-badge-wrapper--visited')) return 'visited';
                if (wrapper.classList.contains('trip-overlay-badge-wrapper--unvisited')) return 'unvisited';
                return 'unknown';
            }),
            tripLayerStopIds: window.BARK &&
                window.BARK.tripLayer &&
                typeof window.BARK.tripLayer.getStopParkIds === 'function'
                ? Array.from(window.BARK.tripLayer.getStopParkIds())
                : []
        };
    }, parkId);
}

async function waitForTripBadgeState(page, expectedState) {
    await page.waitForFunction(
        ({ expected }) => {
            const wrappers = Array.from(document.querySelectorAll('.trip-overlay-badge-wrapper--bark'));
            if (wrappers.length !== 1) return false;
            return wrappers[0].classList.contains(`trip-overlay-badge-wrapper--${expected}`);
        },
        { expected: expectedState },
        { timeout: 30000 }
    );
}

async function ensureTripStopPresent(page, park) {
    const snapshot = await getTripPlannerSnapshot(page, park.id);
    if (!snapshot.hasStop) {
        await resetTripPlanner(page);
        await addTripStop(page, park);
    }
    await openPlanner(page);
    await waitForTripStopRendered(page, park);
}

test.describe('Phase 3A trip planner visited styling smoke', () => {
    test('trip planner badge styling follows VaultRepo visit state', async ({ page }) => {
        test.setTimeout(90000);

        const relevantErrors = [];
        collectRelevantConsoleErrors(page, relevantErrors);
        page.on('dialog', dialog => dialog.accept());

        let park = null;
        let tripStopPersistedAfterReload = false;

        try {
            await openSignedInApp(page);
            const user = await getCurrentUser(page);
            expect(user && user.uid, 'Signed-in storage state should produce a Firebase user').toBeTruthy();

            park = await pickTestPark(page);

            await resetTripPlanner(page);
            await ensureUnvisited(page, park);
            await addTripStop(page, park);
            await openPlanner(page);
            await waitForTripStopRendered(page, park);
            await waitForTripBadgeState(page, 'unvisited');

            const added = await markVisited(page, park);
            expect(added.action).toBe('added');
            await waitForVisitState(page, park.id, true);
            await waitForTripBadgeState(page, 'visited');

            await page.reload();
            await openSignedInApp(page);
            await waitForVisitState(page, park.id, true);

            const afterReload = await getTripPlannerSnapshot(page, park.id);
            tripStopPersistedAfterReload = afterReload.hasStop;
            if (tripStopPersistedAfterReload) {
                await openPlanner(page);
                await waitForTripStopRendered(page, park);
                await waitForTripBadgeState(page, 'visited');
            } else {
                console.warn('Trip planner stop persistence after reload is not covered: current runtime trip state does not persist across reload.');
                await resetTripPlanner(page);
                await addTripStop(page, park);
                await openPlanner(page);
                await waitForTripStopRendered(page, park);
                await waitForTripBadgeState(page, 'visited');
            }

            const removed = await markVisited(page, park);
            expect(removed.action).toBe('removed');
            await waitForVisitState(page, park.id, false);
            await waitForTripBadgeState(page, 'unvisited');

            expect(relevantErrors, relevantErrors.join('\n')).toEqual([]);
        } finally {
            if (park) {
                try {
                    await openSignedInApp(page);
                    await ensureUnvisited(page, park);
                    await resetTripPlanner(page);
                } catch (error) {
                    relevantErrors.push(`cleanup failed for ${park.id}: ${error.message || error}`);
                }
            }

            if (!tripStopPersistedAfterReload) {
                console.warn('Trip planner stop persistence after reload was not supported by current runtime state; dynamic styling and visit persistence were covered.');
            }
        }
    });
});
