const assert = require('node:assert/strict');
const test = require('node:test');

const { buildTripRoutePlan } = require('../01-code/app/engines/tripRoutePlan.js');
const {
    buildRouteBatches,
    splitRouteBatchResponse
} = require('../01-code/app/engines/tripRouteBatch.js');

function stop(name, lat, lng) {
    return { name, lat, lng };
}

function day(color, stops) {
    return { color, stops, notes: '' };
}

function names(routeDay) {
    return routeDay.points.map(point => point.node.name);
}

test('each populated day starts where the previous populated day ended', () => {
    const start = stop('Start', 1, 1);
    const first = stop('First', 2, 2);
    const handoff = stop('Handoff', 3, 3);
    const next = stop('Next', 4, 4);
    const end = stop('End', 5, 5);
    const plan = buildTripRoutePlan({
        tripDays: [day('#111111', [first, handoff]), day('#222222', [next])],
        startNode: start,
        endNode: end
    });

    assert.deepEqual(names(plan.days[0]), ['Start', 'First', 'Handoff']);
    assert.deepEqual(names(plan.days[1]), ['Handoff', 'Next', 'End']);
});

test('route continuity skips empty middle days', () => {
    const first = stop('First', 1, 1);
    const later = stop('Later', 2, 2);
    const plan = buildTripRoutePlan({
        tripDays: [day('#111111', [first]), day('#222222', []), day('#333333', [later])]
    });

    assert.deepEqual(plan.days.map(routeDay => routeDay.dayIndex), [0, 2]);
    assert.deepEqual(names(plan.days[1]), ['First', 'Later']);
});

test('Trip End attaches to the last populated day when final days are empty', () => {
    const first = stop('First', 1, 1);
    const end = stop('Trip End', 2, 2);
    const plan = buildTripRoutePlan({
        tripDays: [day('#111111', [first]), day('#222222', []), day('#333333', [])],
        endNode: end
    });

    assert.equal(plan.days.length, 1);
    assert.equal(plan.days[0].dayIndex, 0);
    assert.deepEqual(names(plan.days[0]), ['First', 'Trip End']);
});

test('adjacent saved boundary duplicates are compacted', () => {
    const shared = stop('Shared', 1, 1);
    const next = stop('Next', 2, 2);
    const plan = buildTripRoutePlan({
        tripDays: [day('#111111', [shared]), day('#222222', [{ ...shared }, next])]
    });

    assert.deepEqual(names(plan.days[1]), ['Shared', 'Next']);
});

test('consecutive route days share one bounded ORS batch', () => {
    const plan = buildTripRoutePlan({
        tripDays: [
            day('#111111', [stop('A', 1, 1)]),
            day('#222222', []),
            day('#333333', [stop('B', 2, 2)])
        ],
        startNode: stop('Start', 0, 0),
        endNode: stop('End', 3, 3)
    });
    const batches = buildRouteBatches(plan.routableDays);

    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].points.map(point => point.node.name), ['Start', 'A', 'B', 'End']);
    assert.deepEqual(batches[0].days.map(routeDay => routeDay.dayIndex), [0, 2]);
});

test('batched geometry is split back into local day colors', () => {
    const plan = buildTripRoutePlan({
        tripDays: [day('#111111', [stop('A', 1, 1)]), day('#222222', [stop('B', 2, 2)])],
        startNode: stop('Start', 0, 0),
        endNode: stop('End', 3, 3)
    });
    const batch = buildRouteBatches(plan.routableDays)[0];
    const geometry = [[0, 0], [0.5, 0.5], [1, 1], [1.5, 1.5], [2, 2], [2.5, 2.5], [3, 3]];
    const response = {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: geometry },
            properties: {
                summary: { distance: 30, duration: 60 },
                segments: [0, 1, 2].map(index => ({
                    distance: 10,
                    duration: 20,
                    steps: [{ way_points: [index * 2, index * 2 + 2] }]
                }))
            }
        }]
    };

    const results = splitRouteBatchResponse(batch, response);

    assert.deepEqual(results.map(result => result.color), ['#111111', '#222222']);
    assert.deepEqual(results[0].geoJSON.features[0].geometry.coordinates, geometry.slice(0, 3));
    assert.deepEqual(results[1].geoJSON.features[0].geometry.coordinates, geometry.slice(2));
    assert.deepEqual(results.map(result => result.summary.distance), [10, 20]);
});

test('batch builder splits at a point limit and rejects an oversized day', () => {
    const routeDays = [
        { dayIndex: 0, color: '#1', routable: true, points: [stop('A', 0, 0), stop('B', 1, 1), stop('C', 2, 2)] },
        { dayIndex: 1, color: '#2', routable: true, points: [stop('C', 2, 2), stop('D', 3, 3), stop('E', 4, 4)] }
    ];

    assert.equal(buildRouteBatches(routeDays, { maxPoints: 4, maxEstimatedDistanceKm: 10000 }).length, 2);
    assert.throws(
        () => buildRouteBatches([{ ...routeDays[0], points: [...routeDays[0].points, stop('D', 3, 3), stop('E', 4, 4)] }], { maxPoints: 4 }),
        /too many route points/
    );
});
