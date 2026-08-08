const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// feedbackTransport.js is the half of the feedback dialog that can be tested
// without a browser: what gets emailed, what gets sent to the callable, and how
// a failure is described. The DOM half lives in feedbackModal.js.
function loadTransport({ user = null, callable = null } = {}) {
    const calls = [];
    const context = {
        window: {
            BARK: {
                getDisplayVersion: () => '0.20-beta'
            }
        },
        navigator: { userAgent: 'Test/1.0', platform: 'iPhone', language: 'en-US' },
        location: { pathname: '/USBarkRangers/01-code/app/', hash: '#map' },
        console,
        firebase: {
            auth: () => ({ currentUser: user }),
            functions: () => ({
                httpsCallable: (name) => async (payload) => {
                    calls.push({ name, payload });
                    return callable ? callable(payload) : { data: { ok: true, screenshotCount: 0 } };
                }
            })
        }
    };
    context.window.window = context.window;
    context.window.innerWidth = 390;
    context.window.innerHeight = 844;

    const source = fs.readFileSync(
        path.join(__dirname, '..', '01-code', 'app', 'modules', 'feedbackTransport.js'),
        'utf8'
    );
    vm.runInNewContext(source, context, { filename: 'modules/feedbackTransport.js' });
    return { transport: context.window.BARK.feedbackTransport, calls };
}

const BASE_VALUES = {
    typeId: 'bug',
    subjectLabel: 'Acadia National Park, ME',
    subjectKind: 'park',
    parkId: 'park-123',
    message: 'The tag pin sits in the ocean.',
    name: 'Carter',
    email: 'carter@example.test',
    screenshotCount: 2
};

test('resolveBackendType maps each picker choice to a routable backend type', () => {
    const { transport } = loadTransport();

    assert.equal(transport.resolveBackendType('bug', 'park'), 'bug');
    assert.equal(transport.resolveBackendType('idea', 'general'), 'idea');
    assert.equal(transport.resolveBackendType('support', 'general'), 'support');
    assert.equal(transport.resolveBackendType('correction', 'park'), 'other');

    // "Add a missing location" wins over whichever type button is lit.
    assert.equal(transport.resolveBackendType('bug', 'missing'), 'missing_location');
    assert.equal(transport.resolveBackendType('idea', 'missing'), 'missing_location');

    // An unknown id falls back rather than sending an unroutable type.
    assert.equal(transport.resolveBackendType('nonsense', 'general'), 'bug');
});

test('every type maps to a backend type the callable accepts', () => {
    const { transport } = loadTransport();
    // Mirrors the allow-list in cleanFeedbackType (functions/index.js).
    const accepted = new Set(['general', 'bug', 'idea', 'support', 'missing_location', 'other']);
    transport.TYPES.forEach((type) => {
        assert.ok(accepted.has(type.backendType), `${type.id} -> ${type.backendType}`);
    });
});

test('buildEmail carries the context the report needs and stays a valid mailto', () => {
    const { transport } = loadTransport();
    const email = transport.buildEmail(BASE_VALUES);

    assert.equal(email.subject, 'B.A.R.K. Bug: Acadia National Park, ME');
    assert.match(email.body, /Type: Bug/);
    assert.match(email.body, /About: Acadia National Park, ME/);
    assert.match(email.body, /Place ID: park-123/);
    assert.match(email.body, /From: Carter · carter@example.test/);
    assert.match(email.body, /App: v0\.20-beta/);
    assert.match(email.body, /The tag pin sits in the ocean\./);
    assert.match(email.body, /2 screenshots went with the in-app report/);

    // Both inboxes get it.
    assert.equal(transport.FEEDBACK_EMAILS.join(','), 'usbarkrangers@gmail.com,cswarm34@gmail.com');
    assert.ok(email.url.startsWith('mailto:usbarkrangers@gmail.com,cswarm34@gmail.com?'));
    assert.equal(email.to, 'usbarkrangers@gmail.com,cswarm34@gmail.com');

    const parsed = new URL(email.url);
    assert.equal(parsed.searchParams.get('subject'), email.subject);
    assert.equal(parsed.searchParams.get('body'), email.body);
});

test('buildEmail tells a reporter with no screenshots how to add photos', () => {
    const { transport } = loadTransport();
    const email = transport.buildEmail({ ...BASE_VALUES, screenshotCount: 0 });

    assert.match(email.body, /attach photos to this email/);
    assert.doesNotMatch(email.body, /went with the in-app report/);
});

test('buildEmail truncates at the same cap the callable enforces', () => {
    const { transport } = loadTransport();
    const email = transport.buildEmail({ ...BASE_VALUES, message: 'x'.repeat(2500) });

    assert.ok(email.body.includes('x'.repeat(transport.MAX_MESSAGE_LENGTH)));
    assert.ok(!email.body.includes('x'.repeat(transport.MAX_MESSAGE_LENGTH + 1)));
});

test('submitToBackend sends the resolved type and never the raw picker id', async () => {
    const { transport, calls } = loadTransport({ user: { uid: 'u1' } });

    await transport.submitToBackend({
        ...BASE_VALUES,
        subjectKind: 'missing',
        screenshots: [{ name: 'a.jpg', mimeType: 'image/jpeg', dataBase64: 'AAAA' }]
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'submitFeedback');

    const payload = calls[0].payload;
    assert.equal(payload.type, 'missing_location');
    assert.equal(payload.subject, 'Acadia National Park, ME');
    assert.equal(payload.parkId, 'park-123');
    assert.equal(payload.screenshots.length, 1);
    assert.equal(payload.browser.viewportWidth, 390);
    assert.equal(payload.browser.path, '/USBarkRangers/01-code/app/#map');
    assert.equal(payload.typeId, undefined);
});

test('describeError passes the backend’s own wording through and softens the rest', () => {
    const { transport } = loadTransport();

    assert.match(
        transport.describeError({ code: 'functions/resource-exhausted', message: 'Too many reports. Try again in 900 seconds.' }),
        /Try again in 900 seconds/
    );
    assert.match(
        transport.describeError({ code: 'functions/invalid-argument', message: 'Screenshots must be PNG, JPEG, or WebP images.' }),
        /PNG, JPEG, or WebP/
    );
    assert.match(transport.describeError({ code: 'functions/unauthenticated' }), /Sign in/);
    assert.match(transport.describeError({ code: 'internal', message: 'TypeError: x is not a function' }), /could not reach the team/);
    assert.match(transport.describeError(new Error('boom')), /could not reach the team/);
});

test('getSignedInUser survives an app where firebase never initialised', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', '01-code', 'app', 'modules', 'feedbackTransport.js'),
        'utf8'
    );
    const context = { window: { BARK: {} }, console };
    context.window.window = context.window;
    vm.runInNewContext(source, context, { filename: 'modules/feedbackTransport.js' });

    const transport = context.window.BARK.feedbackTransport;
    assert.equal(transport.getSignedInUser(), null);
    assert.equal(Object.keys(transport.collectBrowserMetadata()).length, 0);
});
