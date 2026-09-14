'use strict';

// Measurement only: run the unchanged native read service against an isolated
// synthetic namespace. No Auth users, deployed code, rules or public rankings change.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { benchmarkClient, nativeRequire } = require('./native-benchmark-client.cjs');
const { FieldPath } = nativeRequire('firebase-admin/firestore');
const { createReadService } = require('../../01-code/functions-native/reads/service');
const { publicEntryID } = require('../../01-code/functions-native/profile/commands');
const { meter } = require('../../01-code/functions-native/tests/support/meter.cjs');

async function main() {
    const client = await benchmarkClient(process.argv.slice(2));
    const { db, cloud, project } = client;
    const runID = `leaderboard-${randomUUID()}`;
    const root = db.collection('nativeBenchmarks').doc(runID);
    const board = root.collection('leaderboard'), users = root.collection('users');
    const uidAt = index => `${runID}-${index}`;
    const kind = 'isolated-native-leaderboard-measurement';
    const reports = [];
    let seeded = 0, cleanup = false;
    const limitedWriter = () => {
        const writer = db.bulkWriter({ throttling: { initialOpsPerSecond: cloud ? 500 : 2000,
            maxOpsPerSecond: cloud ? 500 : 2000 } });
        writer.onWriteError(error => error.failedAttempts < 3 && [8, 10, 14].includes(error.code));
        return writer;
    };
    console.log(JSON.stringify({ event: 'started', project, path: root.path, maximumEntries: 100_000,
        cloudWritesPerSecond: cloud ? 500 : null, callableInvocations: 0 }));
    try {
        await root.create({ kind, runID, startedAtMs: Date.now() });
        // Fixed mapping: every path the real handler can select stays under this
        // marker. There is no path parameter accepted from a benchmark caller.
        const scoped = { collection(name) {
            assert(['users', 'leaderboard'].includes(name)); return root.collection(name);
        }, getAll: (...refs) => db.getAll(...refs), runTransaction: (work, options) => db.runTransaction(work, options) };
        const measured = meter(scoped), read = createReadService(measured.db);
        const profile = index => users.doc(uidAt(index)).set({ schemaVersion: 1, revision: 1, status: 'active' });
        const totals = () => {
            const counts = measured.events.filter(e => e.type === 'aggregation');
            return { ...measured.totals(), countQueries: counts.length,
                matchedEntries: counts.reduce((n, e) => n + e.count, 0) };
        };
        async function sample(index, warm) {
            const uid = uidAt(index);
            if (!warm) await users.doc(uid).collection('leaderboardCache').doc('standing').delete();
            measured.reset(); const start = performance.now();
            const result = await read(uid, { kind: 'leaderboard', query: { version: 1 } });
            const milliseconds = performance.now() - start;
            assert.equal(result.entries.length, 5); assert.equal(result.standingUnavailable, false);
            assert.equal(result.standing.rank, index + 1);
            return { milliseconds, ...totals(), responseBytes: Buffer.byteLength(JSON.stringify(result)) };
        }
        for (const size of [1000, 10_000, 100_000]) {
            const seedStart = performance.now(), writer = limitedWriter();
            try {
                while (seeded < size) {
                    const end = Math.min(size, seeded + 500);
                    await Promise.all(Array.from({ length: end - seeded }, (_, offset) => {
                        const index = seeded + offset;
                        return writer.create(board.doc(publicEntryID(uidAt(index))), {
                            schemaVersion: 1, displayName: `Synthetic Ranger ${index}`, totalPoints: 100_000 - index,
                            totalVisited: 0, hasVerified: false,
                        });
                    }));
                    seeded = end;
                    if (seeded % 10_000 === 0) console.log(JSON.stringify({ event: 'seed-progress', seeded }));
                }
            } finally { await writer.close(); }
            const row = { size, seedMilliseconds: performance.now() - seedStart, cases: [] };
            for (const [name, index] of [['top-five', 0], ['rank-652', 651], ['bottom', size - 1]]) {
                await profile(index);
                // Fixture reset only: each size starts a separate six-request
                // trial, even when emulator seeding finishes within one minute.
                await users.doc(uidAt(index)).collection('readLimits').doc('leaderboard').delete();
                // Six calls fit the production 12/minute admission limit. The first
                // ever call includes SDK/channel setup; do not label it CF cold start.
                const samples = [];
                for (let repeat = 0; repeat < 3; repeat++) {
                    samples.push({ warm: false, ...await sample(index, false) });
                    samples.push({ warm: true, ...await sample(index, true) });
                }
                let explain = null;
                if (cloud) {
                    const query = index === 0 ? board.orderBy('totalPoints', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(5)
                        : board.where('totalPoints', '>', 100_000 - index).count();
                    explain = (await query.explain({ analyze: true })).metrics;
                }
                row.cases.push({ name, rank: index + 1, samples, explain });
            }
            if (size === 100_000) {
                const indices = Array.from({ length: 20 }, (_, i) => 90_000 + i);
                await Promise.all(indices.map(profile));
                measured.reset(); const start = performance.now();
                const results = await Promise.all(indices.map(async index => {
                    const began = performance.now();
                    const result = await read(uidAt(index), { kind: 'leaderboard', query: { version: 1 } });
                    assert.equal(result.standingUnavailable, false); assert.equal(result.standing.rank, index + 1);
                    return performance.now() - began;
                }));
                row.concurrent = { independentAccounts: 20, milliseconds: performance.now() - start,
                    requestMilliseconds: results, ...totals() };
            }
            reports.push(row);
            console.log(JSON.stringify({ event: 'measurement', environment: cloud ? 'native-cloud' : 'emulator', ...row }));
        }
    } finally {
        // Exact marker validation prevents a typo or stale namespace from deleting
        // anything outside this synthetic run. Pending/error runs are cleaned too.
        try {
            const marker = await root.get();
            assert.equal(root.parent.path, 'nativeBenchmarks');
            if (marker.exists) {
                assert.equal(marker.data().kind, kind); assert.equal(marker.data().runID, runID);
                console.log(JSON.stringify({ event: 'cleanup-start', path: root.path, seeded }));
                const writer = limitedWriter();
                try { await db.recursiveDelete(root, writer); } finally { await writer.close(); }
            }
            assert.equal((await root.get()).exists, false);
            assert.equal((await board.limit(1).get()).empty, true);
            assert.equal((await users.limit(1).get()).empty, true);
            cleanup = true;
            console.log(JSON.stringify({ event: 'cleanup-complete', project, path: root.path, seeded }));
        } finally { await client.close(); }
    }
    console.log(JSON.stringify({ event: 'complete', project, sizes: reports.map(r => r.size), cleanup }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
