const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function loadGamificationEngine(points = []) {
    const sandbox = {
        console,
        window: {
            BARK: {
                debugDataRefresh: false,
                calculateVisitScore(visits, walkPoints = 0) {
                    return {
                        totalScore: visits.length + walkPoints,
                        verifiedCount: visits.filter(visit => visit && visit.verified).length
                    };
                },
                repos: {
                    ParkRepo: {
                        getById(id) {
                            return points.find(point => point.id === id) || null;
                        }
                    }
                }
            }
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'gamificationLogic.js'), 'utf8'), sandbox);
    return sandbox.window.GamificationEngine;
}

test('gamification totals count unique physical sites, not state memberships or duplicate rows', () => {
    const points = [
        { id: 'death-valley', name: 'Death Valley National Park', state: 'California / Nevada', lat: 36.5323, lng: -116.9325 },
        { id: 'headwaters-legacy', name: 'Headwaters Forest Reserve', state: 'California', lat: 40.6327009, lng: -124.0651375 },
        { id: 'headwaters-current', name: 'Headwaters Forest Reserve  ', state: 'California', lat: 40.6327009, lng: -124.0651375 },
        { id: 'yosemite', name: 'Yosemite National Park', state: 'California', lat: 37.8651, lng: -119.5383 },
        { id: 'smokies', name: 'Great Smoky Mountains National Park', state: 'North Carolina, Tennessee', lat: 35.6118, lng: -83.4895 }
    ];
    const Engine = loadGamificationEngine(points);
    const engine = new Engine();

    engine.updateCanonicalCountsFromPoints(points);

    assert.equal(engine.totalRawParkRows, 5);
    assert.equal(engine.totalSystemParks, 4);
    assert.equal(engine.stateCanonicalCounts.CA, 3);
    assert.equal(engine.stateCanonicalCounts.NV, 1);
    assert.equal(engine.stateCanonicalCounts.NC, 1);
    assert.equal(engine.stateCanonicalCounts.TN, 1);
});

test('duplicate Park IDs for the same physical site count once in national and state progress', () => {
    const points = [
        { id: 'death-valley', name: 'Death Valley National Park', state: 'California / Nevada', lat: 36.5323, lng: -116.9325 },
        { id: 'headwaters-legacy', name: 'Headwaters Forest Reserve', state: 'California', lat: 40.6327009, lng: -124.0651375 },
        { id: 'headwaters-current', name: 'Headwaters Forest Reserve  ', state: 'California', lat: 40.6327009, lng: -124.0651375 },
        { id: 'yosemite', name: 'Yosemite National Park', state: 'California', lat: 37.8651, lng: -119.5383 }
    ];
    const Engine = loadGamificationEngine(points);
    const engine = new Engine();
    engine.updateCanonicalCountsFromPoints(points);

    const result = engine.evaluate([
        { id: 'death-valley', verified: true, ts: 1 },
        { id: 'headwaters-legacy', verified: true, ts: 2 },
        { id: 'headwaters-current', verified: true, ts: 3 },
        { id: 'yosemite', verified: true, ts: 4 }
    ]);

    const californiaBadge = result.stateBadges.find(badge => badge.id === 'state-ca');
    const mapConqueror = result.mysteryFeats.find(badge => badge.id === 'mapConqueror');

    assert.equal(result.nationalProgress.totalVisited, 3);
    assert.equal(result.nationalProgress.totalParks, 3);
    assert.equal(result.nationalProgress.percentComplete, 100);
    assert.equal(californiaBadge.percentComplete, 100);
    assert.equal(californiaBadge.status, 'unlocked');
    assert.equal(californiaBadge.tier, 'verified');
    assert.equal(mapConqueror.status, 'unlocked');
});

test('Fort Caroline and Kingsley Plantation count as separate Florida sites', () => {
    const points = [
        {
            id: 'b7b26034-7d2c-4c3e-9901-29e1b5751230',
            name: 'Fort Caroline/Timucuan Ecological and Historical Preserve',
            state: 'Florida',
            lat: 30.385948,
            lng: -81.497541
        },
        {
            id: 'f1bf6d46-3919-4c0c-838d-555ca47155d2',
            name: 'Timucuan Ecological and Historical Preserve Kingsley Plantation',
            state: 'Florida',
            lat: 30.439983,
            lng: -81.437833
        }
    ];
    const Engine = loadGamificationEngine(points);
    const engine = new Engine();
    engine.updateCanonicalCountsFromPoints(points);

    const progress = engine.getVisitProgressMaps([
        { id: 'b7b26034-7d2c-4c3e-9901-29e1b5751230', verified: false },
        { id: 'f1bf6d46-3919-4c0c-838d-555ca47155d2', verified: true }
    ]);

    assert.equal(engine.totalSystemParks, 2);
    assert.equal(engine.stateCanonicalCounts.FL, 2);
    assert.equal(progress.totalVisitedSites, 2);
    assert.equal(progress.verifiedVisitedSites, 1);
    assert.equal(progress.stateVisitsTotalMap.FL, 2);
});

test('removed spreadsheet rows do not erase already collected visit progress', () => {
    const points = [
        { id: 'current-site', name: 'Current Site', state: 'Florida', lat: 30.1, lng: -81.1 }
    ];
    const Engine = loadGamificationEngine(points);
    const engine = new Engine();
    engine.updateCanonicalCountsFromPoints(points);

    const progress = engine.getVisitProgressMaps([
        { id: 'removed-site', name: 'Removed Site', state: 'Florida', lat: 30.2, lng: -81.2, verified: true }
    ]);

    assert.equal(progress.totalVisitedSites, 1);
    assert.equal(progress.verifiedVisitedSites, 1);
    assert.equal(progress.stateVisitsTotalMap.FL, 1);
});

test('new spreadsheet rows increase completion requirements without clearing existing visits', () => {
    const points = [
        { id: 'site-a', name: 'Site A', state: 'Florida', lat: 30.1, lng: -81.1 }
    ];
    const Engine = loadGamificationEngine(points);
    const engine = new Engine();
    engine.updateCanonicalCountsFromPoints(points);

    let result = engine.evaluate([
        { id: 'site-a', name: 'Site A', state: 'Florida', lat: 30.1, lng: -81.1, verified: true }
    ]);
    let floridaBadge = result.stateBadges.find(badge => badge.id === 'state-fl');

    assert.equal(result.nationalProgress.totalVisited, 1);
    assert.equal(result.nationalProgress.totalParks, 1);
    assert.equal(floridaBadge.status, 'unlocked');

    engine.updateCanonicalCountsFromPoints([
        ...points,
        { id: 'site-b', name: 'Site B', state: 'Florida', lat: 30.2, lng: -81.2 }
    ]);

    result = engine.evaluate([
        { id: 'site-a', name: 'Site A', state: 'Florida', lat: 30.1, lng: -81.1, verified: true }
    ]);
    floridaBadge = result.stateBadges.find(badge => badge.id === 'state-fl');

    assert.equal(result.nationalProgress.totalVisited, 1);
    assert.equal(result.nationalProgress.totalParks, 2);
    assert.equal(result.nationalProgress.percentComplete, 50);
    assert.equal(floridaBadge.percentComplete, 50);
    assert.equal(floridaBadge.status, 'locked');
});

test('alpha dog mystery feat unlocks only when leaderboard rank is first', () => {
    const Engine = loadGamificationEngine();
    const engine = new Engine();

    const firstPlace = engine.evaluate([], 1).mysteryFeats.find(feat => feat.id === 'alphaDog');
    const unknownPlace = engine.evaluate([], null).mysteryFeats.find(feat => feat.id === 'alphaDog');
    const secondPlace = engine.evaluate([], 2).mysteryFeats.find(feat => feat.id === 'alphaDog');

    assert.equal(firstPlace.status, 'unlocked');
    assert.equal(firstPlace.tier, 'verified');
    assert.equal(unknownPlace.status, 'locked');
    assert.equal(secondPlace.status, 'locked');
});
