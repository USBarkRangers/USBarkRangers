const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadTripLayerManager(options = {}) {
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
    const routeDays = options.routeDays || [
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
                    setLatLngsCalls: 0,
                    setStyleCalls: 0,
                    setLatLngs(next) {
                        this.setLatLngsCalls += 1;
                        this.latLngs = next;
                    },
                    setStyle(style) {
                        this.setStyleCalls += 1;
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
        visibleLayers,
        routeDays
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

test('removing one route connection does not redraw every unchanged fallback line', () => {
    const segments = Array.from({ length: 500 }, (_, index) => ({
        key: `day:0|segment:${index}`,
        latLngs: [[index / 10, index / 10], [(index + 1) / 10, (index + 1) / 10]]
    }));
    const harness = loadTripLayerManager({
        routeDays: [{ dayIndex: 0, color: '#1976D2', segments }]
    });
    harness.api.init({ map: {} });
    harness.api.sync([{ stops: [] }], {});

    const removedLine = harness.createdLines[250];
    segments.splice(250, 1);
    harness.api.sync([{ stops: [] }], {});

    assert.equal(harness.visibleLayers.size, 499);
    assert.equal(harness.visibleLayers.has(removedLine), false, 'only the removed connection leaves the map');
    assert.equal(
        harness.createdLines.reduce((total, line) => total + line.setLatLngsCalls, 0),
        0,
        'unchanged route geometry must not be reset'
    );
    assert.equal(
        harness.createdLines.reduce((total, line) => total + line.setStyleCalls, 0),
        0,
        'unchanged route colors must not be reset'
    );
});

test('fallback route lines still update when geometry or day color really changes', () => {
    const segments = [
        { key: 'day:0|one', latLngs: [[1, 1], [2, 2]] },
        { key: 'day:0|two', latLngs: [[2, 2], [3, 3]] }
    ];
    const routeDays = [{ dayIndex: 0, color: '#1976D2', segments }];
    const harness = loadTripLayerManager({ routeDays });
    harness.api.init({ map: {} });
    harness.api.sync([{ stops: [] }], {});

    segments[0].latLngs = [[1, 1], [2.5, 2.5]];
    routeDays[0].color = '#2E7D32';
    harness.api.sync([{ stops: [] }], {});

    assert.equal(harness.createdLines[0].setLatLngsCalls, 1);
    assert.deepEqual(harness.createdLines[0].latLngs, [[1, 1], [2.5, 2.5]]);
    assert.equal(harness.createdLines[0].setStyleCalls, 1);
    assert.equal(harness.createdLines[0].options.color, '#2E7D32');
    assert.equal(harness.createdLines[1].setLatLngsCalls, 0, 'unchanged geometry remains untouched');
    assert.equal(harness.createdLines[1].setStyleCalls, 1, 'the shared day color still updates');
});
