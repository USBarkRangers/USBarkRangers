const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', '01-code', 'app', 'modules', 'oauthFragmentGuard.js'),
    'utf8'
);

function runGuard(hash) {
    const replacements = [];
    const window = {
        BARK: {},
        location: {
            hash,
            pathname: '/USBarkRangers/01-code/app/',
            search: '?checkout=success'
        },
        history: {
            replaceState(_state, _title, value) {
                replacements.push(value);
            }
        }
    };
    vm.runInNewContext(source, { window, URLSearchParams }, { filename: 'modules/oauthFragmentGuard.js' });
    return { window, replacements };
}

test('OAuth return credentials are captured once and immediately removed from the visible URL', () => {
    const fragment = '#id_token=header.payload.signature&state=state-123';
    const { window, replacements } = runGuard(fragment);

    assert.deepEqual(replacements, ['/USBarkRangers/01-code/app/?checkout=success']);
    assert.equal(window.BARK.consumeOAuthRedirectFragment(), fragment.slice(1));
    assert.equal(window.BARK.consumeOAuthRedirectFragment(), '');
});

test('ordinary app route fragments are not consumed or rewritten', () => {
    const { window, replacements } = runGuard('#map');

    assert.deepEqual(replacements, []);
    assert.equal(window.BARK.consumeOAuthRedirectFragment(), '');
});
