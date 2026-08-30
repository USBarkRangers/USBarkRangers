const fs = require('node:fs');
const path = require('node:path');
const { test, expect, devices } = require('@playwright/test');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const ALLOW_WRITES = process.env.BARK_E2E_ALLOW_WRITE_TESTS === '1';
const storageStatePath = STORAGE_STATE ? path.resolve(STORAGE_STATE) : null;
const ready = Boolean(BASE_URL && storageStatePath && fs.existsSync(storageStatePath) && ALLOW_WRITES);

test.skip(!ready, 'Requires a signed-in Premium storage state and BARK_E2E_ALLOW_WRITE_TESTS=1.');
test.use({
    ...devices['iPhone 15 Pro'],
    storageState: storageStatePath || undefined,
    serviceWorkers: 'allow'
});

test('Premium bulk removal crosses the live Firestore rule safely and restores its baseline', async ({ page }) => {
    const alerts = [];
    page.on('dialog', async dialog => {
        alerts.push(dialog.message());
        await dialog.dismiss();
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const bark = window.BARK;
        return Boolean(
            window.firebase
            && firebase.auth().currentUser
            && bark
            && bark.repos
            && bark.repos.ParkRepo
            && bark.repos.VaultRepo
            && bark.services
            && bark.services.firebase
            && bark.services.premium
            && bark.services.premium.isPremium()
            && bark.repos.ParkRepo.getAll().length > 20
        );
    }, null, { timeout: 45000 });

    const testParks = await page.evaluate(() => {
        const vault = window.BARK.repos.VaultRepo;
        return window.BARK.repos.ParkRepo.getAll()
            .filter(park => park && park.id && !vault.hasVisit(park.id))
            .slice(0, 6)
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
    expect(testParks).toHaveLength(6);

    try {
        // Establish six known test-only visits and prove they reached the
        // authoritative server document before exercising bulk removal.
        for (const park of testParks) {
            const result = await page.evaluate(async parkData => {
                const added = await window.BARK.services.checkin.markAsVisited(parkData);
                await window.BARK.services.firebase.syncUserProgress();
                return { success: added.success, action: added.action };
            }, park);
            expect(result).toEqual({ success: true, action: 'added' });
        }

        const serverHasAll = await page.evaluate(async ids => {
            const user = firebase.auth().currentUser;
            const snapshot = await firebase.firestore().collection('users').doc(user.uid).get({ source: 'server' });
            const serverIds = new Set((snapshot.data().visitedPlaces || []).map(visit => String(visit.id)));
            return ids.every(id => serverIds.has(String(id)));
        }, testParks.map(park => park.id));
        expect(serverHasAll).toBe(true);

        const result = await page.evaluate(async ids => {
            const vault = window.BARK.repos.VaultRepo;
            const entries = ids.map(id => ({ id, record: { ...vault.getVisit(id) } }));
            const removal = window.BARK.services.firebase.removeVisitedEntries(entries);
            await removal.syncPromise;
            const pending = vault.snapshot().pending;
            return {
                removed: ids.every(id => !vault.hasVisit(id)),
                pendingCount: pending.size
            };
        }, testParks.map(park => park.id));
        expect(result).toEqual({ removed: true, pendingCount: 0 });

        const serverRemovedAll = await page.evaluate(async ids => {
            const user = firebase.auth().currentUser;
            const snapshot = await firebase.firestore().collection('users').doc(user.uid).get({ source: 'server' });
            const serverIds = new Set((snapshot.data().visitedPlaces || []).map(visit => String(visit.id)));
            return ids.every(id => !serverIds.has(String(id)));
        }, testParks.map(park => park.id));
        expect(serverRemovedAll).toBe(true);
        expect(alerts).toEqual([]);
    } finally {
        // If an assertion fails before the bulk removal, restore the original
        // unvisited baseline in rule-safe pairs so a test cannot pollute the
        // Premium test account.
        await page.evaluate(async ids => {
            const firebaseService = window.BARK.services.firebase;
            const vault = window.BARK.repos.VaultRepo;
            for (let index = 0; index < ids.length; index += 2) {
                const entries = ids.slice(index, index + 2)
                    .filter(id => vault.hasVisit(id))
                    .map(id => ({ id, record: { ...vault.getVisit(id) } }));
                if (entries.length === 0) continue;
                const removal = firebaseService.removeVisitedEntries(entries);
                await removal.syncPromise;
            }
        }, testParks.map(park => park.id));
    }
});
