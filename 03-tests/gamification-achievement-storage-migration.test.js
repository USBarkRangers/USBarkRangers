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

test('a steady-state session reads nothing even while legacy dual-write is on', async () => {
    // The money test. Legacy subcollection support is still enabled (production
    // has not been promoted yet), but a migrated user with nothing new to record
    // must not touch the achievements subcollection at all.
    const earnedMs = new Date('2024-05-05T00:00:00Z').getTime();
    const stub = createFirestoreStub({
        subcollectionDocs: {
            bronzePaw: { achievementId: 'bronzePaw', tier: 'honor', dateEarned: null }
        }
    });
    const engine = new (loadEngine(stub.firebase))();
    assert.equal(engine.legacySubcollectionEnabled, true, 'dual-write must still be on for this test to mean anything');

    engine.primeAchievementsFromUserDoc('user-1', {
        achievements: {
            bronzePaw: { tier: 'honor', dateEarned: earnedMs },
            theLocalLegend: { tier: 'honor', dateEarned: earnedMs },
            marathoner: { tier: 'verified', dateEarned: earnedMs },
            'state-oh': { tier: 'honor', dateEarned: earnedMs }
        },
        achievementsSchema: 2
    });

    await engine.evaluateAndStoreAchievements('user-1', visits(12));
    await engine.evaluateAndStoreAchievements('user-1', visits(12));

    assert.equal(stub.stats.subcollectionReads, 0, 'steady-state sessions must cost zero achievement reads');
    assert.equal(stub.stats.committedBatches, 0, 'nothing changed, so nothing should be written');
});

test('an unrecorded unlock still verifies against legacy before stamping a date', async () => {
    // Same setup, except silverPaw was earned earlier by an old client and only
    // exists in the subcollection. The map has never seen it, so we must check
    // before deciding it is brand new.
    const earnedMs = new Date('2024-05-05T00:00:00Z').getTime();
    const legacyEarnedAt = new Date('2023-06-06T10:00:00Z');
    const stub = createFirestoreStub({
        subcollectionDocs: {
            silverPaw: { achievementId: 'silverPaw', tier: 'honor', dateEarned: { toDate: () => legacyEarnedAt } }
        }
    });
    const engine = new (loadEngine(stub.firebase))();

    engine.primeAchievementsFromUserDoc('user-1', {
        achievements: {
            bronzePaw: { tier: 'honor', dateEarned: earnedMs },
            theLocalLegend: { tier: 'honor', dateEarned: earnedMs },
            marathoner: { tier: 'verified', dateEarned: earnedMs },
            'state-oh': { tier: 'honor', dateEarned: earnedMs }
        },
        achievementsSchema: 2
    });

    // 25 visits crosses the Silver Paw threshold.
    const result = await engine.evaluateAndStoreAchievements('user-1', visits(25));

    assert.equal(stub.stats.subcollectionReads, 1, 'an unseen unlock must trigger exactly one verification read');
    const silver = result.paws.find(p => p.id === 'silverPaw');
    assert.equal(silver.dateEarnedTs, legacyEarnedAt.getTime(), 'the legacy earned date must win over today');
    assert.notEqual(silver.dateEarned, 'Just Now!', 'a badge earned long ago must not be labelled as new');
});

test('verification runs at most once per session', async () => {
    const stub = createFirestoreStub();
    const engine = new (loadEngine(stub.firebase))();
    engine.primeAchievementsFromUserDoc('user-1', { achievements: {}, achievementsSchema: 2 });

    await engine.evaluateAndStoreAchievements('user-1', visits(12));
    await engine.evaluateAndStoreAchievements('user-1', visits(25));
    await engine.evaluateAndStoreAchievements('user-1', visits(25));

    assert.equal(stub.stats.subcollectionReads, 1, 'legacy verification must not repeat within a session');
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

test('a completionist pays the legacy read once, then reloads all day for free', async () => {
    // The reload scenario. Users treat this like a website and reload ~10x a day.
    // Session 1 migrates them (one legacy read). Every reload after that must cost
    // zero, because achievementsSchema lands on the user document and the next page
    // load is primed straight off the snapshot the app already subscribes to.
    const earnedAt = new Date('2023-08-08T08:00:00Z');
    const everyBadge = {};
    ['bronzePaw', 'silverPaw', 'goldPaw', 'platinumPaw', 'obsidianPaw',
     'theExplorer', 'theLocalLegend', 'coastToCoast', 'fiftyStateClub',
     'alphaDog', 'nightRanger', 'earlyBird', 'marathoner', 'loneWolf', 'mapConqueror']
        .forEach(id => {
            everyBadge[id] = { achievementId: id, tier: 'verified', dateEarned: { toDate: () => earnedAt } };
        });

    const stub = createFirestoreStub({ subcollectionDocs: everyBadge });
    const Engine = loadEngine(stub.firebase);

    // --- Session 1: unmigrated. Pays the legacy read exactly once. ---
    const first = new Engine();
    await first.evaluateAndStoreAchievements('user-1', visits(30));

    assert.equal(stub.stats.subcollectionReads, 1, 'migration should read the subcollection once');
    const migrationWrite = findUserDocWrite(stub.stats);
    assert.ok(migrationWrite, 'migration must persist the map');
    assert.equal(migrationWrite.payload.achievementsSchema, 2, 'schema marker must be written or reloads re-migrate');

    // The user document now looks like this to every future page load.
    const migratedUserDoc = {
        achievements: migrationWrite.payload.achievements,
        achievementsSchema: migrationWrite.payload.achievementsSchema
    };

    const readsAfterMigration = stub.stats.subcollectionReads;

    // --- Sessions 2..11: ten reloads. Each is a fresh engine, like a new page load. ---
    for (let reload = 0; reload < 10; reload += 1) {
        const reloaded = new Engine();
        reloaded.primeAchievementsFromUserDoc('user-1', migratedUserDoc);
        await reloaded.evaluateAndStoreAchievements('user-1', visits(30));
    }

    assert.equal(
        stub.stats.subcollectionReads,
        readsAfterMigration,
        'ten reloads after migration must cost zero additional achievement reads'
    );
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
