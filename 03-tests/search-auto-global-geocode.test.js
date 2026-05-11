const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createStyle() {
    return {
        cssText: '',
        display: '',
        setProperty(name, value) {
            this[name] = value;
        }
    };
}

function getTextContent(root) {
    if (!root) return '';
    return `${root.textContent || ''}${root._innerHTML || ''}${(root.children || []).map(getTextContent).join('')}`;
}

function createElement(tagName = 'div', documentRef = null) {
    const listeners = {};
    const element = {
        tagName: String(tagName).toUpperCase(),
        id: '',
        className: '',
        children: [],
        parentElement: null,
        attributes: {},
        style: createStyle(),
        dataset: {},
        textContent: '',
        value: '',
        tabIndex: -1,
        appendChild(child) {
            child.parentElement = this;
            this.children.push(child);
            return child;
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        getAttribute(name) {
            return this.attributes[name];
        },
        addEventListener(type, handler) {
            listeners[type] = listeners[type] || [];
            listeners[type].push(handler);
        },
        dispatchEvent(event) {
            const eventObject = {
                target: this,
                currentTarget: this,
                preventDefault() {},
                stopPropagation() {},
                ...event
            };
            (listeners[eventObject.type] || []).forEach(handler => handler(eventObject));
        },
        focus() {
            if (documentRef) documentRef.activeElement = this;
        },
        contains(node) {
            if (node === this) return true;
            return this.children.some(child => child.contains ? child.contains(node) : child === node);
        }
    };

    Object.defineProperty(element, 'innerHTML', {
        get() {
            return this._innerHTML || (this.children || []).map(getTextContent).join('');
        },
        set(value) {
            this._innerHTML = String(value || '');
            this.children = [];
        }
    });

    return element;
}

function loadSearchEngine({ premium = true, localParks = [] } = {}) {
    const elements = new Map();
    const documentRef = {
        activeElement: null,
        body: null,
        createElement: tagName => createElement(tagName, documentRef),
        getElementById: id => elements.get(id) || null,
        querySelectorAll: () => [],
        addEventListener() {}
    };
    documentRef.body = createElement('body', documentRef);

    const byId = (id, tagName = 'div') => {
        if (!elements.has(id)) {
            const element = createElement(tagName, documentRef);
            element.id = id;
            elements.set(id, element);
        }
        return elements.get(id);
    };

    byId('park-search', 'input');
    byId('clear-search-btn', 'button');
    byId('search-suggestions');
    byId('type-filter', 'select');
    byId('inline-start-input', 'input');
    byId('inline-end-input', 'input');
    byId('inline-suggest-start');
    byId('inline-suggest-end');

    const geocodeCalls = [];
    const context = {
        window: {
            BARK: {
                activeSearchQuery: '',
                activeTypeFilter: 'all',
                activeSwagFilters: new Set(),
                normalizationDict: {},
                repos: {
                    ParkRepo: {
                        getAll: () => localParks
                    }
                },
                services: {
                    premium: {
                        isPremium: () => premium
                    },
                    ors: {
                        geocode: async (query, options) => {
                            geocodeCalls.push({ query, options });
                            return {
                                features: [{
                                    geometry: { coordinates: [-86.7816, 36.1627] },
                                    properties: { label: `Stubbed town for ${query}` }
                                }]
                            };
                        }
                    }
                },
                DOM: {
                    parkSearch: () => byId('park-search', 'input'),
                    clearSearchBtn: () => byId('clear-search-btn', 'button'),
                    searchSuggestions: () => byId('search-suggestions'),
                    typeFilter: () => byId('type-filter', 'select'),
                    inlineInput: type => byId(`inline-${type}-input`, 'input'),
                    inlineSuggest: type => byId(`inline-suggest-${type}`)
                },
                incrementRequestCount() {}
            },
            syncState() {},
            lowGfxEnabled: false
        },
        document: documentRef,
        firebase: {
            auth: () => ({ currentUser: { uid: 'test-user' } })
        },
        navigator: {
            geolocation: {
                getCurrentPosition() {}
            }
        },
        console,
        alert() {},
        setTimeout: callback => {
            callback();
            return 1;
        },
        clearTimeout() {},
        Date,
        performance: {
            now: () => Date.now()
        }
    };
    context.window.window = context.window;

    const source = fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'modules', 'searchEngine.js'), 'utf8');
    vm.runInNewContext(source, context, { filename: 'modules/searchEngine.js' });

    return {
        window: context.window,
        element: byId,
        document: documentRef,
        geocodeCalls,
        text: element => getTextContent(element)
    };
}

async function flushPromises(count = 8) {
    for (let index = 0; index < count; index += 1) await Promise.resolve();
}

test('premium map search auto-runs global town lookup when local parks have no matches', async () => {
    const harness = loadSearchEngine({ premium: true, localParks: [] });
    harness.window.BARK.initSearchEngine();

    const input = harness.element('park-search', 'input');
    input.value = 'Nowhereville';
    input.dispatchEvent({ type: 'input', target: input });
    await flushPromises();

    const suggestions = harness.element('search-suggestions');
    assert.equal(harness.geocodeCalls.length, 1);
    assert.equal(harness.geocodeCalls[0].query, 'Nowhereville');
    assert.equal(suggestions.style.display, 'block');
    assert.match(harness.text(suggestions), /SELECT FOR ADD STOP/);
    assert.match(harness.text(suggestions), /Stubbed town for Nowhereville/);

    input.value = 'Nowhereville';
    input.dispatchEvent({ type: 'input', target: input });
    await flushPromises();
    assert.equal(harness.geocodeCalls.length, 1, 'cached repeat query should not call geocode again');
});

test('free map search keeps global town lookup locked and does not call geocode', async () => {
    const harness = loadSearchEngine({ premium: false, localParks: [] });
    harness.window.BARK.initSearchEngine();

    const input = harness.element('park-search', 'input');
    input.value = 'Nowhereville';
    input.dispatchEvent({ type: 'input', target: input });
    await flushPromises();

    const suggestions = harness.element('search-suggestions');
    assert.equal(harness.geocodeCalls.length, 0);
    assert.equal(suggestions.style.display, 'block');
    assert.match(harness.text(suggestions), /Search global towns/);
});

test('premium inline trip start search auto-runs global lookup when no parks match', async () => {
    const harness = loadSearchEngine({ premium: true, localParks: [] });
    const input = harness.element('inline-start-input', 'input');
    input.value = 'Trail Town';
    input.focus();

    harness.window.BARK.runInlinePlannerSearch('start');
    await flushPromises();

    const suggestions = harness.element('inline-suggest-start');
    assert.equal(harness.geocodeCalls.length, 1);
    assert.equal(harness.geocodeCalls[0].query, 'Trail Town');
    assert.equal(suggestions.style.display, 'block');
    assert.match(harness.text(suggestions), /SELECT FOR TRIP START/);
    assert.match(harness.text(suggestions), /Stubbed town for Trail Town/);
});
