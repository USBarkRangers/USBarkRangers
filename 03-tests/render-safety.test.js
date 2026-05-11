const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function createFakeElement() {
    return {
        childNodes: [],
        appendChild(node) {
            this.childNodes.push(node);
            return node;
        },
        removeChild(node) {
            const index = this.childNodes.indexOf(node);
            if (index >= 0) this.childNodes.splice(index, 1);
            return node;
        },
        get firstChild() {
            return this.childNodes[0] || null;
        },
        get textContent() {
            return this.childNodes.map(node => node.textContent || '').join('');
        },
        get innerHTML() {
            return this.childNodes.map(node => {
                if (node.tagName === 'BR') return '<br>';
                return String(node.textContent || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
            }).join('');
        }
    };
}

function loadPanelRendererSafety() {
    const alertMessages = [];
    const paywallCalls = [];
    const context = {
        URL,
        alert(message) {
            alertMessages.push(String(message));
        },
        window: {
            BARK: {
                paywall: {
                    openPaywall(payload) {
                        paywallCalls.push(payload);
                    }
                }
            }
        },
        document: {
            createElement(tagName) {
                return { tagName: String(tagName).toUpperCase(), textContent: '' };
            },
            createTextNode(text) {
                return { textContent: String(text) };
            },
            querySelector() {
                return null;
            }
        },
        __alerts: alertMessages,
        __paywallCalls: paywallCalls
    };
    vm.runInNewContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'renderers', 'panelRenderer.js'), 'utf8'), context);
    return {
        ...context.window.BARK.panelRendererSafety,
        alertMessages,
        paywallCalls,
        context
    };
}

function loadRenderEngineHelpers() {
    const context = {
        URL,
        window: { BARK: {} }
    };
    vm.runInNewContext(fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'modules', 'renderEngine.js'), 'utf8'), context);
    return context.window.BARK;
}

test('marker panel info text is rendered as text with line breaks, not executable HTML', () => {
    const safety = loadPanelRendererSafety();
    const element = createFakeElement();

    safety.setTextWithLineBreaks(element, '<img src=x onerror=alert(1)>\nsecond line');

    assert.equal(element.textContent, '<img src=x onerror=alert(1)>second line');
    assert.equal(element.innerHTML, '&lt;img src=x onerror=alert(1)&gt;<br>second line');
});

test('marker panel URL extraction accepts only safe http links', () => {
    const safety = loadPanelRendererSafety();
    const urls = safety.getSafeHttpUrls('javascript:alert(1) https://example.test/path", ftp://bad.test https://ok.test/a?b=1');

    assert.deepEqual(urls, [
        'https://example.test/path',
        'https://ok.test/a?b=1'
    ]);
});

test('free visit limit uses premium paywall modal instead of browser alert when available', () => {
    const safety = loadPanelRendererSafety();

    const opened = safety.openFreeVisitLimitPaywall({ limit: 5 });

    assert.equal(opened, true);
    assert.deepEqual(safety.paywallCalls, [{ source: 'visited-place-limit' }]);
    assert.deepEqual(safety.alertMessages, []);
});

test('free visit limit keeps a readable fallback alert if paywall is unavailable', () => {
    const safety = loadPanelRendererSafety();
    safety.context.window.BARK.paywall = null;

    const opened = safety.openFreeVisitLimitPaywall({ limit: 5 });

    assert.equal(opened, false);
    assert.equal(safety.paywallCalls.length, 0);
    assert.match(safety.alertMessages[0], /Adding more than 5 parks is a Premium feature/);
});

test('swag link formatter validates URLs and adds noopener rel', () => {
    const bark = loadRenderEngineHelpers();
    const html = bark.formatSwagLinks('https://example.test/" onclick="alert(1) javascript:alert(1)');

    assert.match(html, /href="https:\/\/example\.test\/"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.doesNotMatch(html, /onclick|javascript:/);
});

test('panel renderer no longer assigns sheet fields directly through innerHTML', () => {
    const source = fs.readFileSync(path.join(repoRoot, '01-code', 'app', 'renderers', 'panelRenderer.js'), 'utf8');

    assert.doesNotMatch(source, /infoEl\.innerHTML\s*=\s*d\.info/);
    assert.doesNotMatch(source, /picsEl\.innerHTML\s*=\s*formattedPics/);
    assert.doesNotMatch(source, /websitesContainer\.innerHTML\s*=\s*`/);
});
