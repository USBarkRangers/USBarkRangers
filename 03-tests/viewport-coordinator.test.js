const test = require('node:test');
const assert = require('node:assert/strict');

const coordinator = require('../01-code/app/modules/viewportCoordinator');

test('standalone shell keeps the full app window after Safari reports a shorter return viewport', () => {
    assert.equal(coordinator.calculateStandaloneAppHeight({
        outerHeight: 932,
        innerHeight: 743,
        visualHeight: 743,
        documentHeight: 737,
        bodyHeight: 743
    }), 932);
});

test('standalone shell ignores invalid dimensions and never invents a phone size', () => {
    assert.equal(coordinator.calculateStandaloneAppHeight({
        outerHeight: Number.NaN,
        innerHeight: 667,
        visualHeight: -1,
        documentHeight: 667
    }), 667);
    assert.equal(coordinator.calculateStandaloneAppHeight({ outerHeight: 9000 }), 0);
});

test('a phone whose navigation already fits receives no correction', () => {
    assert.equal(coordinator.calculateRequiredContentLift({
        currentLift: 0,
        contentBottom: 900,
        visibleBottom: 932,
        layoutHeight: 932
    }), 0);
});

test('a clipped navigation receives only the required bottom lift', () => {
    assert.equal(coordinator.calculateRequiredContentLift({
        currentLift: 0,
        contentBottom: 840,
        visibleBottom: 681,
        layoutHeight: 874
    }), 162);
});

test('the correction converges instead of growing on every measurement', () => {
    assert.equal(coordinator.calculateRequiredContentLift({
        currentLift: 162,
        contentBottom: 678,
        visibleBottom: 681,
        layoutHeight: 874
    }), 162);
});

test('the correction returns to zero when the full viewport is restored', () => {
    assert.equal(coordinator.calculateRequiredContentLift({
        currentLift: 162,
        contentBottom: 678,
        visibleBottom: 874,
        layoutHeight: 874
    }), 0);
});

test('keyboard and external handoff states freeze the current geometry', () => {
    assert.equal(coordinator.calculateRequiredContentLift({
        currentLift: 38,
        contentBottom: 820,
        visibleBottom: 500,
        layoutHeight: 844,
        suspended: true
    }), 38);
});

test('invalid browser measurements cannot create a correction loop', () => {
    assert.equal(coordinator.calculateRequiredContentLift({
        currentLift: 0,
        contentBottom: Number.NaN,
        visibleBottom: 0,
        layoutHeight: 844
    }), 0);
});
