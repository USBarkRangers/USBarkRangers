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
        {
            dayIndex: 0,
            color: '#111111',
            segments: [
                { key: 'day:0|one', latLngs: [[1, 1], [2, 2]] },
                { key: 'day:0|two', latLngs: [[2, 2], [3, 3]] }
            ]
        },
        {
            dayIndex: 1,
            color: '#222222',
            segments: [{ key: 'day:1|three', latLngs: [[3, 3], [4, 4]] }]
        }
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

test('straight fallbacks remain visible only for connections without generated routes', () => {
    const harness = loadTripLayerManager();
    harness.api.init({ map: {} });
    harness.api.sync([{ stops: [] }, { stops: [] }], {});

    assert.equal(harness.visibleLayers.size, 3, 'every unrouted connection starts with a fallback');

    harness.api.setRoutedSegmentKeys(new Set(['day:0|one']));
    assert.equal(harness.visibleLayers.has(harness.createdLines[0]), false);
    assert.equal(harness.visibleLayers.has(harness.createdLines[1]), true);
    assert.equal(harness.visibleLayers.has(harness.createdLines[2]), true);

    harness.api.sync([{ stops: [] }, { stops: [] }], {});
    assert.equal(harness.visibleLayers.has(harness.createdLines[0]), false, 'UI refresh must preserve routed coverage');
    assert.equal(harness.visibleLayers.has(harness.createdLines[1]), true);
    assert.equal(harness.visibleLayers.has(harness.createdLines[2]), true);

    harness.api.setRoutedSegmentKeys(new Set(['day:0|one', 'day:0|two', 'day:1|three']));
    assert.equal(harness.visibleLayers.size, 0, 'fully routed trips need no straight fallback');

    harness.api.clear();
    harness.api.sync([{ stops: [] }, { stops: [] }], {});
    assert.equal(harness.visibleLayers.size, 3, 'clearing route coverage restores fallbacks');
});
