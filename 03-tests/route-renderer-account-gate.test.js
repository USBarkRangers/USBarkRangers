const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement(id) {
    return {
        id,
        innerHTML: '',
        style: { display: 'none' },
        clickCount: 0,
        click() {
            this.clickCount += 1;
        },
        appendChild() {}
    };
}

function loadRouteRenderer(options = {}) {
    let premiumActive = options.premium === true;
    const elements = new Map([
        ['planner-saved-routes-container', createElement('planner-saved-routes-container')],
        ['planner-saved-routes-list', createElement('planner-saved-routes-list')],
        ['saved-routes-list', createElement('saved-routes-list')],
        ['saved-routes-count', createElement('saved-routes-count')]
    ]);
    const paywallCalls = [];
    const alertCalls = [];
    const loadCalls = [];

    const context = {
        window: {
            BARK: {
                services: {
                    premium: {
                        isPremium: () => premiumActive
                    },
                    firebase: {
                        getCurrentUser: () => options.user || null,
                        loadSavedRoutes: async () => {
                            loadCalls.push('loadSavedRoutes');
                            return { routes: [], nextCursor: null, hasMore: false };
                        }
                    }
                },
                paywall: options.withoutPaywall
                    ? null
                    : {
                        openPaywall(payload) {
                            paywallCalls.push(payload);
                        }
                    }
            }
        },
        document: {
            getElementById(id) {
                return elements.get(id) || null;
            },
            querySelector(selector) {
                return null;
            },
            querySelectorAll() {
                return [];
            },
            createElement: createElement
        },
        alert(message) {
            alertCalls.push(message);
        },
        console,
        Date
    };
    context.window.window = context.window;

    const source = fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'renderers', 'routeRenderer.js'), 'utf8');
    vm.runInNewContext(source, context, { filename: 'renderers/routeRenderer.js' });

    return {
        window: context.window,
        element: id => elements.get(id),
        paywallCalls,
        alertCalls,
        loadCalls,
        setPremium(value) {
            premiumActive = value === true;
        }
    };
}

test('planner load button opens premium paywall when signed out', () => {
    const harness = loadRouteRenderer();

    harness.window.togglePlannerRoutes();

    assert.equal(harness.element('planner-saved-routes-container').style.display, 'block');
    assert.match(harness.element('planner-saved-routes-list').innerHTML, /Premium/);
    assert.equal(harness.paywallCalls.length, 1);
    assert.equal(harness.paywallCalls[0].source, 'load-route');
    assert.equal(harness.loadCalls.length, 0);
});

test('planner load button blocks signed-in free users before saved-route reads', () => {
    const harness = loadRouteRenderer({ user: { uid: 'free-user' }, premium: false });

    harness.window.togglePlannerRoutes();

    assert.match(harness.element('planner-saved-routes-list').innerHTML, /Premium/);
    assert.equal(harness.paywallCalls.length, 1);
    assert.equal(harness.paywallCalls[0].source, 'load-route');
    assert.equal(harness.loadCalls.length, 0);
});

test('planner load button loads saved routes for premium users', async () => {
    const harness = loadRouteRenderer({ user: { uid: 'premium-user' }, premium: true });

    harness.window.togglePlannerRoutes();
    await Promise.resolve();

    assert.equal(harness.loadCalls.length, 1);
    assert.equal(harness.paywallCalls.length, 0);
});

test('premium route refresh replaces stale premium prompt without saved-route reads', () => {
    const harness = loadRouteRenderer({ user: { uid: 'premium-user' }, premium: false });

    harness.window.BARK.refreshSavedRoutesEntitlementState('premium-user');
    assert.equal(harness.element('saved-routes-count').textContent, 'Premium');
    assert.match(harness.element('saved-routes-list').innerHTML, /Premium/);

    harness.setPremium(true);
    harness.window.BARK.refreshSavedRoutesEntitlementState('premium-user');

    assert.equal(harness.element('saved-routes-count').textContent, 'Load');
    assert.match(harness.element('saved-routes-list').innerHTML, /Load Past Routes/);
    assert.equal(harness.loadCalls.length, 0);
    assert.equal(harness.paywallCalls.length, 0);
});

test('planner load button falls back to an alert when paywall is unavailable', () => {
    const harness = loadRouteRenderer({ user: { uid: 'free-user' }, premium: false, withoutPaywall: true });

    harness.window.togglePlannerRoutes();

    assert.equal(harness.alertCalls.length, 1);
    assert.match(harness.alertCalls[0], /Premium/);
});
