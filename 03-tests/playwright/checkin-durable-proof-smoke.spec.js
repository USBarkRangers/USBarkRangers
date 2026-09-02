const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_PRIVATE_BASE_URL || 'http://localhost:4173/index.v141.html';

test('check-in proof stays fail-closed across browser engines and replays after reopen', async ({ browser }) => {
    const context = await newBarkContext(browser);
    const page = await context.newPage();

    try {
        await page.goto(BASE_URL);
        await page.waitForFunction(() => Boolean(
            window.BARK
            && window.BARK.repos
            && window.BARK.repos.VaultRepo
            && window.BARK.services
            && window.BARK.services.checkin
        ), { timeout: 30000 });

        const results = await page.evaluate(async () => {
            const repo = window.BARK.repos.VaultRepo;
            const checkin = window.BARK.services.checkin;
            const uid = 'browser-proof-user';
            const originalFirebase = window.firebase;
            const originalFirebaseService = window.BARK.services.firebase;
            const originalIncrementRequestCount = window.BARK.incrementRequestCount;
            let serverSnapshot = null;
            const writes = [];

            const makeSnapshot = (visits, metadata) => ({
                exists: true,
                metadata,
                data: () => ({ visitedPlaces: visits })
            });
            const installPending = (visit) => {
                repo.clear();
                repo.addVisit(visit);
                repo.stageUpsert(visit);
            };
            const run = async (visit, snapshot, timeoutMs = 70) => {
                installPending(visit);
                serverSnapshot = snapshot;
                const result = await checkin.awaitServerConfirmation(visit, { timeoutMs });
                return {
                    result,
                    pending: repo.hasPendingMutation(visit.id)
                };
            };

            window.BARK.incrementRequestCount = () => {};
            window.BARK.services.firebase = {
                reconcileVisitedPlacesSnapshot(visits, metadata) {
                    return repo.reconcileSnapshot(visits, metadata);
                },
                stageVisitedPlaceUpsert(visit) {
                    repo.stageUpsert(visit);
                },
                async updateCurrentUserVisitedPlaces(visits) {
                    writes.push(visits.map(visit => ({ ...visit })));
                }
            };
            window.firebase = {
                auth: () => ({ currentUser: { uid } }),
                firestore: () => ({
                    waitForPendingWrites: () => Promise.resolve(),
                    collection: () => ({
                        doc: () => ({
                            get: async () => {
                                if (serverSnapshot instanceof Error) throw serverSnapshot;
                                return serverSnapshot;
                            }
                        })
                    })
                })
            };

            try {
                const exact = { id: 'exact', verified: true, ts: 1, syncToken: 'exact-token' };
                const exactResult = await run(exact, makeSnapshot([exact], {
                    fromCache: false,
                    hasPendingWrites: false
                }), 250);

                const pending = { id: 'pending', verified: true, ts: 2, syncToken: 'pending-token' };
                const pendingResult = await run(pending, makeSnapshot([pending], {
                    fromCache: false,
                    hasPendingWrites: true
                }));

                const cached = { id: 'cached', verified: true, ts: 3, syncToken: 'cached-token' };
                const cachedResult = await run(cached, makeSnapshot([cached], {
                    fromCache: true,
                    hasPendingWrites: false
                }));

                const upgrade = { id: 'upgrade', verified: true, ts: 4, syncToken: 'upgrade-token' };
                const staleResult = await run(upgrade, makeSnapshot([
                    { id: 'upgrade', verified: false, ts: 1 }
                ], {
                    fromCache: false,
                    hasPendingWrites: false
                }));

                const weakSignal = { id: 'weak', verified: true, ts: 5, syncToken: 'weak-token' };
                const weakSignalResult = await run(weakSignal, new Error('network request stalled'));

                const reopenKey = `bark.unconfirmedVisits.${uid}`;
                const legacyQueued = { id: 'reopen', verified: true, ts: 6 };
                repo.clear();
                repo.addVisit({ id: 'reopen', verified: false, ts: 1 });
                localStorage.setItem(reopenKey, JSON.stringify({
                    reopen: { visit: legacyQueued, stashedAt: 6 }
                }));
                await checkin.replayUnconfirmedVisits(uid);
                const replayed = repo.getVisit('reopen');
                const reopenResult = {
                    verified: replayed && replayed.verified,
                    hasToken: Boolean(replayed && replayed.syncToken),
                    pending: repo.hasPendingMutation('reopen'),
                    visualPending: checkin.isVisitAwaitingServerProof('reopen'),
                    writes: writes.length
                };

                return {
                    exactResult,
                    pendingResult,
                    cachedResult,
                    staleResult,
                    weakSignalResult,
                    reopenResult
                };
            } finally {
                checkin.cancelPendingServerConfirmations('browser-test-finished');
                localStorage.removeItem(`bark.unconfirmedVisits.${uid}`);
                repo.clear();
                window.firebase = originalFirebase;
                window.BARK.services.firebase = originalFirebaseService;
                window.BARK.incrementRequestCount = originalIncrementRequestCount;
            }
        });

        expect(results.exactResult.result.confirmed).toBe(true);
        expect(results.exactResult.pending).toBe(false);

        for (const unsafeResult of [
            results.pendingResult,
            results.cachedResult,
            results.staleResult,
            results.weakSignalResult
        ]) {
            expect(unsafeResult.result.confirmed).toBe(false);
            expect(unsafeResult.pending).toBe(true);
        }

        expect(results.reopenResult).toEqual({
            verified: true,
            hasToken: true,
            pending: true,
            visualPending: true,
            writes: 1
        });
    } finally {
        await context.close();
    }
});
