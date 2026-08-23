const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGuard() {
    const context = { window: { BARK: {} } };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'modules', 'uiController.js'), 'utf8'),
        context,
        { filename: 'modules/uiController.js' }
    );
    return context.window.BARK.keyboardViewportGuard;
}

function element(tagName, type = null) {
    return {
        tagName,
        getAttribute(name) {
            return name === 'type' ? type : null;
        }
    };
}

test('Safari viewport shrink without a focused text field cannot hide nav or popup', () => {
    const guard = loadGuard();

    assert.equal(guard.isKeyboardViewportOpen({
        baselineHeight: 844,
        viewportHeight: 500,
        screenHeight: 844,
        activeElement: null
    }), false);
    assert.equal(guard.isKeyboardViewportOpen({
        baselineHeight: 844,
        viewportHeight: 500,
        screenHeight: 844,
        activeElement: element('BUTTON')
    }), false);
});

test('a meaningful viewport shrink with a focused text field still detects the keyboard', () => {
    const guard = loadGuard();

    assert.equal(guard.isKeyboardViewportOpen({
        baselineHeight: 844,
        viewportHeight: 500,
        screenHeight: 844,
        activeElement: element('INPUT', 'search')
    }), true);
    assert.equal(guard.isKeyboardViewportOpen({
        baselineHeight: 844,
        viewportHeight: 760,
        screenHeight: 844,
        activeElement: element('TEXTAREA')
    }), false);
});

test('non-text inputs never activate keyboard layout mode', () => {
    const guard = loadGuard();
    ['button', 'checkbox', 'radio', 'range'].forEach(type => {
        assert.equal(guard.isTextEntryElement(element('INPUT', type)), false);
    });
});
