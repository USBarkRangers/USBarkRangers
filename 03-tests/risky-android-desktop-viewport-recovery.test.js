const test = require('node:test');
const assert = require('node:assert/strict');

const recovery = require('../01-code/app/modules/riskyAndroidDesktopViewportRecovery');

function decision(overrides = {}) {
    return recovery.getRecoveryDecision({
        viewportWidth: 390,
        viewportHeight: 844,
        screenWidth: 390,
        visualScale: 1,
        isStandalone: true,
        hasCoarseTouch: true,
        isDisabled: false,
        ...overrides
    });
}

test('normal phone viewport is never counter-scaled', () => {
    assert.equal(decision().active, false);
});

test('normal desktop and browser-tab traffic are never counter-scaled', () => {
    assert.equal(decision({
        viewportWidth: 980,
        viewportHeight: 2100,
        screenWidth: 412,
        isStandalone: false
    }).active, false);

    assert.equal(decision({
        viewportWidth: 980,
        viewportHeight: 2100,
        screenWidth: 412,
        hasCoarseTouch: false
    }).active, false);
});

test('portrait tablet shape is excluded from the risky phone fallback', () => {
    assert.equal(decision({
        viewportWidth: 980,
        viewportHeight: 1300,
        screenWidth: 800
    }).active, false);
});

test('standalone Galaxy-like 980px viewport is restored to reported phone width', () => {
    const result = decision({
        viewportWidth: 980,
        viewportHeight: 2100,
        screenWidth: 412
    });

    assert.equal(result.active, true);
    assert.equal(result.logicalWidth, 412);
    assert.ok(Math.abs(result.zoom - (980 / 412)) < 0.001);
    assert.ok(Math.abs(result.logicalHeight - (2100 / result.zoom)) < 0.001);
});

test('visual viewport shrink recovers a phone width when screen.width is disguised', () => {
    const result = decision({
        viewportWidth: 980,
        viewportHeight: 2100,
        screenWidth: 980,
        visualScale: 0.42
    });

    assert.equal(result.active, true);
    assert.ok(Math.abs(result.logicalWidth - 411.6) < 0.001);
});

test('exact 980px fallback covers Chrome builds that disguise all phone metrics', () => {
    const result = decision({
        viewportWidth: 980,
        viewportHeight: 2100,
        screenWidth: 980,
        visualScale: 1
    });

    assert.equal(result.active, true);
    assert.equal(result.logicalWidth, 430);
});

test('emergency query kill switch prevents recovery', () => {
    assert.equal(decision({
        viewportWidth: 980,
        viewportHeight: 2100,
        screenWidth: 412,
        isDisabled: true
    }).active, false);
});
