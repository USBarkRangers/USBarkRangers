const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// The browser and the Cloud Function cannot import from each other, so a few
// numbers and strings are necessarily written down twice. These tests are the
// thing that notices when one side moves and the other does not, which is the
// only reason the duplication is tolerable.

const repoRoot = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

function firstNumber(source, pattern, label) {
    const match = source.match(pattern);
    assert.ok(match, `could not find ${label}`);
    return Number(match[1]);
}

test('the screenshot cap the dialog enforces is the one the callable enforces', () => {
    const client = firstNumber(
        read('01-code', 'app', 'modules', 'feedbackModal.js'),
        /MAX_SCREENSHOTS\s*=\s*(\d+)/,
        'MAX_SCREENSHOTS in feedbackModal.js'
    );
    const server = firstNumber(
        read('01-code', 'functions', 'feedbackAttachments.js'),
        /MAX_FILES\s*=\s*(\d+)/,
        'MAX_FILES in feedbackAttachments.js'
    );
    const transport = firstNumber(
        read('01-code', 'functions', 'opsDiscord.js'),
        /LIMIT_FILES\s*=\s*(\d+)/,
        'LIMIT_FILES in opsDiscord.js'
    );

    assert.equal(client, server, 'the dialog would let through what the callable rejects');
    assert.ok(transport >= server, 'Discord transport would silently drop an accepted screenshot');
});

test('the message cap the counter shows is the one the callable enforces', () => {
    const client = firstNumber(
        read('01-code', 'app', 'modules', 'feedbackTransport.js'),
        /MAX_MESSAGE_LENGTH\s*=\s*(\d+)/,
        'MAX_MESSAGE_LENGTH in feedbackTransport.js'
    );
    const server = firstNumber(
        read('01-code', 'functions', 'index.js'),
        /function cleanFeedbackText\(value, maxLength = (\d+)\)/,
        'cleanFeedbackText default in index.js'
    );

    assert.equal(client, server, 'the textarea would accept a message the callable rejects');
});

test('the browser only sends feedback types the callable will route', () => {
    const clientTypes = [...read('01-code', 'app', 'modules', 'feedbackTransport.js')
        .matchAll(/backendType:\s*'([a-z_]+)'/g)].map(m => m[1]);

    const allowed = read('01-code', 'functions', 'index.js')
        .match(/const allowed = new Set\(\[([^\]]+)\]\)/)[1]
        .match(/"([a-z_]+)"/g)
        .map(s => s.replace(/"/g, ''));

    assert.ok(clientTypes.length >= 4, 'expected the dialog to define its type list');
    for (const type of clientTypes) {
        assert.ok(allowed.includes(type), `"${type}" is not in cleanFeedbackType's allow-list`);
    }
});

test('every routable feedback type has a Discord channel to land in', () => {
    const index = read('01-code', 'functions', 'index.js');
    const allowed = index
        .match(/const allowed = new Set\(\[([^\]]+)\]\)/)[1]
        .match(/"([a-z_]+)"/g)
        .map(s => s.replace(/"/g, ''));
    const routed = index.match(/FEEDBACK_DISCORD_CHANNELS = Object\.freeze\(\{([^}]+)\}\)/)[1];
    const known = read('01-code', 'functions', 'opsDiscord.js')
        .match(/KNOWN_CHANNELS = Object\.freeze\(\[([^\]]+)\]\)/)[1];

    for (const type of allowed) {
        const match = routed.match(new RegExp(`${type}:\\s*"([A-Za-z]+)"`));
        assert.ok(match, `"${type}" has no entry in FEEDBACK_DISCORD_CHANNELS`);
        assert.ok(known.includes(`"${match[1]}"`), `"${match[1]}" is not a known Discord channel`);
    }
});
