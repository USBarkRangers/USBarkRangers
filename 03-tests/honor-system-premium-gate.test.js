const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
    const classes = new Set();
    return {
        value: '',
        disabled: false,
        style: {},
        textContent: '',
        attributes: {},
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
            contains(name) { return classes.has(name); }
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] || null; }
    };
}

function loadPremiumUi() {
    const elements = {
        'manual-miles-premium-control': createElement(),
        'miles-input': createElement(),
        'log-manual-miles-btn': createElement()
    };
    const context = {
        console,
        localStorage: { setItem() {} },
        document: {
            getElementById(id) { return elements[id] || null; }
        },
        window: {
            BARK: {
                services: { premium: { isPremium() { return false; } } },
                isLaunchFlagEnabled() { return true; }
            }
        }
    };
    context.window.window = context.window;
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'services', 'authPremiumUi.js'), 'utf8'),
        context,
        { filename: 'services/authPremiumUi.js' }
    );
    return { premiumUi: context.window.BARK.authPremiumUi, elements };
}

test('Honor System mileage control fails closed for free accounts and unlocks for Premium', () => {
    const { premiumUi, elements } = loadPremiumUi();
    const control = elements['manual-miles-premium-control'];
    const input = elements['miles-input'];
    const button = elements['log-manual-miles-btn'];

    input.value = '5';
    premiumUi.applyPremiumGating(false);

    assert.equal(control.classList.contains('premium-locked'), true);
    assert.equal(input.disabled, true);
    assert.equal(input.value, '');
    assert.equal(input.getAttribute('aria-disabled'), 'true');
    assert.equal(button.disabled, false, 'locked button remains clickable to explain Premium');
    assert.equal(button.getAttribute('aria-disabled'), 'true');
    assert.equal(button.textContent, '🔒 Premium');

    premiumUi.applyPremiumGating(true);

    assert.equal(control.classList.contains('premium-unlocked'), true);
    assert.equal(input.disabled, false);
    assert.equal(input.getAttribute('aria-disabled'), 'false');
    assert.equal(button.getAttribute('aria-disabled'), 'false');
    assert.equal(button.textContent, 'Add');
});
