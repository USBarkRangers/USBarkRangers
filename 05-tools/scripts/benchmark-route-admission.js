#!/usr/bin/env node

const admin = require('../../01-code/functions/node_modules/firebase-admin');
const {
    enforcePremiumCallableRateLimit,
    enforceBoundedCallableRateLimit,
    enforcePremiumCallableRateLimits
} = require('../../01-code/functions/rateLimits.js');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Run this benchmark through the Firestore emulator.');
}

if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-route-admission-benchmark' });
const firestore = admin.firestore();
const concurrencyLevels = [1, 5, 10, 25];
const rounds = 3;

const options = {
    firestore,
    premiumCallableRateLimits: {
        getPremiumRoute: { maxRequests: 100000, windowMs: 60 * 60 * 1000 }
    },
    callableRateLimits: {
        getPremiumRouteBurst: { shortMax: 100000, shortWindowMs: 10 * 60 * 1000 }
    }
};

function percentile(values, fraction) {
    if (!values.length) return 0;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

async function legacyAdmission(uid) {
    await enforcePremiumCallableRateLimit(uid, 'getPremiumRoute', options);
    await enforceBoundedCallableRateLimit(uid, 'getPremiumRouteBurst', options);
}

async function consolidatedAdmission(uid) {
    await enforcePremiumCallableRateLimits(uid, 'getPremiumRoute', options);
}

async function measure(label, concurrency, admission) {
    const durations = [];
    const wallDurations = [];
    const failures = [];
    for (let round = 0; round < rounds; round += 1) {
        const uid = `bench-${label}-${concurrency}-${round}-${Date.now()}`;
        if (label === 'consolidated') await admission(uid); // one-time legacy migration
        const wallStartedAt = process.hrtime.bigint();
        const settled = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
            const startedAt = process.hrtime.bigint();
            await admission(uid);
            durations.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
        }));
        settled.forEach(result => {
            if (result.status === 'rejected') {
                failures.push({
                    code: result.reason && result.reason.code,
                    message: result.reason && result.reason.message
                });
            }
        });
        wallDurations.push(Number(process.hrtime.bigint() - wallStartedAt) / 1e6);
    }
    return {
        label,
        concurrency,
        requests: durations.length,
        failures: failures.length,
        p50Ms: Math.round(percentile(durations, 0.50) * 10) / 10,
        p95Ms: Math.round(percentile(durations, 0.95) * 10) / 10,
        maxMs: durations.length ? Math.round(Math.max(...durations) * 10) / 10 : null,
        meanWallMs: Math.round((wallDurations.reduce((sum, value) => sum + value, 0) / wallDurations.length) * 10) / 10
    };
}

(async () => {
    const results = [];
    for (const concurrency of concurrencyLevels) {
        results.push(await measure('legacy', concurrency, legacyAdmission));
        results.push(await measure('consolidated', concurrency, consolidatedAdmission));
    }

    console.log('| Concurrent requests | Legacy p50 | Consolidated p50 | Legacy p95 | Consolidated p95 | p95 speedup | Legacy failures | Consolidated failures |');
    console.log('|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const concurrency of concurrencyLevels) {
        const legacy = results.find(item => item.label === 'legacy' && item.concurrency === concurrency);
        const consolidated = results.find(item => item.label === 'consolidated' && item.concurrency === concurrency);
        const speedup = consolidated.p95Ms > 0 ? Math.round((legacy.p95Ms / consolidated.p95Ms) * 100) / 100 : null;
        console.log(`| ${concurrency} | ${legacy.p50Ms} ms | ${consolidated.p50Ms} ms | ${legacy.p95Ms} ms | ${consolidated.p95Ms} ms | ${speedup}x | ${legacy.failures} | ${consolidated.failures} |`);
    }
    console.log('\nSteady-state Firestore admission operations per route: legacy 2 reads + 2 writes; consolidated 1 read + 1 write.');
    console.log(JSON.stringify(results));
    await admin.app().delete();
})().catch(async error => {
    console.error(error);
    if (admin.apps.length) await admin.app().delete();
    process.exit(1);
});
