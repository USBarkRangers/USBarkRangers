const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const TEST_PARK_ID = process.env.BARK_E2E_TEST_PARK_ID || null;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_STORAGE_STATE = '03-tests/.auth/free-user.json';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null
].filter(Boolean);

const storageStatePath = STORAGE_STATE ? path.resolve(STORAGE_STATE) : null;
const storageStateExists = storageStatePath ? fs.existsSync(storageStatePath) : false;

function buildEnvHelp() {
    return [
        'Phase 1B signed-in smoke tests are skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}"`,
        '  npm run e2e:auth:save',
        '  npm run test:e2e:phase1b',
        '',
        'Optional:',
        '  export BARK_E2E_TEST_PARK_ID=canonical-park-id'
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

async function openSignedInApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        const bark = window.BARK;
        const repo = bark && bark.repos && bark.repos.ParkRepo;
        const firebaseReady = typeof window.firebase !== 'undefined'
            && firebase.auth
            && firebase.auth().currentUser;
        return Boolean(
            bark
            && repo
            && typeof repo.getAll === 'function'
            && repo.getAll().length > 0
            && bark.services
            && bark.services.checkin
            && bark.services.firebase
            && firebaseReady
        );
    }, { timeout: 30000 });
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

async function ensureVisited(page, park) {
    const state = await getVisitSnapshot(page, park.id);
    if (state.record) return state.record;
    const result = await markVisited(page, park);
    expect(result.action).toBe('added');
    await waitForVisitState(page, park.id, true);
    return (await getVisitSnapshot(page, park.id)).record;
}

test.describe('Phase 1B visited-place regression safety net', () => {
    test('visit lifecycle persists across reloads', async ({ page }) => {
        await openSignedInApp(page);
        const park = await pickTestPark(page);

        await ensureUnvisited(page, park);
        const added = await markVisited(page, park);
        expect(added.action).toBe('added');
        await waitForVisitState(page, park.id, true);

        await page.reload();
        await openSignedInApp(page);
        await waitForVisitState(page, park.id, true);

        const removed = await markVisited(page, park);
        expect(removed.action).toBe('removed');
        await waitForVisitState(page, park.id, false);

        await page.reload();
        await openSignedInApp(page);
        await waitForVisitState(page, park.id, false);
    });

    test('updateVisitDate rolls local UI state back when Firestore update fails', async ({ page }) => {
        await openSignedInApp(page);
        const park = await pickTestPark(page);
        const original = await ensureVisited(page, park);
        const originalTs = original.ts || Date.now();
        const nextTs = originalTs + (7 * 24 * 60 * 60 * 1000);

        const result = await page.evaluate(async ({ parkId, ts }) => {
            const originalFirestore = firebase.firestore;
            firebase.firestore = function forcedFirestoreFailure() {
                const db = originalFirestore.call(firebase);
                return {
                    collection(collectionName) {
                        const collectionRef = db.collection(collectionName);
                        if (collectionName !== 'users') return collectionRef;
                        return {
                            doc(docId) {
                                const docRef = collectionRef.doc(docId);
                                return {
                                    update() {
                                        return Promise.reject(new Error('Forced Phase 1B rollback smoke failure'));
                                    },
                                    get: docRef.get ? docRef.get.bind(docRef) : undefined,
                                    set: docRef.set ? docRef.set.bind(docRef) : undefined,
                                    onSnapshot: docRef.onSnapshot ? docRef.onSnapshot.bind(docRef) : undefined
                                };
                            }
                        };
                    }
                };
            };
            try {
                await window.BARK.updateVisitDate(parkId, ts);
                return { threw: false };
            } catch (error) {
                return {
                    threw: true,
                    message: error && error.message,
                    record: { ...window.BARK.repos.VaultRepo.getVisit(parkId) }
                };
            } finally {
                firebase.firestore = originalFirestore;
            }
        }, { parkId: park.id, ts: nextTs });

        expect(result.threw).toBe(true);
        expect(result.record.ts).toBe(originalTs);
    });

    test('logout clears visits and signed-in test state restores them', async ({ browser, page }) => {
        await openSignedInApp(page);
        const park = await pickTestPark(page);
        await ensureVisited(page, park);
        const signedInSnapshot = await getVisitSnapshot(page, park.id);
        expect(signedInSnapshot.count).toBeGreaterThan(0);

        await page.evaluate(() => firebase.auth().signOut());
        await page.waitForFunction(() => {
            const vaultRepo = window.BARK && window.BARK.repos && window.BARK.repos.VaultRepo;
            return !firebase.auth().currentUser &&
                vaultRepo &&
                typeof vaultRepo.size === 'function' &&
                vaultRepo.size() === 0;
        }, { timeout: 30000 });

        const restoredContext = await newBarkContext(browser, { storageState: storageStatePath });
        const restoredPage = await restoredContext.newPage();
        try {
            await openSignedInApp(restoredPage);
            await waitForVisitState(restoredPage, park.id, true);
            const restoredSnapshot = await getVisitSnapshot(restoredPage, park.id);
            expect(restoredSnapshot.count).toBe(signedInSnapshot.count);
        } finally {
            await restoredContext.close();
        }
    });
});
