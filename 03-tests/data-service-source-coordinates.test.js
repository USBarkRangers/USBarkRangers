const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function parseSimpleCsv(csvString, options) {
    const lines = csvString.trim().split(/\r?\n/);
    const headers = lines[0]
        .split(',')
        .map(header => options.transformHeader ? options.transformHeader(header) : header);
    const data = lines.slice(1).map(line => {
        const values = line.split(',').map(value => options.transform ? options.transform(value) : value);
        return headers.reduce((row, header, index) => {
            row[header] = values[index] || '';
            return row;
        }, {});
    });
    options.complete({ data, errors: [] });
}

function loadDataServiceHarness() {
    let publishedPoints = null;
    let gamificationPoints = null;
    const sandbox = {
        console,
        fetch,
        setTimeout,
        clearTimeout,
        navigator: { onLine: true },
        localStorage: {
            getItem() { return null; },
            setItem() {}
        },
        Papa: {
            parse: parseSimpleCsv
        },
        window: {
            BARK: {
                debugDataRefresh: false,
                getSwagType() { return 'Other'; },
                getParkCategory(value) { return value || 'Unknown'; },
                normalizeText(value) { return String(value || '').trim().toLowerCase(); },
                repos: {
                    ParkRepo: {
                        replaceAll(points) {
                            publishedPoints = points;
                            return { accepted: true };
                        }
                    }
                }
            },
            gamificationEngine: {
                updateCanonicalCountsFromPoints(points) {
                    gamificationPoints = points;
                }
            },
            syncState() {}
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'modules', 'dataService.js'), 'utf8'), sandbox);

    return {
        sandbox,
        getPublishedPoints: () => publishedPoints,
        getGamificationPoints: () => gamificationPoints
    };
}

test('data service skips source rows with missing coordinates instead of repairing them', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'Location,State,Swag Cost,Type,Useful/Important/Other Info,Website,lat,lng,Park id',
        'Cliffs of the Neuse State Park,North Carolina,Unknown,State,Tag,https://www.ncparks.gov/state-parks/cliffs-neuse-state-park,,,38e0a9bb-4365-4d84-87ea-cca3bde06435'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();
    assert.equal(publishedPoints.length, 0);
    assert.equal(harness.getGamificationPoints(), null);
});

test('data service publishes Fort Caroline and Kingsley Plantation source coordinates unchanged', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'Location,State,Swag Cost,Type,Useful/Important/Other Info,Website,lat,lng,Park id',
        'Fort Caroline/Timucuan Ecological and Historical Preserve,Florida,Free,National,Tag,https://www.nps.gov/places/foca.htm,30.385948,-81.497541,b7b26034-7d2c-4c3e-9901-29e1b5751230',
        'Timucuan Ecological and Historical Preserve Kingsley Plantation,Florida,Free,National,Tag,https://www.nps.gov/timu/learn/historyculture/kp.htm,30.439983,-81.437833,f1bf6d46-3919-4c0c-838d-555ca47155d2'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();
    const fortCaroline = publishedPoints.find(point => point.id === 'b7b26034-7d2c-4c3e-9901-29e1b5751230');
    const kingsley = publishedPoints.find(point => point.id === 'f1bf6d46-3919-4c0c-838d-555ca47155d2');

    assert.equal(publishedPoints.length, 2);
    assert.equal(fortCaroline.lat, 30.385948);
    assert.equal(fortCaroline.lng, -81.497541);
    assert.equal(kingsley.lat, 30.439983);
    assert.equal(kingsley.lng, -81.437833);
});

test('data service publishes War in the Pacific source coordinates unchanged', () => {
    const harness = loadDataServiceHarness();

    harness.sandbox.window.BARK.parseCSVString([
        'Location,State,Swag Cost,Type,Useful/Important/Other Info,Website,lat,lng,Park id',
        'War in the Pacific National Historical Park,Guam,Free,National,Tag,https://www.nps.gov/wapa/planyourvisit/index.htm,13.4744653,144.7187141,dd646fe7-2eca-459a-9280-8168b17b60f3'
    ].join('\n'));

    const publishedPoints = harness.getPublishedPoints();
    assert.equal(publishedPoints.length, 1);
    assert.equal(publishedPoints[0].lat, 13.4744653);
    assert.equal(publishedPoints[0].lng, 144.7187141);
});
