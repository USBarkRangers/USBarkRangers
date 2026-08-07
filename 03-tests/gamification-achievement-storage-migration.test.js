const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

const SERVER_TIMESTAMP = { __sentinel: 'serverTimestamp' };

// Minimal Firestore stand-in that records every read and write so the tests can
// assert on Firestore cost, not just on returned data.
function createFirestoreStub({ subcollectionDocs = {}, userDoc = {} } = {}) {
    const stats = { subcollectionReads: 0, committedBatches: 0, writes: [] };

    const achievementsRef = {
        get() {
            stats.subcollectionReads += 1;
            const docs = Object.keys(subcollectionDocs).map(id => ({
                id,
                data: () => subcollectionDocs[id]
            }));
            return Promise.resolve({ forEach: cb => docs.forEach(cb) });
        },
        doc(id) {
            return { __kind: 'achievementDoc', id };
        }
    };

    const userRef = {
        __kind: 'userDoc',
        collection(name) {
            assert.equal(name, 'achievements');
            return achievementsRef;
        }
    };

    const firestore = () => ({
        collection(name) {
            assert.equal(name, 'users');
            return { doc: () => userRef };
        },
        batch() {
            const queued = [];
            return {
                set(ref, payload, options) {
                    queued.push({ ref, payload, options });
                    return this;
                },
                commit() {
                    stats.committedBatches += 1;
                    queued.forEach(entry => stats.writes.push(entry));
                    return Promise.resolve();
                }
            };
        }
    });

    firestore.FieldValue = { serverTimestamp: () => SERVER_TIMESTAMP };

    return { stats, firebase: { firestore }, userDoc };
}

function loadEngine(firebaseStub) {
    const sandbox = {
        console: { ...console, warn() {}, error() {} },
        Date,
        Set,
        Number,
        Object,
        firebase: firebaseStub,
        window: {
            BARK: {
                debugDataRefresh: false,
                calculateVisitScore(visits, walkPoints = 0) {
                    return { totalScore: visits.length + walkPoints };
                },
                repos: { ParkRepo: { getById: () => null } }
            }
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'gamificationLogic.js'), 'utf8'), sandbox);
    return sandbox.window.GamificationEngine;
}

// 12 visits unlocks Bronze Paw (10) but not Silver (25).
function visits(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: `park-${i}`,
        name: `Park ${i}`,
        state: 'Ohio',
        lat: 40 + i / 1000,
        lng: -82 - i / 1000,
        ts: 1700000000000 + i,
        verified: false
    }));
}

function findUserDocWrite(stats) {
    return stats.writes.find(entry => entry.ref && entry.ref.__kind === 'userDoc');
}

test('existing subcollection users are backfilled onto the user document map', async () => {
    const earnedAt = new Date('2024-03-01T12:00:00Z');
    const stub = createFirestoreStub({
        subcollectionDocs: {
            bronzePaw: { achievementId: 'bronzePaw', tier: 'honor', dateEarned: { toDate: () => earnedAt } }
        }
    });
    const engine = new (loadEngine(stub.firebase))();

    const result = await engine.evaluateAndStoreAchievements('user-1', visits(12));

    const userWrite = findUserDocWrite(stub.stats);
    assert.ok(userWrite, 'expected a user document write carrying the achievements map');
    assert.equal(userWrite.payload.achievementsSchema, 2);
    assert.equal(userWrite.payload.achievements.bronzePaw.tier, 'honor');
    assert.equal(userWrite.options.merge, true);

    // The original earned date must survive the migration, not reset to today.
    const bronze = result.paws.find(p => p.id === 'bronzePaw');
    assert.equal(bronze.dateEarnedTs, earnedAt.getTime());
});

test('a primed user document map serves the vault without reading the subcollection', async () => {
    const earnedMs = new Date('2024-05-05T00:00:00Z').getTime();
    const stub = createFirestoreStub();
    const Engine = loadEngine(stub.firebase);
    // legacySubcollectionEnabled:false is the post-migration flip.
    const engine = new Engine({ legacySubcollectionEnabled: false });

    // 12 Ohio visits unlock bronzePaw, theLocalLegend, marathoner and state-oh.
    // Prime all of them so this session has genuinely nothing new to record.
    engine.primeAchievementsFromUserDoc('user-1', {
        achievements: {
            bronzePaw: { tier: 'honor', dateEarned: earnedMs },
            theLocalLegend: { tier: 'honor', dateEarned: earnedMs },
            // marathoner's verified condition equals its unlock condition, so it
            // is always earned at the verified tier.
            marathoner: { tier: 'verified', dateEarned: earnedMs },
            'state-oh': { tier: 'honor', dateEarned: earnedMs }
        },
        achievementsSchema: 2
    });

    const result = await engine.evaluateAndStoreAchievements('user-1', visits(12));

    assert.equal(stub.stats.subcollectionReads, 0, 'migrated users must cost zero subcollection reads');
    assert.equal(stub.stats.committedBatches, 0, 'nothing changed, so nothing should be written');
    assert.equal(result.paws.find(p => p.id === 'bronzePaw').dateEarnedTs, earnedMs);
});

test('an achievement earned by a legacy client keeps its original date', async () => {
    // The dangerous ordering: user doc map says "earned today", the legacy
    // subcollection holds the real, earlier date written by an old client.
    const realEarnedAt = new Date('2023-01-15T09:30:00Z');
    const stub = createFirestoreStub({
        subcollectionDocs: {
            bronzePaw: { achievementId: 'bronzePaw', tier: 'honor', dateEarned: { toDate: () => realEarnedAt } }
        }
    });
    const engine = new (loadEngine(stub.firebase))();

    engine.primeAchievementsFromUserDoc('user-1', {
        achievements: { bronzePaw: { tier: 'honor', dateEarned: Date.now() } },
        achievementsSchema: 2
    });

    const result = await engine.evaluateAndStoreAchievements('user-1', visits(12));

    assert.equal(stub.stats.subcollectionReads, 1, 'legacy clients still live means the subcollection is still read');
    assert.equal(result.paws.find(p => p.id === 'bronzePaw').dateEarnedTs, realEarnedAt.getTime());
});

test('honor to verified upgrade writes the new tier but preserves the earned date', async () => {
    const earnedAt = new Date('2024-02-02T08:00:00Z');
    const stub = createFirestoreStub({
        subcollectionDocs: {
            bronzePaw: { achievementId: 'bronzePaw', tier: 'honor', dateEarned: { toDate: () => earnedAt } }
        }
    });
    const engine = new (loadEngine(stub.firebase))();

    const verifiedVisits = visits(12).map(v => ({ ...v, verified: true }));
    const result = await engine.evaluateAndStoreAchievements('user-1', verifiedVisits);

    const bronze = result.paws.find(p => p.id === 'bronzePaw');
    assert.equal(bronze.tier, 'verified');
    assert.equal(bronze.dateEarnedTs, earnedAt.getTime(), 'an upgrade must not reset the earned date');

    const userWrite = findUserDocWrite(stub.stats);
    assert.equal(userWrite.payload.achievements.bronzePaw.tier, 'verified');
    assert.notEqual(userWrite.payload.achievements.bronzePaw.dateEarned, SERVER_TIMESTAMP);
});

test('a newly earned achievement is written once and not rewritten on re-evaluation', async () => {
    const stub = createFirestoreStub();
    const engine = new (loadEngine(stub.firebase))();
    engine.primeAchievementsFromUserDoc('user-1', { achievements: {}, achievementsSchema: 2 });

    const first = await engine.evaluateAndStoreAchievements('user-1', visits(12));
    assert.equal(first.paws.find(p => p.id === 'bronzePaw').dateEarned, 'Just Now!');
    assert.equal(stub.stats.committedBatches, 1);

    const batchesAfterFirst = stub.stats.committedBatches;
    await engine.evaluateAndStoreAchievements('user-1', visits(12));
    assert.equal(stub.stats.committedBatches, batchesAfterFirst, 'unchanged achievements must not write again');
});

test('the session cache means repeat evaluations never re-read Firestore', async () => {
    const stub = createFirestoreStub({
        subcollectionDocs: { bronzePaw: { achievementId: 'bronzePaw', tier: 'honor', dateEarned: null } }
    });
    const engine = new (loadEngine(stub.firebase))();

    await engine.evaluateAndStoreAchievements('user-1', visits(12));
    await engine.evaluateAndStoreAchievements('user-1', visits(12));
    await engine.evaluateAndStoreAchievements('user-1', visits(12));

    assert.equal(stub.stats.subcollectionReads, 1, 'the subcollection must be read at most once per session');
});

test('backfill never writes an undefined date, which Firestore would reject', async () => {
    // A legacy document whose serverTimestamp was still pending reads back as null.
    const stub = createFirestoreStub({
        subcollectionDocs: {
            bronzePaw: { achievementId: 'bronzePaw', tier: 'honor', dateEarned: null },
            theLocalLegend: { achievementId: 'theLocalLegend', tier: 'honor' }
        }
    });
    const engine = new (loadEngine(stub.firebase))();

    await engine.evaluateAndStoreAchievements('user-1', visits(12));

    const userWrite = findUserDocWrite(stub.stats);
    assert.ok(userWrite, 'expected a backfill write');
    for (const [id, record] of Object.entries(userWrite.payload.achievements)) {
        assert.notEqual(record.dateEarned, undefined, `${id} wrote an undefined dateEarned`);
        assert.ok(record.tier, `${id} wrote an empty tier`);
    }
});

test('priming a different user clears the previous user cached achievements', async () => {
    const stub = createFirestoreStub();
    const engine = new (loadEngine(stub.firebase))({ legacySubcollectionEnabled: false });

    engine.primeAchievementsFromUserDoc('user-1', {
        achievements: { bronzePaw: { tier: 'verified', dateEarned: 111 } },
        achievementsSchema: 2
    });
    await engine.evaluateAndStoreAchievements('user-1', visits(12));

    engine.primeAchievementsFromUserDoc('user-2', { achievements: {}, achievementsSchema: 2 });
    assert.equal(engine.achievementsCache, null, 'switching users must drop the prior cache');

    const second = await engine.evaluateAndStoreAchievements('user-2', visits(12));
    assert.notEqual(second.paws.find(p => p.id === 'bronzePaw').dateEarnedTs, 111);
});

test('a failed legacy read falls back to the map instead of resetting earned dates', async () => {
    const stub = createFirestoreStub();
    stub.firebase.firestore().collection('users').doc().collection('achievements');
    const Engine = loadEngine(stub.firebase);
    const engine = new Engine();

    // Force the legacy read to fail.
    const originalFirestore = stub.firebase.firestore;
    stub.firebase.firestore = () => {
        const db = originalFirestore();
        const realCollection = db.collection;
        db.collection = (name) => {
            const users = realCollection.call(db, name);
            return {
                doc: () => {
                    const userRef = users.doc();
                    return {
                        __kind: 'userDoc',
                        collection: () => ({
                            get: () => Promise.reject(new Error('permission denied')),
                            doc: (id) => ({ __kind: 'achievementDoc', id })
                        })
                    };
                }
            };
        };
        return db;
    };

    engine.primeAchievementsFromUserDoc('user-1', {
        achievements: { bronzePaw: { tier: 'honor', dateEarned: 987654321 } },
        achievementsSchema: 2
    });

    const result = await engine.evaluateAndStoreAchievements('user-1', visits(12));
    assert.equal(result.paws.find(p => p.id === 'bronzePaw').dateEarnedTs, 987654321);
});
