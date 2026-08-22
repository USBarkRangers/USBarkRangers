const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createClassList(element) {
    const readClasses = () => new Set(String(element.className || '').split(/\s+/).filter(Boolean));
    const writeClasses = classes => {
        element.className = Array.from(classes).join(' ');
    };

    return {
        add(...names) {
            const classes = readClasses();
            names.forEach(name => classes.add(name));
            writeClasses(classes);
        },
        remove(...names) {
            const classes = readClasses();
            names.forEach(name => classes.delete(name));
            writeClasses(classes);
        },
        toggle(name, force) {
            const classes = readClasses();
            const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
            if (shouldAdd) classes.add(name);
            else classes.delete(name);
            writeClasses(classes);
            return shouldAdd;
        },
        contains(name) {
            return readClasses().has(name);
        }
    };
}

function createStyle() {
    return {
        cssText: '',
        setProperty(name, value) {
            this[name] = value;
        }
    };
}

function createElement(tagName = 'div') {
    const listeners = {};
    const element = {
        tagName: String(tagName).toUpperCase(),
        id: '',
        className: '',
        children: [],
        parentElement: null,
        dataset: {},
        attributes: {},
        style: createStyle(),
        textContent: '',
        value: '',
        disabled: false,
        scrollLeft: 0,
        clientWidth: 320,
        appendChild(child) {
            child.parentElement = this;
            this.children.push(child);
            return child;
        },
        insertBefore(child, reference) {
            child.parentElement = this;
            const index = this.children.indexOf(reference);
            if (index === -1) this.children.push(child);
            else this.children.splice(index, 0, child);
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
            this.focused = true;
        },
        select() {
            this.selected = true;
        },
        scrollIntoView() {
            this.scrolled = true;
        },
        click() {
            this.clickCount = (this.clickCount || 0) + 1;
            if (typeof this.onclick === 'function') this.onclick({ currentTarget: this, target: this });
        },
        scrollTo(options) {
            this.scrollLeft = options && Number.isFinite(Number(options.left)) ? Number(options.left) : 0;
        },
        contains(node) {
            return this.children.includes(node);
        }
    };
    element.classList = createClassList(element);
    Object.defineProperty(element, 'innerHTML', {
        get() {
            return this._innerHTML || '';
        },
        set(value) {
            this._innerHTML = String(value || '');
            this.children = [];
        }
    });
    return element;
}

function findByClass(root, className) {
    const found = [];
    const visit = (node) => {
        if (!node) return;
        if (node.classList && node.classList.contains(className)) found.push(node);
        (node.children || []).forEach(visit);
    };
    visit(root);
    return found;
}

function directChildrenByClass(root, className) {
    return (root.children || []).filter(child => child.classList && child.classList.contains(className));
}

function getTextContent(root) {
    if (!root) return '';
    return `${root.textContent || ''}${root._innerHTML || ''}${(root.children || []).map(getTextContent).join('')}`;
}

async function flushPromises(count = 6) {
    for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function loadTripPlanner(options = {}) {
    const elements = new Map();
    const byId = id => {
        if (!elements.has(id)) {
            const element = createElement(id === 'trip-queue-list' ? 'ul' : id === 'park-search' ? 'input' : 'div');
            element.id = id;
            elements.set(id, element);
        }
        return elements.get(id);
    };

    const wrapper = byId('itinerary-timeline-wrapper');
    wrapper.appendChild(byId('ui-start-node'));
    wrapper.appendChild(byId('trip-day-tabs'));
    wrapper.appendChild(byId('day-management-bar'));
    wrapper.appendChild(byId('trip-queue-list'));
    wrapper.appendChild(byId('ui-end-node'));
    byId('route-generation-choice-modal').style.display = 'none';
    byId('route-optimize-generate-btn');
    byId('route-skip-generate-btn');
    byId('route-generation-choice-cancel-btn');
    byId('route-generation-choice-close-btn');
    const mapNav = createElement('button');
    const timers = [];
    const timerMode = options.timerMode || 'immediate';
    const openedUrls = [];
    const routedDayCoverage = [];
    const routedSegmentCoverage = [];

    const pendingDirections = [];
    const directionsCalls = [];

    const context = {
        window: {
            BARK: {
                DAY_COLORS: ['#1976D2', '#2E7D32', '#E65100', '#6A1B9A', '#C62828'],
                tripDays: [{ color: '#1976D2', stops: [], notes: '' }],
                activeDayIdx: 0,
                services: {
                    premium: {
                        isPremium: () => true,
                        subscribe: () => {}
                    },
                    ors: {
                        directions: (coordinates, requestOptions) => {
                            directionsCalls.push({ coordinates, requestOptions });
                            return new Promise((resolve, reject) => {
                                pendingDirections.push({ coordinates, resolve, reject });
                            });
                        }
                    }
                },
                DOM: {
                    tripActionToast: () => byId('trip-action-toast'),
                    plannerBadge: () => byId('planner-badge'),
                    tripQueueList: () => byId('trip-queue-list'),
                    tripDayTabs: () => byId('trip-day-tabs'),
                    uiStartNode: () => byId('ui-start-node'),
                    uiEndNode: () => byId('ui-end-node'),
                    itineraryTimelineWrapper: () => byId('itinerary-timeline-wrapper'),
                    dayManagementBar: () => byId('day-management-bar'),
                    dayNotesContainer: () => byId('day-notes-container'),
                    dayNotesTextarea: () => byId('day-notes-textarea'),
                    charCount: () => byId('char-count'),
                    clearTripBtn: () => byId('clear-trip-btn'),
                    startRouteBtn: () => byId('start-route-btn'),
                    saveRouteBtn: () => byId('save-route-btn'),
                    optimizeTripBtn: () => byId('optimize-trip-btn'),
                    tripNameInput: () => byId('tripNameInput'),
                    routeTelemetry: () => byId('route-telemetry'),
                    parkSearch: () => byId('park-search'),
                    inlineInput: type => byId(`inline-${type}-input`),
                    inlineSuggest: type => byId(`inline-suggest-${type}`),
                    optimizerModal: () => byId('optimizer-modal'),
                    optMaxStops: () => ({ value: '5' }),
                    optMaxHours: () => ({ value: '4' })
                },
                tripLayer: {
                    sync() {
                        return { added: new Set(), removed: new Set() };
                    },
                    clear() {
                        return { added: new Set(), removed: new Set() };
                    },
                    setRoutedSegmentKeys(segmentKeys) {
                        const keys = Array.from(segmentKeys).sort();
                        const dayIndexes = keys
                            .map(key => /^day:(\d+)\|/.exec(key))
                            .filter(Boolean)
                            .map(match => Number(match[1]));
                        routedSegmentCoverage.push(keys);
                        routedDayCoverage.push(Array.from(new Set(dayIndexes)).sort((a, b) => a - b));
                    }
                },
                haversineDistance: options.haversineDistance || (() => 1),
                incrementRequestCount() {}
            },
            tripStartNode: null,
            tripEndNode: null,
            isTripEditMode: false,
            open: (url, target) => openedUrls.push({ url, target })
        },
        document: {
            body: createElement('body'),
            activeElement: null,
            createElement,
            createTextNode: text => ({ textContent: String(text || ''), children: [] }),
            getElementById: id => elements.get(id) || null,
            querySelector: selector => (
                selector === '.nav-item[data-target="map-view"]' || selector === '[data-target="map-view"]'
                    ? mapNav
                    : null
            ),
            querySelectorAll: () => []
        },
        firebase: {
            auth: () => ({ currentUser: { uid: 'test-user' } })
        },
        L: {
            geoJSON() {
                return {
                    addTo() {
                        return this;
                    },
                    getBounds() {
                        return {
                            extend() {
                                return this;
                            }
                        };
                    },
                    setStyle(style) {
                        this.style = { ...(this.style || {}), ...style };
                    }
                };
            }
        },
        map: {
            fitBounds() {
                this.fitBoundsCalled = true;
            }
        },
        console,
        alert() {},
        confirm: () => true,
        setTimeout: (callback) => {
            if (timerMode === 'manual') {
                timers.push(callback);
                return timers.length;
            }
            callback();
            return 1;
        },
        clearTimeout() {},
        requestAnimationFrame: (callback) => callback(),
        Date
    };
    context.window.window = context.window;

    ['tripRoutePlan.js', 'tripRouteBatch.js', 'tripPlannerCore.js'].forEach(fileName => {
        const source = fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'engines', fileName), 'utf8');
        vm.runInNewContext(source, context, { filename: `engines/${fileName}` });
    });

    return {
        window: context.window,
        element: byId,
        findByClass,
        directChildrenByClass,
        getTextContent,
        mapNav,
        runTimers: () => {
            timers.splice(0).forEach(callback => callback());
        },
        directionsCalls,
        routedDayCoverage,
        routedSegmentCoverage,
        openedUrls,
        resolveDirections: (response) => {
            const pending = pendingDirections.shift();
            if (!pending) throw new Error('Directions call has not started.');
            const coordinates = pending.coordinates;
            const legCount = Math.max(1, coordinates.length - 1);
            pending.resolve(response || {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates },
                    properties: {
                        summary: {
                            distance: 1609.344,
                            duration: 3600
                        },
                        segments: Array.from({ length: coordinates.length - 1 }, (_, index) => ({
                            distance: 1609.344 / legCount,
                            duration: 3600 / legCount,
                            steps: [{ way_points: [index, index + 1] }]
                        }))
                    }
                }]
            });
        },
        rejectDirections: (error = new Error('Route failed')) => {
            const pending = pendingDirections.shift();
            if (!pending) throw new Error('Directions call has not started.');
            pending.reject(error);
        }
    };
}

function makeDays(count) {
    return Array.from({ length: count }, (_, index) => ({
        color: ['#1976D2', '#2E7D32', '#E65100', '#6A1B9A', '#C62828'][index % 5],
        stops: [{ name: `Stop ${index + 1}`, lat: index, lng: index }],
        notes: ''
    }));
}

async function openRouteChoiceAndSkip(harness) {
    harness.element('start-route-btn').onclick();
    assert.equal(harness.element('route-generation-choice-modal').style.display, 'flex');
    harness.element('route-skip-generate-btn').onclick();
    await Promise.resolve();
}

test('trip day selector pages days after the first nine', () => {
    const harness = loadTripPlanner();
    harness.window.BARK.tripDays = makeDays(15);
    harness.window.BARK.activeDayIdx = 14;

    harness.window.BARK.updateTripUI();

    const tabs = harness.element('trip-day-tabs');
    assert.equal(tabs.dataset.pageCount, '2');
    assert.equal(tabs.classList.contains('trip-day-tabs-paged'), true);

    const pages = harness.findByClass(tabs, 'trip-day-page');
    assert.equal(pages.length, 2);
    assert.equal(harness.directChildrenByClass(pages[0], 'trip-day-tab').length, 9);
    assert.equal(harness.directChildrenByClass(pages[1], 'trip-day-tab').length, 7);

    const activeTabs = harness.findByClass(tabs, 'active')
        .filter(element => element.classList.contains('trip-day-tab'));
    assert.equal(activeTabs.length, 1);
    assert.match(harness.getTextContent(activeTabs[0]), /Day 15/);
    assert.equal(harness.findByClass(tabs, 'trip-day-add-btn').length, 1);
});

test('trip planner enforces the 50 day limit for insert and automatic day creation', () => {
    const harness = loadTripPlanner();
    harness.window.BARK.tripDays = makeDays(50);
    harness.window.BARK.activeDayIdx = 49;
    harness.window.BARK.tripDays[49].stops = Array.from({ length: 10 }, (_, index) => ({
        name: `Full day stop ${index}`,
        lat: 100 + index,
        lng: 100 + index
    }));

    harness.window.BARK.updateTripUI();
    assert.equal(harness.findByClass(harness.element('trip-day-tabs'), 'trip-day-add-btn').length, 0);

    harness.window.insertDayAfter();
    assert.equal(harness.window.BARK.tripDays.length, 50);

    const added = harness.window.addStopToTrip({ name: 'Overflow stop', lat: 999, lng: 999 });
    assert.equal(added, false);
    assert.equal(harness.window.BARK.tripDays.length, 50);
    assert.equal(harness.window.BARK.tripDays[49].stops.length, 10);
});

test('add stop action opens map tab and focuses the search input for the active day', () => {
    const harness = loadTripPlanner();
    harness.window.BARK.tripDays = makeDays(10);
    harness.window.BARK.activeDayIdx = 9;

    harness.window.BARK.updateTripUI();

    const ghostButton = harness.element('trip-queue-list').children
        .find(child => harness.getTextContent(child).includes('Add Stop to Day 10'));
    assert.ok(ghostButton, 'expected Add Stop to Day 10 control to render');

    ghostButton.onclick();

    const searchInput = harness.element('park-search');
    assert.equal(harness.mapNav.clickCount, 1);
    assert.equal(searchInput.focused, true);
    assert.equal(searchInput.selected, true);
    assert.equal(searchInput.scrolled, true);
    assert.match(searchInput.placeholder, /Day 10/);
});

test('bookend suggestions survive touch blur so their click can land', () => {
    const harness = loadTripPlanner();
    harness.window.editBookend('start');

    const input = harness.element('inline-start-input');
    const suggestions = harness.element('inline-suggest-start');
    const option = createElement('div');
    suggestions.appendChild(option);
    suggestions.style.display = 'block';

    input.dispatchEvent({ type: 'blur', relatedTarget: null });
    assert.equal(suggestions.style.display, 'block', 'touch blur must not remove options before click');

    input.dispatchEvent({ type: 'blur', relatedTarget: option });
    assert.equal(suggestions.style.display, 'block', 'focusing an option must keep its dropdown open');

    input.dispatchEvent({ type: 'blur', relatedTarget: createElement('button') });
    assert.equal(suggestions.style.display, 'none', 'keyboard focus leaving the search should close options');
});

test('route generation shows progress on the route button before completion', async () => {
    const harness = loadTripPlanner({ timerMode: 'manual' });
    harness.window.BARK.tripDays = [{
        color: '#1976D2',
        stops: [
            { name: 'Stop A', lat: 1, lng: 1 },
            { name: 'Stop B', lat: 2, lng: 2 }
        ],
        notes: ''
    }];
    harness.window.BARK.activeDayIdx = 0;
    harness.window.BARK.initTripPlanner();
    harness.window.BARK.updateTripUI();

    await openRouteChoiceAndSkip(harness);

    assert.equal(harness.element('route-telemetry').style.display, 'none');
    assert.equal(harness.element('start-route-btn').dataset.routeStatus, 'working');
    assert.match(harness.getTextContent(harness.element('start-route-btn')), /Generating Route/);
    assert.match(harness.getTextContent(harness.element('start-route-btn')), /1 \/ 1/);

    harness.runTimers();
    assert.equal(harness.element('start-route-btn').dataset.routeStatus, 'slow');
    assert.match(harness.getTextContent(harness.element('start-route-btn')), /Still Generating/);
    assert.match(harness.getTextContent(harness.element('start-route-btn')), /A few min/);

    harness.resolveDirections();
    await flushPromises();

    assert.equal(harness.element('route-telemetry').style.display, 'none');
    assert.equal(harness.element('start-route-btn').dataset.routeStatus, 'complete');
    assert.match(harness.getTextContent(harness.element('start-route-btn')), /Route Ready/);
    assert.match(harness.getTextContent(harness.element('start-route-btn')), /1.0 mi/);
});

test('generated route coverage survives UI refresh and preserves unchanged connections', async () => {
    const harness = loadTripPlanner();
    harness.window.BARK.tripDays = [{
        color: '#1976D2',
        stops: [
            { name: 'Stop A', lat: 1, lng: 1 },
            { name: 'Stop B', lat: 2, lng: 2 }
        ],
        notes: ''
    }];
    harness.window.BARK.initTripPlanner();
    harness.window.BARK.updateTripUI();

    await openRouteChoiceAndSkip(harness);
    harness.resolveDirections();
    await flushPromises(12);
    assert.deepEqual(harness.routedDayCoverage.at(-1), [0]);
    const originalSegmentKeys = harness.routedSegmentCoverage.at(-1);
    assert.equal(originalSegmentKeys.length, 1);

    harness.window.toggleTripEditMode();
    assert.deepEqual(harness.routedDayCoverage.at(-1), [0], 'UI-only refresh must preserve route coverage');

    harness.window.BARK.tripDays[0].notes = 'Lunch stop';
    harness.window.BARK.updateTripUI();
    assert.deepEqual(harness.routedDayCoverage.at(-1), [0], 'notes must not invalidate driving geometry');

    harness.window.BARK.tripDays[0].stops.push({ name: 'Stop C', lat: 3, lng: 3 });
    harness.window.BARK.updateTripUI();
    assert.deepEqual(
        harness.routedSegmentCoverage.at(-1),
        originalSegmentKeys,
        'the existing A-to-B road segment must remain while the new B-to-C connection uses a fallback'
    );
});

test('changing one day preserves every unaffected generated day route', async () => {
    const harness = loadTripPlanner();
    harness.window.BARK.tripDays = [
        {
            color: '#1976D2',
            stops: [
                { name: 'Day 1 Start', lat: 0, lng: 0 },
                { name: 'Day 1 Middle', lat: 0, lng: 1 },
                { name: 'Day 1 Handoff', lat: 0, lng: 2 }
            ],
            notes: ''
        },
        {
            color: '#2E7D32',
            stops: [
                { name: 'Day 2 Middle', lat: 0, lng: 3 },
                { name: 'Day 2 End', lat: 0, lng: 4 }
            ],
            notes: ''
        }
    ];
    harness.window.BARK.initTripPlanner();
    harness.window.BARK.updateTripUI();

    await openRouteChoiceAndSkip(harness);
    harness.resolveDirections();
    await flushPromises(12);
    assert.deepEqual(harness.routedDayCoverage.at(-1), [0, 1]);
    const originalSegmentKeys = harness.routedSegmentCoverage.at(-1);

    harness.window.BARK.tripDays[0].stops[1] = {
        name: 'Moved Day 1 Middle',
        lat: 1,
        lng: 1
    };
    harness.window.BARK.updateTripUI();

    const remainingSegmentKeys = harness.routedSegmentCoverage.at(-1);
    assert.deepEqual(remainingSegmentKeys, originalSegmentKeys.filter(key => key.startsWith('day:1|')));
});

test('partial route generation leaves a straight fallback only for failed days', async () => {
    const harness = loadTripPlanner();
    harness.window.BARK.tripDays = [
        {
            color: '#1976D2',
            stops: [
                { name: 'Day 1 Start', lat: 0, lng: 0 },
                { name: 'Day 1 End', lat: 0, lng: 1 }
            ],
            notes: ''
        },
        {
            color: '#2E7D32',
            stops: [
                { name: 'Day 2 Start', lat: 50, lng: 100 },
                { name: 'Day 2 End', lat: 50, lng: 101 }
            ],
            notes: ''
        }
    ];
    harness.window.BARK.initTripPlanner();
    harness.window.BARK.updateTripUI();

    await openRouteChoiceAndSkip(harness);
    assert.equal(harness.directionsCalls.length, 1);
    harness.resolveDirections();
    await flushPromises(12);
    assert.equal(harness.directionsCalls.length, 2, 'distant days should use separate route batches');

    harness.rejectDirections(new Error('Second route batch failed'));
    await flushPromises(12);

    assert.deepEqual(harness.routedDayCoverage.at(-1), [0]);
});

test('route generation choice can optimize before generating', async () => {
    const harness = loadTripPlanner();
    harness.window.BARK.tripDays = [{
        color: '#1976D2',
        stops: [
            { name: 'Stop A', lat: 1, lng: 1 },
            { name: 'Stop B', lat: 2, lng: 2 }
        ],
        notes: ''
    }];
    harness.window.BARK.activeDayIdx = 0;
    harness.window.BARK.initTripPlanner();
    harness.window.BARK.updateTripUI();

    let optimizeCalls = 0;
    const originalOptimize = harness.window.executeSmartOptimization;
    harness.window.executeSmartOptimization = function wrappedSmartOptimization() {
        optimizeCalls += 1;
        return originalOptimize();
    };

    harness.element('start-route-btn').onclick();
    assert.equal(harness.element('route-generation-choice-modal').style.display, 'flex');
    harness.element('route-optimize-generate-btn').onclick();
    await flushPromises();

    assert.equal(optimizeCalls, 1);
    assert.equal(harness.element('route-generation-choice-modal').style.display, 'none');
    assert.equal(harness.directionsCalls.length, 1);
});

test('trip planner estimates long route days before calling directions', () => {
    const harness = loadTripPlanner({ haversineDistance: () => 2000 });

    const warnings = harness.window.BARK.getLongRouteDayWarnings([{
        originalIndex: 2,
        dayStops: [
            { name: 'Start', lat: 0, lng: 0 },
            { name: 'Finish', lat: 1, lng: 1 }
        ]
    }]);

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].dayNumber, 3);
    assert.ok(warnings[0].estimatedMiles > 1000);
});

test('route generation opens optimizer and skips ORS when a day is too long', async () => {
    const harness = loadTripPlanner({ haversineDistance: () => 2000, timerMode: 'manual' });
    const warningsSeen = [];
    harness.window.BARK.confirmLongRouteWarning = async (warnings) => {
        warningsSeen.push(...warnings);
        return 'optimize';
    };
    harness.window.BARK.tripDays = [{
        color: '#1976D2',
        stops: [
            { name: 'Stop A', lat: 1, lng: 1 },
            { name: 'Stop B', lat: 2, lng: 2 }
        ],
        notes: ''
    }];

    harness.window.BARK.initTripPlanner();
    harness.window.BARK.updateTripUI();
    await openRouteChoiceAndSkip(harness);
    await flushPromises();

    assert.equal(warningsSeen.length, 1);
    assert.equal(harness.directionsCalls.length, 0);
    assert.equal(harness.element('optimizer-modal').style.display, 'flex');
    assert.equal(harness.element('route-telemetry').style.display, 'none');
    assert.equal(harness.element('start-route-btn').dataset.routeStatus, 'warning');
    assert.match(harness.getTextContent(harness.element('start-route-btn')), /Day Too Long/);
    assert.match(harness.getTextContent(harness.element('start-route-btn')), /Optimize first/);
});

test('route generation can continue after long day warning', async () => {
    const harness = loadTripPlanner({ haversineDistance: () => 2000 });
    harness.window.BARK.confirmLongRouteWarning = async () => 'continue';
    harness.window.BARK.tripDays = [{
        color: '#1976D2',
        stops: [
            { name: 'Stop A', lat: 1, lng: 1 },
            { name: 'Stop B', lat: 2, lng: 2 }
        ],
        notes: ''
    }];

    harness.window.BARK.initTripPlanner();
    harness.window.BARK.updateTripUI();
    await openRouteChoiceAndSkip(harness);
    await flushPromises();

    assert.equal(harness.directionsCalls.length, 1);
    harness.resolveDirections();
    await flushPromises();
});

test('removing a duplicate stop targets its exact day occurrence', () => {
    const harness = loadTripPlanner();
    const shared = { id: 'same-park', name: 'Same Park', lat: 1, lng: 1 };
    harness.window.BARK.tripDays = [
        { color: '#1976D2', stops: [{ ...shared }], notes: '' },
        { color: '#2E7D32', stops: [{ ...shared }], notes: '' }
    ];

    const removed = harness.window.BARK.removeTripStopAt(1, 0, { showToast: false });

    assert.equal(removed, true);
    assert.equal(harness.window.BARK.tripDays[0].stops.length, 1);
    assert.equal(harness.window.BARK.tripDays[1].stops.length, 0);
});

test('Google Maps exports the exact points from the shared route plan', () => {
    const harness = loadTripPlanner();
    harness.window.BARK.tripDays = [
        { color: '#1976D2', stops: [{ name: 'First', lat: 1, lng: 1 }], notes: '' },
        { color: '#2E7D32', stops: [], notes: '' },
        { color: '#E65100', stops: [{ name: 'Later', lat: 2, lng: 2 }], notes: '' }
    ];
    harness.window.tripStartNode = { name: 'Start', lat: 0, lng: 0 };
    harness.window.tripEndNode = { name: 'End', lat: 3, lng: 3 };
    const expected = harness.window.BARK.buildTripRoutePlan({
        tripDays: harness.window.BARK.tripDays,
        startNode: harness.window.tripStartNode,
        endNode: harness.window.tripEndNode
    }).getDay(2).points.map(point => `${point.lat},${point.lng}`);

    harness.window.exportDayToMaps(2);

    assert.equal(harness.openedUrls.length, 1);
    assert.equal(harness.openedUrls[0].url, `https://www.google.com/maps/dir/${expected.join('/')}`);
    assert.equal(harness.openedUrls[0].target, '_blank');
});

test('multi-day route generation makes one batched call across an empty day', async () => {
    const harness = loadTripPlanner({ timerMode: 'manual' });
    harness.window.BARK.tripDays = [
        { color: '#1976D2', stops: [{ name: 'First', lat: 1, lng: 1 }], notes: '' },
        { color: '#2E7D32', stops: [], notes: '' },
        { color: '#E65100', stops: [{ name: 'Later', lat: 2, lng: 2 }], notes: '' }
    ];
    harness.window.tripStartNode = { name: 'Start', lat: 0, lng: 0 };
    harness.window.tripEndNode = { name: 'End', lat: 3, lng: 3 };
    harness.window.BARK.initTripPlanner();
    harness.window.BARK.updateTripUI();

    await openRouteChoiceAndSkip(harness);

    assert.equal(harness.directionsCalls.length, 1);
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.directionsCalls[0].coordinates)),
        [[0, 0], [1, 1], [2, 2], [3, 3]]
    );
    harness.resolveDirections();
    await flushPromises(16);
    assert.equal(harness.element('start-route-btn').dataset.routeStatus, 'complete');
});
