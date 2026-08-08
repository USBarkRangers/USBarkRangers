const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The picker is the contract between the dialog and the park list: what the
// options are, and what getSelection() hands back for each way of choosing one.
// That is worth pinning even though it takes a DOM stub to reach, because the
// modal trusts the shape of the selection completely.

function createClassList() {
    const classes = new Set();
    return {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        toggle(name, force) {
            if (force === true) classes.add(name);
            else if (force === false) classes.delete(name);
            else if (classes.has(name)) classes.delete(name);
            else classes.add(name);
            return classes.has(name);
        },
        contains: name => classes.has(name)
    };
}

function createElement(tagName = 'div') {
    const listeners = new Map();
    return {
        tagName,
        id: '',
        value: '',
        hidden: false,
        textContent: '',
        className: '',
        dataset: {},
        attributes: {},
        children: [],
        classList: createClassList(),
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(handler);
        },
        emit(type, event = {}) {
            const payload = Object.assign({ preventDefault() {}, stopPropagation() {} }, event);
            (listeners.get(type) || []).forEach(handler => handler(payload));
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
        removeAttribute(name) { delete this.attributes[name]; },
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...next) { this.children = next; },
        scrollIntoView() {}
    };
}

// A park list shaped like ParkRepo's, scored by the real searchEngine contract
// the picker depends on: window.BARK.getLocalParkMatches(query, limit).
const PARKS = [
    { id: 'p1', name: 'Acadia National Park\nHulls Cove Visitor Center', state: 'Maine', swagType: 'Tag' },
    { id: 'p2', name: 'Zion National Park', state: 'Utah', swagType: 'Bandana' }
];

function loadPicker({ matches = PARKS } = {}) {
    const timers = [];
    const context = {
        window: {
            BARK: {
                getLocalParkMatches: (query, limit) => matches.slice(0, limit)
            },
            setTimeout: (fn) => { timers.push(fn); return timers.length; },
            clearTimeout: () => {}
        },
        console
    };
    context.window.window = context.window;
    context.document = { createElement };

    const source = fs.readFileSync(
        path.join(__dirname, '..', '01-code', 'app', 'modules', 'feedbackSubjectPicker.js'),
        'utf8'
    );
    vm.runInNewContext(source, context, { filename: 'modules/feedbackSubjectPicker.js' });

    const input = createElement('input');
    input.id = 'feedback-subject-input';
    const list = createElement('ul');
    list.id = 'feedback-subject-list';
    list.hidden = true;

    const changes = [];
    const picker = context.window.BARK.createFeedbackSubjectPicker({
        input,
        list,
        onChange: (selection) => changes.push(selection)
    });

    // The picker debounces input through setTimeout; run what it queued.
    const flush = () => { while (timers.length) timers.shift()(); };

    return { picker, input, list, changes, flush, BARK: context.window.BARK };
}

test('an empty box offers the two pinned choices and nothing else', () => {
    const { BARK } = loadPicker();
    const options = BARK.buildFeedbackSubjectOptions('');

    assert.equal(options.map(o => o.kind).join(','), 'general,missing');
    assert.equal(options[0].label, 'General feedback');
    assert.equal(options[1].label, 'Add a missing location');
});

test('typing searches parks and keeps a matching pinned choice above them', () => {
    const { BARK } = loadPicker();

    const parkQuery = BARK.buildFeedbackSubjectOptions('acadia');
    assert.equal(parkQuery[0].kind, 'park');
    assert.equal(parkQuery[0].id, 'p1');

    const pinnedQuery = BARK.buildFeedbackSubjectOptions('missing');
    assert.equal(pinnedQuery[0].kind, 'missing');
});

test('a park name carrying an address is flattened to one line', () => {
    const { BARK } = loadPicker();
    const [acadia] = BARK.buildFeedbackSubjectOptions('acadia');

    assert.equal(acadia.label, 'Acadia National Park Hulls Cove Visitor Center, Maine');
    assert.ok(!acadia.label.includes('\n'));
});

test('a park search failure still leaves the pinned choices reachable', () => {
    const { BARK } = loadPicker();
    BARK.getLocalParkMatches = () => { throw new Error('repo not ready'); };

    // A park query has nothing left to offer, but must not throw at the caller.
    assert.equal(BARK.buildFeedbackSubjectOptions('acadia').length, 0);
    // A pinned choice is still selectable, so feedback is never fully blocked.
    assert.equal(BARK.buildFeedbackSubjectOptions('missing')[0].kind, 'missing');
});

test('choosing a park hands the modal its id and a one-line label', () => {
    const { picker, input, list, flush } = loadPicker();

    input.emit('focus');
    input.value = 'acadia';
    input.emit('input');
    flush();

    list.children[0].emit('pointerdown');

    const selection = picker.getSelection();
    assert.equal(selection.kind, 'park');
    assert.equal(selection.id, 'p1');
    assert.equal(selection.label, 'Acadia National Park Hulls Cove Visitor Center, Maine');
    assert.equal(input.value, selection.label);
    assert.equal(picker.isOpen(), false, 'choosing closes the list');
});

test('typed text that matches no park is kept as a free-form subject', () => {
    const { picker, input, flush } = loadPicker({ matches: [] });

    input.emit('focus');
    input.value = 'Some trail we have never heard of';
    input.emit('input');
    flush();

    const selection = picker.getSelection();
    assert.equal(selection.kind, 'freeform');
    assert.equal(selection.id, null);
    assert.equal(selection.label, 'Some trail we have never heard of');
});

test('editing after choosing a park drops the park id rather than keeping a stale one', () => {
    const { picker, input, list, flush } = loadPicker();

    input.emit('focus');
    input.value = 'acadia';
    input.emit('input');
    flush();
    list.children[0].emit('pointerdown');
    assert.equal(picker.getSelection().id, 'p1');

    input.value = 'acadia but actually somewhere else';
    input.emit('input');
    flush();

    const selection = picker.getSelection();
    assert.equal(selection.kind, 'freeform');
    assert.equal(selection.id, null);
});

test('an empty box means no selection at all, not an empty park', () => {
    const { picker, input } = loadPicker();
    input.value = '   ';
    assert.equal(picker.getSelection(), null);
});

test('the arrow keys move the highlight and Enter takes it', () => {
    const { picker, input, list, flush } = loadPicker();

    input.emit('focus');
    flush();
    assert.equal(list.children.length, 2, 'pinned choices are listed');

    input.emit('keydown', { key: 'ArrowDown' });
    input.emit('keydown', { key: 'Enter' });

    assert.equal(picker.getSelection().kind, 'missing');
});

test('Escape closes the list and leaves the dialog to handle the next one', () => {
    const { picker, input, flush } = loadPicker();

    input.emit('focus');
    flush();
    assert.equal(picker.isOpen(), true);

    let stopped = false;
    input.emit('keydown', { key: 'Escape', stopPropagation: () => { stopped = true; } });

    assert.equal(picker.isOpen(), false);
    assert.equal(stopped, true, 'the dialog must not also close on that same Escape');
});

test('clear resets the box and reports the change', () => {
    const { picker, input, list, changes, flush } = loadPicker();

    input.emit('focus');
    input.value = 'acadia';
    input.emit('input');
    flush();
    list.children[0].emit('pointerdown');

    picker.clear();

    assert.equal(input.value, '');
    assert.equal(picker.getSelection(), null);
    assert.equal(picker.isOpen(), false);
    assert.equal(changes[changes.length - 1], null);
});
