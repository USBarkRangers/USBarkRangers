const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGuard() {
    const context = { URL, window: { BARK: {} } };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'modules', 'uiController.js'), 'utf8'),
        context,
        { filename: 'modules/uiController.js' }
    );
    return context.window.BARK.navInputGuard;
}

test('primary touch and Apple Pencil taps tolerate natural hand movement', () => {
    const guard = loadGuard();
    [
        { pointerType: 'touch', startX: 100, startY: 100, endX: 105, endY: 103 },
        { pointerType: 'pen', startX: 200, startY: 200, endX: 204, endY: 206 }
    ].forEach((pointer) => {
        assert.equal(guard.shouldActivatePointer({
            ...pointer,
            isPrimary: true,
            button: 0
        }), true);
    });
});

test('navigation rejects swipes, secondary mouse clicks, and non-primary pointers', () => {
    const guard = loadGuard();
    assert.equal(guard.shouldActivatePointer({
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        startX: 100,
        startY: 100,
        endX: 125,
        endY: 100
    }), false);
    assert.equal(guard.shouldActivatePointer({
        pointerType: 'mouse',
        isPrimary: true,
        button: 2,
        startX: 100,
        startY: 100,
        endX: 100,
        endY: 100
    }), false);
    assert.equal(guard.shouldActivatePointer({
        pointerType: 'pen',
        isPrimary: false,
        button: 0,
        startX: 100,
        startY: 100,
        endX: 100,
        endY: 100
    }), false);
});
