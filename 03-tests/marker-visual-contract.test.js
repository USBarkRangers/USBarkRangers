const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

test('park pins retain the original Leaflet enamel-pin DOM contract', () => {
    let iconOptions = null;
    let markerOptions = null;
    const context = {
        window: {},
        L: {
            divIcon(options) {
                iconOptions = options;
                return options;
            },
            marker(latLng, options) {
                markerOptions = { latLng, options };
                return {};
            }
        }
    };

    vm.runInNewContext(
        fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'MapMarkerConfig.js'), 'utf8'),
        context,
        { filename: 'MapMarkerConfig.js' }
    );

    context.window.MapMarkerConfig.createCustomMarker({
        id: 'visual-contract',
        lat: 35,
        lng: -80,
        parkCategory: 'National'
    }, false);

    assert.equal(
        iconOptions.html,
        '<div class="enamel-pin-wrapper"><img src="assets/images/bark-logo.jpeg" alt="Park Pin" loading="lazy" /></div>'
    );
    assert.match(iconOptions.className, /custom-bark-marker/);
    assert.match(iconOptions.className, /unvisited-marker/);
    assert.match(iconOptions.className, /cat-national/);
    assert.deepEqual(Array.from(iconOptions.iconSize), [36, 36]);
    assert.deepEqual(Array.from(iconOptions.iconAnchor), [18, 18]);
    assert.deepEqual(Array.from(markerOptions.latLng), [35, -80]);
});

test('normal-state optimization preserves active yellow pins and uses no replacement renderer', () => {
    const styles = fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'styles.css'), 'utf8');
    const mapStyles = fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'styles', 'mapStyles.css'), 'utf8');
    const index = fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'index.html'), 'utf8');
    const manager = fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'modules', 'MarkerLayerManager.js'), 'utf8');

    assert.match(styles, /\.cat-national:not\(\.visited-pin\):not\(\.active-pin\)/);
    assert.match(styles, /box-shadow:\s*0 0 13px var\(--pin-shadow-color\)/);
    assert.match(mapStyles, /\.custom-bark-marker\.active-pin:not\(\.visited-pin\) \.enamel-pin-wrapper/);
    assert.match(mapStyles, /#FBBF24/);
    assert.match(manager, /marker\.on\('click', \(\) => \{\s*this\.renderMarkerPanel\(marker\);/);
    assert.doesNotMatch(index, /CanvasMarkerLayer/);
});
