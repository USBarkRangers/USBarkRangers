const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('one-finger zoom uses matching cancellation APIs and resets on iOS touch cancellation', () => {
    const source = fs.readFileSync(
        path.join(ROOT, '01-code', 'app', 'modules', 'mapEngine.js'),
        'utf8'
    );

    assert.match(source, /let zoomFrameId = null;/);
    assert.match(source, /cancelAnimationFrame\(zoomFrameId\)/);
    assert.match(source, /let zoomTimeoutId = null;/);
    assert.match(source, /clearTimeout\(zoomTimeoutId\)/);
    assert.match(source, /addEventListener\('touchcancel', resetZoomState\)/);
    assert.doesNotMatch(source, /cancelAnimationFrame\(zoomTimeoutId\)/);
});
