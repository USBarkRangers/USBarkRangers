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
                        mysteryFeats: [],
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
    vm.runInContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'modules', 'profileEngine.js'), 'utf8'), sandbox);

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

    harness.sandbox.window._lastSyncedScore = -1;
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
    assert.equal(harness.sandbox.window._lastSyncedScore, 7);
});

test('profile leaderboard sync corrects zero scores instead of treating default zero as synced', async () => {
    const harness = loadProfileEngineHarness();
    const callableCalls = [];

    harness.sandbox.window._lastSyncedScore = 0;
    harness.sandbox.window._lastSyncedLeaderboardFingerprint = null;
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
    assert.equal(harness.sandbox.window._lastSyncedScore, 0);
    assert.equal(
        harness.sandbox.window._lastSyncedLeaderboardFingerprint,
        JSON.stringify({ totalPoints: 0, totalVisited: 0, hasVerified: false })
    );
});

test('profile leaderboard sync retries after visitedPlaces writes settle before reading server score', async () => {
    const harness = loadProfileEngineHarness();
    const callableCalls = [];
    let writeInFlight = true;

    harness.sandbox.window._lastSyncedScore = 5;
    harness.sandbox.window._lastSyncedLeaderboardFingerprint = JSON.stringify({
        totalPoints: 5,
        totalVisited: 5,
        hasVerified: false
    });
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
    assert.equal(harness.sandbox.window._lastSyncedScore, 4);
});
