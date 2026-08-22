const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadTripLayerManager() {
    const visibleLayers = new Set();
    const createdLines = [];
    const layerGroup = {
        addTo() {
            return this;
        },
        addLayer(layer) {
            visibleLayers.add(layer);
        },
        removeLayer(layer) {
            visibleLayers.delete(layer);
        },
        hasLayer(layer) {
            return visibleLayers.has(layer);
        }
    };
    const routeDays = [
        { dayIndex: 0, color: '#111111', latLngs: [[1, 1], [2, 2]] },
        { dayIndex: 1, color: '#222222', latLngs: [[2, 2], [3, 3]] }
    ];

    const context = {
        window: {
            BARK: {
                repos: {},
                buildTripRoutePlan: () => ({ days: routeDays })
            },
            map: {}
        },
        L: {
            layerGroup: () => layerGroup,
            polyline(latLngs, options) {
                const line = {
                    latLngs,
                    options: { ...options },
                    setLatLngs(next) {
                        this.latLngs = next;
                    },
                    setStyle(style) {
                        Object.assign(this.options, style);
                    }
                };
                createdLines.push(line);
                return line;
            }
        },
        console
    };
    context.window.window = context.window;

    const source = fs.readFileSync(
        path.join(__dirname, '..', '01-code', 'app', 'modules', 'TripLayerManager.js'),
        'utf8'
    );
    vm.runInNewContext(source, context, { filename: 'modules/TripLayerManager.js' });

    return {
        api: context.window.BARK.tripLayer,
        createdLines,
        visibleLayers
    };
}

test('straight fallbacks remain visible only for days without generated routes', () => {
    const harness = loadTripLayerManager();
    harness.api.init({ map: {} });
    harness.api.sync([{ stops: [] }, { stops: [] }], {});

    assert.equal(harness.visibleLayers.size, 2, 'both unrouted days start with fallbacks');

    harness.api.setRoutedDayIndexes(new Set([0]));
    assert.equal(harness.visibleLayers.has(harness.createdLines[0]), false);
    assert.equal(harness.visibleLayers.has(harness.createdLines[1]), true);

    harness.api.sync([{ stops: [] }, { stops: [] }], {});
    assert.equal(harness.visibleLayers.has(harness.createdLines[0]), false, 'UI refresh must preserve routed coverage');
    assert.equal(harness.visibleLayers.has(harness.createdLines[1]), true);

    harness.api.setRoutedDayIndexes(new Set([0, 1]));
    assert.equal(harness.visibleLayers.size, 0, 'fully routed trips need no straight fallback');

    harness.api.clear();
    harness.api.sync([{ stops: [] }, { stops: [] }], {});
    assert.equal(harness.visibleLayers.size, 2, 'clearing route coverage restores fallbacks');
});
