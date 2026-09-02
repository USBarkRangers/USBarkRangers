const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const APP_ROOT = new URL('./', BASE_URL);
const UID = 'private-v141-weak-cell-user';
const ADD_VISIT = Object.freeze({
    id: '6b5a8134-6afb-4b93-8065-d10d3696eb5e',
    name: 'Acadia National Park Hulls Cove Visitor Center',
    lat: 44.4089658,
    lng: -68.2472733,
    verified: false,
    ts: 1788310800000,
    syncToken: 'private-v141-orange-add'
});
const DELETE_VISIT = Object.freeze({
    id: 'ce2177b4-6eea-46ab-a0f6-67eaa15ddaae',
    name: 'Agate Fossil Beds National Monument',
    lat: 42.4251377,
    lng: -103.7341933,
    verified: false,
    ts: 1788310801000
});

function journalKeys(uid) {
    return {
        baseline: `bark.authoritativeVisits.${uid}`,
        authoritativeIds: `bark.authoritativeVisitIds.${uid}`,
        additions: `bark.unconfirmedVisits.${uid}`,
        deletions: `bark.pendingVisitDeletes.${uid}`
    };
}

async function readPendingProjection(page) {
    return page.evaluate(({ uid, addId, deleteId, keys }) => {
        const repo = window.BARK.repos.VaultRepo;
        const checkin = window.BARK.services.checkin;
        const markerState = id => {
            const marker = window.BARK.markerManager?.markers?.get(id);
            const icon = marker && marker._icon;
            return {
                exists: Boolean(icon),
                orange: Boolean(icon?.classList?.contains('visited-pin--pending-sync')),
                visited: Boolean(icon?.classList?.contains('visited-marker')),
                unvisited: Boolean(icon?.classList?.contains('unvisited-marker'))
            };
        };

        return {
            online: navigator.onLine,
            authResolved: window._authStateResolved === true,
            privateEntry: Boolean(document.querySelector('script[src="core/app.v141.js"]')),
            controlled: Boolean(navigator.serviceWorker.controller),
            additionsJournal: localStorage.getItem(keys.additions),
            deletionsJournal: localStorage.getItem(keys.deletions),
            baselineJournal: localStorage.getItem(keys.baseline),
            authoritativeIds: localStorage.getItem(keys.authoritativeIds),
            add: {
                hasVisit: repo.hasVisit(addId),
                pendingType: repo.getPendingMutationType(addId),
                awaitingProof: checkin.isVisitAwaitingServerProof(addId),
                marker: markerState(addId)
            },
            deletion: {
                hasVisit: repo.hasVisit(deleteId),
                pendingType: repo.getPendingMutationType(deleteId),
                awaitingProof: checkin.isVisitAwaitingServerProof(deleteId),
                marker: markerState(deleteId)
            },
            rememberedUid: localStorage.getItem('bark.lastAuthenticatedVisitUid'),
            uid
        };
    }, {
        uid: UID,
        addId: ADD_VISIT.id,
        deleteId: DELETE_VISIT.id,
        keys: journalKeys(UID)
    });
}

async function waitForPendingProjection(page) {
    await page.waitForFunction(({ addId, deleteId }) => {
        const repo = window.BARK?.repos?.VaultRepo;
        const markerManager = window.BARK?.markerManager;
        return Boolean(
            window.BARK?.repos?.ParkRepo?.getAll?.().length > 300
            && repo?.hasVisit?.(addId)
            && repo?.getPendingMutationType?.(addId) === 'upsert'
            && !repo?.hasVisit?.(deleteId)
            && repo?.getPendingMutationType?.(deleteId) === 'delete'
            && markerManager?.markers?.get(addId)?._icon?.classList?.contains('visited-pin--pending-sync')
            && markerManager?.markers?.get(deleteId)?._icon?.classList?.contains('visited-pin--pending-sync')
        );
    }, { addId: ADD_VISIT.id, deleteId: DELETE_VISIT.id }, { timeout: 15000 });
}

test('private 0.141 Reload preserves orange add/delete journals until exact server proof', async ({ browser }) => {
    test.setTimeout(60000);
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const csv = fs.readFileSync(
        path.join(__dirname, '../../01-code/app/assets/data/bark-fallback.csv'),
        'utf8'
    );
    const keys = journalKeys(UID);

    await context.addInitScript(({ appOrigin, uid, csv, addVisit, deleteVisit, keys }) => {
        // Init scripts also run in third-party helper frames. Touch only the app
        // origin so an opaque/cross-origin frame cannot manufacture a pageerror.
        if (window.location.origin !== appOrigin) return;
        // This initializer runs again after Reload. Seed only once so the test
        // proves that production code preserves and rehydrates the journals.
        if (localStorage.getItem('bark.privateV141ReloadSeeded') !== '1') {
            localStorage.setItem('bark.privateV141ReloadSeeded', '1');
            localStorage.setItem('barkTermsAgreement', '1');
            localStorage.setItem('bark_seen_version', '0.141');
            localStorage.setItem('barkCSV', csv);
            localStorage.setItem('barkCSV_time', String(Date.now()));
            localStorage.setItem('bark.lastAuthenticatedVisitUid', uid);
            localStorage.setItem(keys.baseline, JSON.stringify({
                schemaVersion: 1,
                uid,
                visits: [deleteVisit]
            }));
            localStorage.setItem(keys.authoritativeIds, JSON.stringify([deleteVisit.id]));
            localStorage.setItem(keys.additions, JSON.stringify({
                [addVisit.id]: {
                    visit: addVisit,
                    stashedAt: Date.now(),
                    offlinePremiumProvisional: false
                }
            }));
            localStorage.setItem(keys.deletions, JSON.stringify({
                [deleteVisit.id]: {
                    id: deleteVisit.id,
                    stagedAt: Date.now(),
                    record: deleteVisit
                }
            }));
        }

        // Firebase initialization may return after registering its observer even
        // while weak cellular service prevents the first auth callback forever.
        // Install that exact boundary before the app's DOMContentLoaded handler.
        document.addEventListener('DOMContentLoaded', () => {
            const auth = window.BARK?.services?.auth;
            if (!auth) {
                window.__privateV141AuthOverrideMissing = true;
                return;
            }
            auth.initFirebase = () => {
                window._authStateResolved = false;
                window.__privateV141AuthObserverRegistered = true;
                window.BARK.showOfflineRecoveryNotice?.(
                    'Pending park changes stay saved on this device. Reload here to restart sync.'
                );
                return Promise.resolve();
            };
        }, { once: true });
    }, {
        appOrigin: APP_ROOT.origin,
        uid: UID,
        csv,
        addVisit: ADD_VISIT,
        deleteVisit: DELETE_VISIT,
        keys
    });

    await context.route(/https:\/\/docs\.google\.com\/spreadsheets\/d\/e\//, route => route.abort('failed'));

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    try {
        // Install from a neutral in-scope page. The corrective worker caches the
        // private entry, skips waiting only after the full shell is ready, and
        // claims this client before the normal app navigation below.
        await page.goto(new URL('pages/privacy.html', APP_ROOT).href, { waitUntil: 'domcontentloaded' });
        await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.register('../sw.js', {
                scope: '../',
                updateViaCache: 'none'
            });
            await navigator.serviceWorker.ready;
            if (!navigator.serviceWorker.controller) {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('0.141 worker did not claim the page')), 15000);
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        clearTimeout(timeout);
                        resolve();
                    }, { once: true });
                });
            }
            if (!registration.active) throw new Error('0.141 worker is not active');
        });

        await page.goto(`${BASE_URL}?privateV141WeakCell=${Date.now()}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('script[src="core/app.v141.js"]')).toHaveCount(1);
        await waitForPendingProjection(page);
        await expect(page.locator('#bark-loader')).toHaveCount(0, { timeout: 10000 });
        await expect(page.locator('#auth-failure-message')).toBeVisible();
        await expect(page.locator('#auth-failure-title')).toHaveText('You appear offline');

        const initial = await readPendingProjection(page);
        expect(initial.online).toBe(true);
        expect(initial.authResolved).toBe(false);
        expect(initial.privateEntry).toBe(true);
        expect(initial.controlled).toBe(true);
        expect(initial.rememberedUid).toBe(UID);
        expect(initial.add).toEqual({
            hasVisit: true,
            pendingType: 'upsert',
            awaitingProof: true,
            marker: { exists: true, orange: true, visited: true, unvisited: false }
        });
        expect(initial.deletion).toEqual({
            hasVisit: false,
            pendingType: 'delete',
            awaitingProof: true,
            marker: { exists: true, orange: true, visited: false, unvisited: true }
        });

        await page.locator('#auth-failure-dismiss').click();
        await expect(page.locator('#auth-failure-message')).toBeHidden();
        const afterDismiss = await readPendingProjection(page);
        expect(afterDismiss).toEqual({ ...initial });

        // A later stalled sync can show the same recovery notice again without
        // changing navigator.onLine or touching either durable intent.
        await page.evaluate(() => {
            window.BARK.hideOfflineRecoveryNotice({ resetDismissal: true });
            window.BARK.showOfflineRecoveryNotice(
                'Pending park changes stay saved on this device. Reload here to restart sync.'
            );
        });
        await expect(page.locator('#auth-failure-message')).toBeVisible();
        expect(await page.evaluate(() => navigator.onLine)).toBe(true);

        const firstDocumentTime = await page.evaluate(() => performance.timeOrigin);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.locator('#auth-failure-reload').click()
        ]);
        await expect(page.locator('script[src="core/app.v141.js"]')).toHaveCount(1);
        await waitForPendingProjection(page);
        expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(firstDocumentTime);
        expect(await page.evaluate(() => window.__privateV141AuthObserverRegistered === true)).toBe(true);
        expect(await page.evaluate(() => window._authStateResolved === true)).toBe(false);

        const afterReload = await readPendingProjection(page);
        expect(afterReload).toEqual({ ...initial });

        const authoritativeVisits = [ADD_VISIT];
        for (const metadata of [
            { fromCache: true, hasPendingWrites: false },
            { fromCache: false, hasPendingWrites: true },
            {}
        ]) {
            await page.evaluate(({ uid, visits, metadata }) => {
                const checkin = window.BARK.services.checkin;
                const firebaseService = window.BARK.services.firebase;
                firebaseService.reconcileVisitedPlacesSnapshot(visits, {
                    ...metadata,
                    canConfirmPending: true
                });
                checkin.reconcileUnconfirmedVisits(uid);
                firebaseService.reconcilePendingVisitDeletions(uid);
            }, { uid: UID, visits: authoritativeVisits, metadata });
            expect(await readPendingProjection(page)).toEqual({ ...initial });
        }

        const checkpointSaved = await page.evaluate(({ uid, visits }) => {
            const checkin = window.BARK.services.checkin;
            const firebaseService = window.BARK.services.firebase;
            const saved = checkin.rememberAuthoritativeVisitIds(uid, visits);
            firebaseService.reconcileVisitedPlacesSnapshot(visits, {
                fromCache: false,
                hasPendingWrites: false,
                canConfirmPending: saved
            });
            checkin.reconcileUnconfirmedVisits(uid);
            firebaseService.reconcilePendingVisitDeletions(uid);
            return saved;
        }, { uid: UID, visits: authoritativeVisits });
        expect(checkpointSaved).toBe(true);

        await expect.poll(async () => readPendingProjection(page)).toMatchObject({
            online: true,
            authResolved: false,
            additionsJournal: null,
            deletionsJournal: null,
            add: {
                hasVisit: true,
                pendingType: null,
                awaitingProof: false,
                marker: { exists: true, orange: false, visited: true, unvisited: false }
            },
            deletion: {
                hasVisit: false,
                pendingType: null,
                awaitingProof: false,
                marker: { exists: true, orange: false, visited: false, unvisited: true }
            }
        });
        expect(pageErrors).toEqual([]);
    } finally {
        await context.close();
    }
});
