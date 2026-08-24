const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', '01-code', 'app', 'modules', 'rateLimitUi.js'),
    'utf8'
);

function loadRateLimitUi() {
    const alerts = [];
    const window = { BARK: {}, alert(message) { alerts.push(message); } };
    vm.runInNewContext(source, { window, Date }, { filename: 'modules/rateLimitUi.js' });
    return { api: window.BARK.rateLimitUi, alerts };
}

test('rate-limit UI formats the server reset in local time with the bot warning', () => {
    const { api } = loadRateLimitUi();
    const message = api.getRateLimitWarning({
        code: 'functions/resource-exhausted',
        details: { action: 'createCheckoutSession', retryAt: '2026-08-24T21:42:00.000Z' }
    });

    assert.match(message, /^Are you a bot\? Rate limit resets at /);
    assert.match(message, /\.$/);
    assert.doesNotMatch(message, /2026-08-24T21:42/);
});

test('rate-limit UI ignores ordinary errors and deduplicates one reset warning', () => {
    const { api, alerts } = loadRateLimitUi();
    const error = {
        code: 'resource-exhausted',
        details: { action: 'getPremiumRoute', retryAt: '2026-08-24T21:42:00.000Z' }
    };

    assert.equal(api.showRateLimitWarning(new Error('ordinary failure')), false);
    assert.equal(api.showRateLimitWarning(error), true);
    assert.equal(api.showRateLimitWarning(error), true);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Are you a bot\?/);
});
