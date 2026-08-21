const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildRouteCacheKey,
    createRouteCache
} = require('../01-code/app/services/orsRouteCache.js');

test('identical route requests share one in-flight load and one cached result', async () => {
    let loads = 0;
    const cache = createRouteCache();
    const key = buildRouteCacheKey({
        uid: 'premium-user',
        coordinates: [[-86.3, 46.5], [-86.6, 46.4]],
        radiuses: [-1, -1]
    });
    const loader = async () => {
        loads += 1;
        return { route: loads };
    };

    const [first, concurrent] = await Promise.all([
        cache.getOrLoad(key, loader),
        cache.getOrLoad(key, loader)
    ]);
    const cached = await cache.getOrLoad(key, loader);

    assert.equal(loads, 1);
    assert.deepEqual(first, { route: 1 });
    assert.deepEqual(concurrent, first);
    assert.deepEqual(cached, first);
});

test('route cache separates users and changed route points', () => {
    const base = {
        uid: 'first-user',
        coordinates: [[-86.3, 46.5], [-86.6, 46.4]],
        radiuses: [-1, -1]
    };

    assert.notEqual(
        buildRouteCacheKey(base),
        buildRouteCacheKey({ ...base, uid: 'second-user' })
    );
    assert.notEqual(
        buildRouteCacheKey(base),
        buildRouteCacheKey({ ...base, coordinates: [[-86.3, 46.5], [-86.7, 46.4]] })
    );
});

test('failed route loads are not cached', async () => {
    let loads = 0;
    const cache = createRouteCache();
    const loader = async () => {
        loads += 1;
        if (loads === 1) throw new Error('temporary failure');
        return { ok: true };
    };

    await assert.rejects(cache.getOrLoad('route', loader), /temporary failure/);
    assert.deepEqual(await cache.getOrLoad('route', loader), { ok: true });
    assert.equal(loads, 2);
});

test('expired route results are loaded again', async () => {
    let currentTime = 0;
    let loads = 0;
    const cache = createRouteCache({ ttlMs: 100, now: () => currentTime });
    const loader = async () => ({ route: ++loads });

    assert.deepEqual(await cache.getOrLoad('route', loader), { route: 1 });
    currentTime = 101;
    assert.deepEqual(await cache.getOrLoad('route', loader), { route: 2 });
});
