const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadOrsService(options = {}) {
    let callableCount = 0;
    const callableNames = [];
    const context = {
        window: {
            BARK: {
                isLaunchFlagEnabled: () => true
            }
        },
        firebase: {
            auth: () => ({
                currentUser: {
                    uid: 'premium-user',
                    email: 'premium@example.test',
                    emailVerified: true,
                    providerData: [{ providerId: 'password' }]
                }
            }),
            functions: () => ({
                httpsCallable: name => async payload => {
                    callableCount += 1;
                    callableNames.push(name);
                    if (typeof options.callable === 'function') {
                        return options.callable({ name, payload, callableCount });
                    }
                    return { data: { call: callableCount, coordinates: payload.coordinates } };
                }
            })
        },
        console
    };
    context.window.window = context.window;

    ['orsRouteCache.js', 'orsService.js'].forEach(fileName => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', '01-code', 'app', 'services', fileName),
            'utf8'
        );
        vm.runInNewContext(source, context, { filename: `services/${fileName}` });
    });

    return {
        directions: context.window.BARK.services.ors.directions,
        getCallableCount: () => callableCount,
        getCallableNames: () => callableNames
    };
}

test('unchanged route generation reuses the first callable result', async () => {
    const harness = loadOrsService();
    const coordinates = [[-86.3, 46.5], [-86.6, 46.4]];

    const first = await harness.directions(coordinates, { radiuses: [-1, -1] });
    const repeated = await harness.directions(coordinates, { radiuses: [-1, -1] });

    assert.equal(harness.getCallableCount(), 1);
    assert.deepEqual(harness.getCallableNames(), ['getPremiumRouteCompact']);
    assert.deepEqual(repeated, first);
});

test('changing a route point causes a new callable request', async () => {
    const harness = loadOrsService();

    await harness.directions([[-86.3, 46.5], [-86.6, 46.4]]);
    await harness.directions([[-86.3, 46.5], [-86.7, 46.4]]);

    assert.equal(harness.getCallableCount(), 2);
});

test('route rate limit is remembered locally until its reset time', async () => {
    const retryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const harness = loadOrsService({
        callable: async () => {
            const error = new Error('Route generation limit reached.');
            error.code = 'functions/resource-exhausted';
            error.details = { retryAfterSeconds: 1800, retryAt };
            throw error;
        }
    });

    await assert.rejects(
        harness.directions([[-86.3, 46.5], [-86.6, 46.4]]),
        error => error.code === 'functions/resource-exhausted'
    );
    await assert.rejects(
        harness.directions([[-86.3, 46.5], [-86.7, 46.4]]),
        error => error.code === 'functions/resource-exhausted' && error.details.localBlock === true
    );

    assert.equal(harness.getCallableCount(), 1, 'the second route must stop before Firebase');
});
