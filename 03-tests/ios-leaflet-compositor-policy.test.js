const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const policySource = fs.readFileSync(
    path.join(repoRoot, '01-code', 'app', 'modules', 'markerLayerPolicy.js'),
    'utf8'
);

function loadPolicy({ userAgent, platform = '', maxTouchPoints = 0 }) {
    const window = {
        BARK: {},
        navigator: { userAgent, platform, maxTouchPoints },
        L: { Browser: { any3d: true } }
    };

    vm.runInNewContext(policySource, { window }, { filename: 'markerLayerPolicy.js' });
    return window;
}

test('iPhone Leaflet rendering drops per-pin 3-D compositor surfaces', () => {
    const window = loadPolicy({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5
    });

    assert.equal(window.BARK.isAppleTouchWebKit(), true);
    assert.equal(window.BARK.applyIosLeafletCompositorPolicy(), true);
    assert.equal(window.L.Browser.any3d, false);
});

test('desktop-mode iPad receives the same compositor protection', () => {
    const window = loadPolicy({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5
    });

    assert.equal(window.BARK.applyIosLeafletCompositorPolicy(), true);
    assert.equal(window.L.Browser.any3d, false);
});

test('desktop and Android Leaflet rendering are not changed', () => {
    const desktop = loadPolicy({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0
    });
    const android = loadPolicy({
        userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/151 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 5
    });

    assert.equal(desktop.BARK.applyIosLeafletCompositorPolicy(), false);
    assert.equal(desktop.L.Browser.any3d, true);
    assert.equal(android.BARK.applyIosLeafletCompositorPolicy(), false);
    assert.equal(android.L.Browser.any3d, true);
});

test('the iOS policy does not replace or restructure the original pins', () => {
    const markerConfig = fs.readFileSync(
        path.join(repoRoot, '01-code', 'app', 'MapMarkerConfig.js'),
        'utf8'
    );
    const mapStyles = fs.readFileSync(
        path.join(repoRoot, '01-code', 'app', 'styles', 'mapStyles.css'),
        'utf8'
    );
    const mapEngine = fs.readFileSync(
        path.join(repoRoot, '01-code', 'app', 'modules', 'mapEngine.js'),
        'utf8'
    );

    assert.match(markerConfig, /<div class="enamel-pin-wrapper"><img src="\$\{style\.iconUrl\}" alt="Park Pin" loading="lazy" \/><\/div>/);
    assert.match(mapStyles, /\.custom-bark-marker\.active-pin:not\(\.visited-pin\) \.enamel-pin-wrapper/);
    assert.match(mapStyles, /#FBBF24/);
    assert.match(mapEngine, /applyIosLeafletCompositorPolicy\(window\.L\)/);
    assert.match(mapEngine, /markerZoomAnimation: !useFlatIosLeafletRendering/);
});
