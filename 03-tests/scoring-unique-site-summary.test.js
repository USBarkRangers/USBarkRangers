const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function loadScoringUtils(gamificationEngine = null) {
    const sandbox = {
        console,
        window: {
            BARK: {
                sanitizeWalkPoints(value) {
                    const parsed = Number(value);
                    return Number.isFinite(parsed) ? parsed : 0;
                }
            },
            gamificationEngine
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'utils', 'scoringUtils.js'), 'utf8'), sandbox);
    return sandbox.window.BARK;
}

test('visit scoring falls back to raw visits when unique progress is unavailable', () => {
    const BARK = loadScoringUtils();

    const summary = BARK.calculateVisitScore([
        { id: 'a', verified: true },
        { id: 'b', verified: false }
    ], 0);

    assert.equal(summary.totalVisitedCount, 2);
    assert.equal(summary.verifiedCount, 1);
    assert.equal(summary.regularCount, 1);
    assert.equal(summary.totalScore, 3);
});

test('visit scoring uses unique physical sites and verified bonus when progress is available', () => {
    const BARK = loadScoringUtils({
        getVisitProgressMaps() {
            return {
                totalVisitedSites: 2,
                verifiedVisitedSites: 1
            };
        }
    });

    const summary = BARK.calculateVisitScore([
        { id: 'headwaters-legacy', verified: true },
        { id: 'headwaters-current', verified: true },
        { id: 'yosemite', verified: false }
    ], 0);

    assert.equal(summary.totalVisitedCount, 2);
    assert.equal(summary.verifiedCount, 1);
    assert.equal(summary.regularCount, 1);
    assert.equal(summary.totalScore, 3);
});
