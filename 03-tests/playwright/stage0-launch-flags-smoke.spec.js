const { test, expect } = require('@playwright/test');
const { expectBarkAppIdentity, newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

function collectRelevantErrors(page, label, errors) {
    const ignoredPattern = /Could not reach Cloud Firestore backend|Data poll failed, backing off|Failed to load resource/i;
    const relevantPattern = /ReferenceError|TypeError|FirebaseError|PERMISSION_DENIED|permission-denied|launchFlags|paywall|feedback|leaderboard|ORS/i;

    page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (ignoredPattern.test(text)) return;
        if (relevantPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', (error) => {
        errors.push(`${label} page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openFlagReadyApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean(
        window.BARK &&
        typeof window.BARK.isLaunchFlagEnabled === 'function' &&
        typeof window.BARK.setLaunchFlagForSession === 'function' &&
        window.BARK.services &&
        window.BARK.services.ors &&
        typeof window.BARK.services.ors.geocode === 'function' &&
        typeof window.BARK.services.ors.directions === 'function' &&
        window.BARK.paywall &&
        typeof window.BARK.paywall.openPaywall === 'function' &&
        typeof window.BARK.loadLeaderboard === 'function' &&
        window.firebase &&
        typeof window.firebase.firestore === 'function' &&
        document.getElementById('feedback-portal') &&
        document.getElementById('paywall-overlay')
    ), { timeout: 30000 });
}

test.describe('Stage 0 launch safety flags', () => {
    test('feedback portal is enabled by default and still uses the signed-in callable path', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser);
        const page = await context.newPage();
        collectRelevantErrors(page, 'feedback default enabled', errors);

        try {
            await openFlagReadyApp(page);

            const state = await page.evaluate(() => ({
                feedbackFlag: window.BARK.isLaunchFlagEnabled('feedbackEnabled'),
                feedbackDisabled: document.getElementById('feedback-text').disabled,
                feedbackButtonDisabled: document.getElementById('submit-feedback-btn').disabled,
                feedbackButtonText: document.getElementById('submit-feedback-btn').textContent.replace(/\s+/g, ' ').trim(),
                launchDisabled: document.getElementById('feedback-portal').dataset.launchDisabled || ''
            }));

            expect(state).toMatchObject({
                feedbackFlag: true,
                feedbackDisabled: false,
                feedbackButtonDisabled: false,
                feedbackButtonText: 'Submit Feedback',
                launchDisabled: ''
            });
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('risky features fail closed with friendly disabled states and normal browsing still loads', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser);
        await context.addInitScript(() => {
            window.localStorage.setItem('barkLaunchFlags', JSON.stringify({
                checkoutEnabled: false,
                routePlannerEnabled: false,
                routeGenerationEnabled: false,
                premiumGeocodeEnabled: false,
                leaderboardDeepBrowsingEnabled: false,
                feedbackEnabled: false,
                premiumRiskyToolsEnabled: false
            }));
        });

        const page = await context.newPage();
        collectRelevantErrors(page, 'flags disabled', errors);

        try {
            await openFlagReadyApp(page);
            await expectBarkAppIdentity(page, expect);

            const state = await page.evaluate(async () => {
                const routeResult = await window.BARK.services.ors.directions([[-81.65, 30.33], [-81.66, 30.34]])
                    .then(() => ({ ok: true }))
                    .catch(error => ({ ok: false, code: error.code, message: error.message }));
                const geocodeResult = await window.BARK.services.ors.geocode('Jacksonville')
                    .then(() => ({ ok: true }))
                    .catch(error => ({ ok: false, code: error.code, message: error.message }));

                window.BARK.paywall.openPaywall({ source: 'stage0-qc' });

                const originalFirestore = window.firebase.firestore;
                const originalAuth = window.firebase.auth;
                const docs = Array.from({ length: 5 }, (_, index) => ({
                    id: `leader-${index + 1}`,
                    data: () => ({
                        displayName: `Leader ${index + 1}`,
                        totalPoints: 100 - index,
                        totalVisited: 5 - index,
                        hasVerified: index === 0
                    })
                }));
                const snapshot = {
                    empty: false,
                    docs,
                    forEach(callback) {
                        docs.forEach(callback);
                    }
                };

                let firestoreGets = 0;
                window.firebase.firestore = () => ({
                    collection: () => ({
                        orderBy: () => ({
                            limit: () => ({
                                get: async () => {
                                    firestoreGets += 1;
                                    return snapshot;
                                }
                            })
                        })
                    })
                });
                window.firebase.auth = () => ({ currentUser: null });

                await window.BARK.loadLeaderboard();

                window.firebase.firestore = originalFirestore;
                window.firebase.auth = originalAuth;

                return {
                    flags: { ...window.BARK.launchFlags },
                    parkCount: window.BARK.repos.ParkRepo.getAll().length,
                    routeResult,
                    geocodeResult,
                    paywall: {
                        state: document.getElementById('paywall-overlay').dataset.paywallState,
                        title: document.getElementById('paywall-title').textContent,
                        body: document.getElementById('paywall-body').textContent,
                        primaryText: document.getElementById('paywall-primary-btn').textContent,
                        primaryDisabled: document.getElementById('paywall-primary-btn').disabled
                    },
                    feedback: {
                        disabled: document.getElementById('feedback-text').disabled,
                        buttonDisabled: document.getElementById('submit-feedback-btn').disabled,
                        buttonText: document.getElementById('submit-feedback-btn').textContent,
                        launchDisabled: document.getElementById('feedback-portal').dataset.launchDisabled
                    },
                    leaderboard: {
                        firestoreGets,
                        disabledNote: document.getElementById('lb-load-more-disabled')?.textContent || '',
                        loadMoreVisible: Boolean(document.getElementById('lb-load-more-btn'))
                    }
                };
            });

            expect(state.parkCount).toBeGreaterThan(0);
            expect(state.routeResult).toMatchObject({ ok: false, code: 'launch-disabled' });
            expect(state.routeResult.message).toMatch(/paused for beta safety/i);
            expect(state.geocodeResult).toMatchObject({ ok: false, code: 'launch-disabled' });
            expect(state.geocodeResult.message).toMatch(/paused for beta safety/i);
            expect(state.paywall.state).toBe('checkout-disabled');
            expect(state.paywall.title).toMatch(/checkout is paused/i);
            expect(state.paywall.body).toMatch(/paused for this beta/i);
            expect(state.paywall.primaryDisabled).toBe(true);
            expect(state.feedback).toMatchObject({
                disabled: true,
                buttonDisabled: true,
                buttonText: 'Feedback paused',
                launchDisabled: 'true'
            });
            expect(state.leaderboard.firestoreGets).toBe(1);
            expect(state.leaderboard.disabledNote).toMatch(/Leaderboard browsing is limited/i);
            expect(state.leaderboard.loadMoreVisible).toBe(false);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('route, geocode, checkout, and feedback paths can be re-enabled for the session', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser);
        await context.addInitScript(() => {
            window.localStorage.setItem('barkLaunchFlags', JSON.stringify({
                checkoutEnabled: true,
                routePlannerEnabled: true,
                routeGenerationEnabled: true,
                premiumGeocodeEnabled: true,
                leaderboardDeepBrowsingEnabled: true,
                feedbackEnabled: true,
                premiumRiskyToolsEnabled: true
            }));
        });

        const page = await context.newPage();
        collectRelevantErrors(page, 'flags enabled', errors);

        try {
            await openFlagReadyApp(page);

            const state = await page.evaluate(async () => {
                const callableCalls = [];
                const originalFunctions = window.firebase.functions;
                window.firebase.functions = () => ({
                    httpsCallable(name) {
                        return async (payload) => {
                            callableCalls.push({ name, payload });
                            return { data: { ok: true, name } };
                        };
                    }
                });

                const routeResult = await window.BARK.services.ors.directions([[-81.65, 30.33], [-81.66, 30.34]]);
                const geocodeResult = await window.BARK.services.ors.geocode('Jacksonville');
                window.BARK.paywall.renderCurrentState();

                const result = {
                    routeResult,
                    geocodeResult,
                    callableCalls,
                    paywallState: document.getElementById('paywall-overlay').dataset.paywallState,
                    feedbackDisabled: document.getElementById('feedback-text').disabled,
                    feedbackButtonDisabled: document.getElementById('submit-feedback-btn').disabled
                };

                window.firebase.functions = originalFunctions;
                return result;
            });

            expect(state.callableCalls.map(call => call.name)).toEqual(['getPremiumRoute', 'getPremiumGeocode']);
            expect(state.routeResult).toMatchObject({ ok: true, name: 'getPremiumRoute' });
            expect(state.geocodeResult).toMatchObject({ ok: true, name: 'getPremiumGeocode' });
            expect(state.paywallState).not.toBe('checkout-disabled');
            expect(state.feedbackDisabled).toBe(false);
            expect(state.feedbackButtonDisabled).toBe(false);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('leaderboard initial load and See More keep the existing read pagination when enabled', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser);
        await context.addInitScript(() => {
            window.localStorage.setItem('barkLaunchFlags', JSON.stringify({
                leaderboardDeepBrowsingEnabled: true
            }));
        });

        const page = await context.newPage();
        collectRelevantErrors(page, 'leaderboard enabled', errors);

        try {
            await openFlagReadyApp(page);

            const state = await page.evaluate(async () => {
                const originalFirestore = window.firebase.firestore;
                const originalAuth = window.firebase.auth;
                const queryLog = [];

                const makeDocs = (start, count) => Array.from({ length: count }, (_, index) => {
                    const rank = start + index;
                    return {
                        id: `leader-${rank}`,
                        data: () => ({
                            displayName: `Leader ${rank}`,
                            totalPoints: 100 - rank,
                            totalVisited: rank,
                            hasVerified: rank === 1
                        })
                    };
                });

                const makeSnapshot = docs => ({
                    empty: docs.length === 0,
                    docs,
                    forEach(callback) {
                        docs.forEach(callback);
                    }
                });

                const pages = [
                    makeSnapshot(makeDocs(1, 5)),
                    makeSnapshot(makeDocs(6, 5))
                ];

                function makeQuery(startAfterDoc = null) {
                    return {
                        limit(limitValue) {
                            return {
                                get: async () => {
                                    queryLog.push({
                                        collection: 'leaderboard',
                                        orderBy: ['totalPoints', 'desc'],
                                        startAfter: startAfterDoc ? startAfterDoc.id : null,
                                        limit: limitValue
                                    });
                                    return pages.shift() || makeSnapshot([]);
                                }
                            };
                        },
                        startAfter(doc) {
                            return makeQuery(doc);
                        }
                    };
                }

                window.firebase.firestore = () => ({
                    collection: (name) => ({
                        orderBy: (field, direction) => {
                            if (name !== 'leaderboard' || field !== 'totalPoints' || direction !== 'desc') {
                                throw new Error(`Unexpected leaderboard query: ${name}.${field}.${direction}`);
                            }
                            return makeQuery();
                        }
                    })
                });
                window.firebase.auth = () => ({ currentUser: null });

                await window.BARK.loadLeaderboard();
                const loadMoreBefore = Boolean(document.getElementById('lb-load-more-btn'));
                document.getElementById('lb-load-more-btn').click();

                const startedAt = Date.now();
                while (
                    (queryLog.length < 2 || !document.getElementById('leaderboard-list').textContent.includes('Leader 10')) &&
                    Date.now() - startedAt < 1000
                ) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                const rows = Array.from(document.querySelectorAll('#leaderboard-list li'))
                    .map(row => row.textContent || '');

                window.firebase.firestore = originalFirestore;
                window.firebase.auth = originalAuth;

                return {
                    queryLog,
                    loadMoreBefore,
                    rows
                };
            });

            expect(state.loadMoreBefore).toBe(true);
            expect(state.queryLog.slice(0, 2)).toEqual([
                {
                    collection: 'leaderboard',
                    orderBy: ['totalPoints', 'desc'],
                    startAfter: null,
                    limit: 5
                },
                {
                    collection: 'leaderboard',
                    orderBy: ['totalPoints', 'desc'],
                    startAfter: 'leader-5',
                    limit: 5
                }
            ]);
            expect(state.rows.join(' ')).toContain('Leader 1');
            expect(state.rows.join(' ')).toContain('Leader 10');
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
