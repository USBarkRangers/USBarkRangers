const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.NODE_ENV = "test";

const {
    __test: {
        calculateServerLeaderboardScore,
        handleSyncLeaderboardScore
    }
} = require("../index.js");

function authedContext(uid = "user-a", token = {}) {
    return { auth: { uid, token } };
}

function getHttpsErrorCode(error) {
    return String(error && error.code ? error.code : "").replace(/^functions\//, "");
}

async function assertRejectsCode(promise, code) {
    await assert.rejects(
        promise,
        (error) => getHttpsErrorCode(error) === code
    );
}

function makeFirestore({ userData = {}, userExists = true } = {}) {
    const writes = [];

    function makeDocRef(collectionName, docId) {
        return {
            path: `${collectionName}/${docId}`,
            async get() {
                if (collectionName === "users") {
                    return {
                        exists: userExists,
                        data: () => ({ ...userData })
                    };
                }

                return {
                    exists: false,
                    data: () => ({})
                };
            },
            async set(value, options = {}) {
                writes.push({
                    path: `${collectionName}/${docId}`,
                    value,
                    options
                });
            }
        };
    }

    return {
        writes,
        collection(collectionName) {
            return {
                doc(docId) {
                    return makeDocRef(collectionName, docId);
                }
            };
        },
        async runTransaction(callback) {
            return callback({
                get(ref) {
                    return ref.get();
                },
                set(ref, value, options) {
                    return ref.set(value, options);
                }
            });
        }
    };
}

describe("server-authoritative leaderboard sync", () => {
    it("calculates leaderboard scores from user data, not caller-provided totals", () => {
        const score = calculateServerLeaderboardScore({
            totalPoints: 999999,
            visitedPlaces: [
                { id: "park-a", verified: false },
                { id: "park-a", verified: true },
                { id: "park-b", verified: false }
            ],
            walkPoints: 4.95
        });

        assert.deepEqual(score, {
            totalPoints: 7,
            totalVisited: 2,
            verifiedCount: 1,
            walkPoints: 4,
            hasVerified: true
        });
    });

    it("collapses legacy/current duplicate physical visits without consulting current spreadsheet data", () => {
        const score = calculateServerLeaderboardScore({
            visitedPlaces: [
                {
                    id: "legacy-headwaters",
                    name: "Headwaters Forest Reserve",
                    lat: 40.6327009,
                    lng: -124.0651375,
                    verified: false
                },
                {
                    id: "current-headwaters",
                    name: "Headwaters Forest Reserve  ",
                    lat: 40.6327009,
                    lng: -124.0651375,
                    verified: true
                },
                {
                    id: "removed-from-sheet",
                    name: "Removed But Earned Site",
                    lat: 30.123456,
                    lng: -81.123456,
                    verified: false
                }
            ],
            walkPoints: 0
        });

        assert.deepEqual(score, {
            totalPoints: 3,
            totalVisited: 2,
            verifiedCount: 1,
            walkPoints: 0,
            hasVerified: true
        });
    });

    it("rejects unauthenticated leaderboard sync requests", async () => {
        await assertRejectsCode(
            handleSyncLeaderboardScore({}, {}, { firestore: makeFirestore() }),
            "unauthenticated"
        );
    });

    it("lets an authenticated user sync a legitimate server-calculated leaderboard score", async () => {
        const firestore = makeFirestore({
            userData: {
                displayName: "Alice Ranger",
                photoURL: "https://example.test/alice.png",
                visitedPlaces: [
                    { id: "park-a", verified: true },
                    { id: "park-b", verified: false }
                ],
                walkPoints: 3
            }
        });

        const result = await handleSyncLeaderboardScore(
            {},
            authedContext("alice"),
            { firestore }
        );

        assert.deepEqual(result, {
            totalPoints: 6,
            totalVisited: 2,
            hasVerified: true
        });

        const userWrite = firestore.writes.find(write => write.path === "users/alice");
        const leaderboardWrite = firestore.writes.find(write => write.path === "leaderboard/alice");

        assert.ok(userWrite, "expected mirrored score write to users/alice");
        assert.ok(leaderboardWrite, "expected leaderboard write to leaderboard/alice");
        assert.equal(userWrite.options.merge, true);
        assert.equal(leaderboardWrite.options.merge, true);
        assert.equal(userWrite.value.totalPoints, 6);
        assert.equal(userWrite.value.totalVisited, 2);
        assert.equal(leaderboardWrite.value.displayName, "Alice Ranger");
        assert.equal(leaderboardWrite.value.totalPoints, 6);
        assert.equal(leaderboardWrite.value.totalVisited, 2);
        assert.equal(leaderboardWrite.value.hasVerified, true);
    });

    it("ignores fake client-provided totalPoints in the callable payload", async () => {
        const firestore = makeFirestore({
            userData: {
                visitedPlaces: [{ id: "park-a", verified: false }],
                walkPoints: 0,
                totalPoints: 999999
            }
        });

        const result = await handleSyncLeaderboardScore(
            { totalPoints: 999999, totalVisited: 999999, hasVerified: true },
            authedContext("alice", { name: "Alice From Token" }),
            { firestore }
        );

        assert.deepEqual(result, {
            totalPoints: 1,
            totalVisited: 1,
            hasVerified: false
        });

        const leaderboardWrite = firestore.writes.find(write => write.path === "leaderboard/alice");
        assert.equal(leaderboardWrite.value.displayName, "Alice From Token");
        assert.equal(leaderboardWrite.value.totalPoints, 1);
        assert.equal(leaderboardWrite.value.totalVisited, 1);
        assert.equal(leaderboardWrite.value.hasVerified, false);
    });
});
