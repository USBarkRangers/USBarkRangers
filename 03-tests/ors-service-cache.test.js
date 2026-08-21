const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadOrsService() {
    let callableCount = 0;
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
                httpsCallable: () => async payload => {
                    callableCount += 1;
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
        getCallableCount: () => callableCount
    };
}

test('unchanged route generation reuses the first callable result', async () => {
    const harness = loadOrsService();
    const coordinates = [[-86.3, 46.5], [-86.6, 46.4]];

    const first = await harness.directions(coordinates, { radiuses: [-1, -1] });
    const repeated = await harness.directions(coordinates, { radiuses: [-1, -1] });

    assert.equal(harness.getCallableCount(), 1);
    assert.deepEqual(repeated, first);
});

test('changing a route point causes a new callable request', async () => {
    const harness = loadOrsService();

    await harness.directions([[-86.3, 46.5], [-86.6, 46.4]]);
    await harness.directions([[-86.3, 46.5], [-86.7, 46.4]]);

    assert.equal(harness.getCallableCount(), 2);
});
