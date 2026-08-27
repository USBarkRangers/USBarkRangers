const test = require('node:test');
const assert = require('node:assert/strict');

const coordinator = require('../01-code/app/modules/viewportCoordinator');

function entryElement(tagName, type = '') {
    const normalizedTag = String(tagName).toLowerCase();
    return {
        matches(selector) {
            if (selector === 'textarea, [contenteditable="true"]') {
                return normalizedTag === 'textarea' || normalizedTag === 'contenteditable';
            }
            if (selector === 'input') return normalizedTag === 'input';
            return false;
        },
        getAttribute(name) {
            return name === 'type' ? type : null;
        }
    };
}

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

test('keyboard-sized viewport readings cannot reduce the established app window', () => {
    assert.equal(coordinator.chooseStableStandaloneHeight({
        outerHeight: 560,
        innerHeight: 560,
        visualHeight: 510,
        currentHeight: 932,
        allowShrink: false
    }), 932);
});

test('a real rotation or window-width change can establish a smaller app window', () => {
    assert.equal(coordinator.chooseStableStandaloneHeight({
        outerHeight: 430,
        innerHeight: 430,
        visualHeight: 430,
        currentHeight: 932,
        allowShrink: true
    }), 430);
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

test('keyboard recovery waits while Android still reports the short viewport', () => {
    assert.equal(coordinator.hasKeyboardViewportRecovered({
        baselineBottom: 915,
        visibleBottom: 520,
        textEntryActive: false
    }), false);
});

test('keyboard recovery completes when the visual viewport returns to its baseline', () => {
    assert.equal(coordinator.hasKeyboardViewportRecovered({
        baselineBottom: 915,
        visibleBottom: 910,
        textEntryActive: false
    }), true);
});

test('switching directly to another text field keeps the keyboard session active', () => {
    assert.equal(coordinator.hasKeyboardViewportRecovered({
        baselineBottom: 915,
        visibleBottom: 915,
        textEntryActive: true
    }), false);
});

test('the shared keyboard lifecycle covers every app text-entry control type', () => {
    ['text', 'search', 'email', 'password', 'number', 'tel', 'url'].forEach(type => {
        assert.equal(coordinator.isTextEntryElement(entryElement('input', type)), true, type);
    });
    assert.equal(coordinator.isTextEntryElement(entryElement('textarea')), true);
    assert.equal(coordinator.isTextEntryElement(entryElement('contenteditable')), true);
    ['file', 'range', 'checkbox', 'radio', 'button'].forEach(type => {
        assert.equal(coordinator.isTextEntryElement(entryElement('input', type)), false, type);
    });
});
