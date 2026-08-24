const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', '01-code', 'app', 'modules', 'rateLimitUi.js'),
    'utf8'
);

function loadRateLimitUi() {
    function createElement(tagName) {
        const classes = new Set();
        return {
            tagName,
            id: '',
            hidden: false,
            textContent: '',
            dataset: {},
            children: [],
            className: '',
            attributes: {},
            classList: {
                add(value) { classes.add(value); },
                remove(value) { classes.delete(value); },
                contains(value) { return classes.has(value); }
            },
            setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(name, handler) { this[`on${name}`] = handler; },
            appendChild(child) { this.children.push(child); return child; },
            querySelector(selector) {
                const className = selector.startsWith('.') ? selector.slice(1) : null;
                const queue = [...this.children];
                while (queue.length) {
                    const child = queue.shift();
                    if (className && String(child.className).split(/\s+/).includes(className)) return child;
                    queue.push(...child.children);
                }
                return null;
            }
        };
    }
    const body = createElement('body');
    const document = {
        body,
        createElement,
        getElementById(id) {
            const queue = [body];
            while (queue.length) {
                const item = queue.shift();
                if (item.id === id) return item;
                queue.push(...item.children);
            }
            return null;
        }
    };
    const window = { BARK: {}, document, requestAnimationFrame(callback) { callback(); } };
    vm.runInNewContext(source, { window, Date }, { filename: 'modules/rateLimitUi.js' });
    return { api: window.BARK.rateLimitUi, document };
}

test('rate-limit UI formats the server reset in local time with the bot warning', () => {
    const { api } = loadRateLimitUi();
    const message = api.getRateLimitWarning({
        code: 'functions/resource-exhausted',
        details: { action: 'createCheckoutSession', retryAt: '2026-08-24T21:42:00.000Z' }
    });

    assert.match(message, /^Are you a bot\? Rate limit resets at /);
    assert.match(message, /\.$/);
    assert.doesNotMatch(message, /2026-08-24T21:42/);
});

test('rate-limit UI renders a non-blocking panel and deduplicates one reset warning', () => {
    const { api, document } = loadRateLimitUi();
    const error = {
        code: 'resource-exhausted',
        details: { action: 'getPremiumRoute', retryAt: '2026-08-24T21:42:00.000Z' }
    };

    assert.equal(api.showRateLimitWarning(new Error('ordinary failure')), false);
    assert.equal(api.showRateLimitWarning(error), true);
    assert.equal(api.showRateLimitWarning(error), true);
    const panel = document.getElementById('rate-limit-warning');
    assert.ok(panel);
    assert.equal(panel.hidden, false);
    assert.equal(panel.classList.contains('show'), true);
    assert.match(panel.querySelector('.rate-limit-warning__message').textContent, /Are you a bot\?/);
    assert.equal(source.includes('window.alert'), false);
});

test('global provider limits use service-busy copy instead of accusing the user', () => {
    const { api } = loadRateLimitUi();
    const message = api.getRateLimitWarning({
        code: 'functions/resource-exhausted',
        details: { action: 'ors-directions', scope: 'global', retryAfterSeconds: 60 }
    });

    assert.match(message, /^This service is unusually busy\./);
    assert.doesNotMatch(message, /Are you a bot\?/);
});
