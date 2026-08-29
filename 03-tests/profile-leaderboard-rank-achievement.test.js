const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function createElementStub() {
    return {
        textContent: '',
        style: {},
        classList: {
            add() {},
            remove() {}
        },
        appendChild() {},
        addEventListener() {}
    };
}

function loadProfileEngineHarness() {
    let receivedRank = undefined;
    const elements = new Map();
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        map: {
            getCenter() {
                return { lat: 39.8283, lng: -98.5795 };
            }
        },
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, createElementStub());
                return elements.get(id);
            },
            querySelectorAll() {
                return [];
            },
            createElement() {
                return createElementStub();
            }
        },
        window: {
            currentWalkPoints: 0,
            _lastKnownLeaderboardRank: null,
            BARK: {
                repos: {},
                services: {},
                leaderboardRenderer: {
                    getSafeLeaderboardRank(rank) {
                        const parsed = Number(rank);
                        return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : null;
                    },
                    formatLeaderboardRank(rank) {
                        return rank ? String(rank) : '--';
                    }
                },
                calculateVisitScore() {
                    return {
                        totalScore: 0,
                        totalVisitedCount: 0,
                        verifiedCount: 0
                    };
                },
                getUserLocationMarker() {
                    return null;
                },
                safeUpdateHTML() {},
                incrementRequestCount() {}
            },
            gamificationEngine: {
                async evaluateAndStoreAchievements(userId, visits, userRank) {
                    receivedRank = userRank;
                    return {
                        title: 'B.A.R.K. Trainee',
                        totalScore: 0,
                        rareFeats: [],
                        paws: [],
                        stateBadges: [],
                        nationalProgress: {
                            percentComplete: 0,
                            totalVisited: 0,
                            totalParks: 1
                        }
                    };
                }
            }
        }
    };
    vm.createContext(sandbox);

    // Load in the same order index.html does. profileEngine registers the shared visit
    // helpers on window.BARK; leaderboardEngine reads them back through window.BARK.
    // Loading both here means these tests exercise the real cross-file wiring rather
    // than a single file in isolation.
    [
        'modules/achievementsPanel.js',
        'modules/profileEngine.js',
        'modules/leaderboardSyncPolicy.js',
        'modules/leaderboardEngine.js'
    ].forEach(relativePath => {
        vm.runInContext(
            fs.readFileSync(path.join(repoRoot, '01-code', 'app', ...relativePath.split('/')), 'utf8'),
            sandbox
        );
    });

    return {
        sandbox,
        getReceivedRank: () => receivedRank
    };
}

test('profile achievement evaluation passes the cached leaderboard rank', async () => {
    const harness = loadProfileEngineHarness();

    harness.sandbox.window.BARK.setCurrentLeaderboardRank(1);
    await harness.sandbox.window.BARK.evaluateAchievements([]);

    assert.equal(harness.getReceivedRank(), 1);
});

test('profile leaderboard sync uses the server callable instead of direct Firestore writes', async () => {
    const harness = loadProfileEngineHarness();
    const callableCalls = [];

    harness.sandbox.window.BARK.resetLeaderboardState();
    harness.sandbox.window.currentWalkPoints = 4;
    harness.sandbox.window.BARK.repos.VaultRepo = {
        getVisits() {
            return [
                { id: 'park-a', verified: true },
                { id: 'park-b', verified: false }
            ];
        }
    };
    harness.sandbox.window.BARK.calculateVisitScore = () => ({
        totalScore: 7,
        totalVisitedCount: 2,
        verifiedCount: 1
    });

    harness.sandbox.firebase = {
        auth() {
            return {
                currentUser: {
                    uid: 'alice',
                    displayName: 'Alice Ranger',
                    photoURL: ''
                }
            };
        },
        functions() {
            return {
                httpsCallable(name) {
                    return async (payload) => {
                        callableCalls.push({ name, payload });
                        return {
                            data: {
                                totalPoints: 7,
                                totalVisited: 2,
                                hasVerified: true
                            }
                        };
                    };
                }
            };
        },
        firestore() {
            throw new Error('profileEngine should not write leaderboard scores directly through Firestore');
        }
    };

    await harness.sandbox.window.BARK.syncScoreToLeaderboard();

    assert.equal(callableCalls.length, 1);
    assert.equal(callableCalls[0].name, 'syncLeaderboardScore');
    assert.equal(harness.sandbox.window.BARK.getLeaderboardSyncState().lastSyncedScore, 7);
});

test('profile leaderboard sync corrects zero scores instead of treating default zero as synced', async () => {
    const harness = loadProfileEngineHarness();
    const callableCalls = [];

    harness.sandbox.window.BARK.resetLeaderboardState();
    harness.sandbox.window.currentWalkPoints = 0;
    harness.sandbox.window.BARK.repos.VaultRepo = {
        getVisits() {
            return [];
        }
    };
    harness.sandbox.window.BARK.calculateVisitScore = () => ({
        totalScore: 0,
        totalVisitedCount: 0,
        verifiedCount: 0
    });

    harness.sandbox.firebase = {
        auth() {
            return {
                currentUser: {
                    uid: 'zero-user',
                    displayName: 'Zero Ranger',
                    photoURL: ''
                }
            };
        },
        functions() {
            return {
                httpsCallable(name) {
                    return async () => {
                        callableCalls.push(name);
                        return {
                            data: {
                                totalPoints: 0,
                                totalVisited: 0,
                                hasVerified: false
                            }
                        };
                    };
                }
            };
        }
    };

    await harness.sandbox.window.BARK.syncScoreToLeaderboard();

    assert.deepEqual(callableCalls, ['syncLeaderboardScore']);
    assert.equal(harness.sandbox.window.BARK.getLeaderboardSyncState().lastSyncedScore, 0);
    assert.equal(
        harness.sandbox.window.BARK.getLeaderboardSyncState().lastSyncedFingerprint,
        JSON.stringify({ totalPoints: 0, totalVisited: 0, hasVerified: false })
    );
});

test('profile leaderboard sync retries after visitedPlaces writes settle before reading server score', async () => {
    const harness = loadProfileEngineHarness();
    const callableCalls = [];
    let writeInFlight = true;

    harness.sandbox.window.BARK.resetLeaderboardState();
    harness.sandbox.window.BARK.services.firebase = {
        hasVisitedPlacesWriteInFlight() {
            return writeInFlight;
        }
    };
    harness.sandbox.window.BARK.repos.VaultRepo = {
        getVisits() {
            return [
                { id: 'park-a', verified: false },
                { id: 'park-b', verified: false },
                { id: 'park-c', verified: false },
                { id: 'park-d', verified: false }
            ];
        }
    };
    harness.sandbox.window.BARK.calculateVisitScore = () => ({
        totalScore: 4,
        totalVisitedCount: 4,
        verifiedCount: 0
    });

    harness.sandbox.firebase = {
        auth() {
            return {
                currentUser: {
                    uid: 'removal-user',
                    displayName: 'Removal Ranger',
                    photoURL: ''
                }
            };
        },
        functions() {
            return {
                httpsCallable(name) {
                    return async () => {
                        callableCalls.push(name);
                        return {
                            data: {
                                totalPoints: 4,
                                totalVisited: 4,
                                hasVerified: false
                            }
                        };
                    };
                }
            };
        }
    };

    await harness.sandbox.window.BARK.syncScoreToLeaderboard();
    assert.deepEqual(callableCalls, []);

    writeInFlight = false;
    await new Promise(resolve => setTimeout(resolve, 300));

    assert.deepEqual(callableCalls, ['syncLeaderboardScore']);
    assert.equal(harness.sandbox.window.BARK.getLeaderboardSyncState().lastSyncedScore, 4);
});

test('adaptive leaderboard sync combines rapid distinct park additions into one callable', async () => {
    const harness = loadProfileEngineHarness();
    const callableCalls = [];
    let visitCount = 0;

    const createPolicy = harness.sandbox.window.BARK.createLeaderboardSyncPolicy;
    harness.sandbox.window.BARK.createLeaderboardSyncPolicy = () => createPolicy({
        quietMs: 15,
        bulkThreshold: 5,
        bulkWindowMs: 300,
        bulkIntervalMs: 180
    });
    harness.sandbox.window.BARK.resetLeaderboardState();
    harness.sandbox.window.BARK.repos.VaultRepo = {
        getVisits() {
            return Array.from({ length: visitCount }, (_value, index) => ({ id: `park-${index}`, verified: false }));
        }
    };
    harness.sandbox.window.BARK.calculateVisitScore = visits => ({
        totalScore: visits.length,
        totalVisitedCount: visits.length,
        verifiedCount: 0
    });
    harness.sandbox.firebase = {
        auth() {
            return { currentUser: { uid: 'bulk-user', displayName: 'Bulk Ranger', photoURL: '' } };
        },
        functions() {
            return {
                httpsCallable() {
                    return async () => {
                        callableCalls.push(visitCount);
                        return { data: { totalPoints: visitCount, totalVisited: visitCount, hasVerified: false } };
                    };
                }
            };
        }
    };

    for (visitCount = 1; visitCount <= 4; visitCount++) {
        await harness.sandbox.window.BARK.syncScoreToLeaderboard({ adaptive: true, reason: 'test-park-add' });
    }
    visitCount = 4;
    await new Promise(resolve => setTimeout(resolve, 35));

    assert.deepEqual(callableCalls, [4]);
    assert.equal(harness.sandbox.window.BARK.getLeaderboardSyncState().lastSyncedScore, 4);
});

test('leaderboard rate limits schedule one automatic retry at the server reset', async () => {
    const harness = loadProfileEngineHarness();
    const retryAtMs = Date.now() + 60_000;
    let visitCount = 1;
    let callableAttempts = 0;

    harness.sandbox.window.BARK.resetLeaderboardState();
    harness.sandbox.window.BARK.repos.VaultRepo = {
        getVisits() {
            return Array.from({ length: visitCount }, (_value, index) => ({
                id: `park-${index}`,
                verified: false
            }));
        }
    };
    harness.sandbox.window.BARK.calculateVisitScore = visits => ({
        totalScore: visits.length,
        totalVisitedCount: visits.length,
        verifiedCount: 0
    });
    harness.sandbox.window.BARK.rateLimitUi = {
        isRateLimitError(error) { return error && error.code === 'functions/resource-exhausted'; },
        showRateLimitWarning() { return true; }
    };
    harness.sandbox.firebase = {
        auth() { return { currentUser: { uid: 'limited-user', displayName: 'Limited Ranger', photoURL: '' } }; },
        functions() {
            return {
                httpsCallable() {
                    return async () => {
                        callableAttempts += 1;
                        const error = new Error('limited');
                        error.code = 'functions/resource-exhausted';
                        error.details = {
                            action: 'syncLeaderboardScore',
                            scope: 'user',
                            retryAt: new Date(retryAtMs).toISOString(),
                            retryAfterSeconds: 60
                        };
                        throw error;
                    };
                }
            };
        }
    };

    await harness.sandbox.window.BARK.syncScoreToLeaderboard();
    const state = harness.sandbox.window.BARK.getLeaderboardSyncState();
    assert.ok(state.adaptiveDueAt >= retryAtMs);
    assert.ok(state.adaptiveDueAt < retryAtMs + 15_000);
    assert.equal(state.rateLimitedUntil, state.adaptiveDueAt);
    assert.equal(callableAttempts, 1);

    // More park saves while limited must keep the one reset-time retry instead
    // of hammering the callable or replacing it with a ten-second timer.
    visitCount = 2;
    await harness.sandbox.window.BARK.syncScoreToLeaderboard({ adaptive: true, reason: 'new-park-while-limited' });
    const afterNewPark = harness.sandbox.window.BARK.getLeaderboardSyncState();
    assert.ok(afterNewPark.adaptiveDueAt >= retryAtMs);
    assert.equal(callableAttempts, 1);

    harness.sandbox.window.BARK.resetLeaderboardState();
    assert.equal(harness.sandbox.window.BARK.getLeaderboardSyncState().adaptiveDueAt, null);
});
