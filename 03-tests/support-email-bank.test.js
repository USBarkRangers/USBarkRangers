const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '../05-tools/google-apps-script/support-email-bank/Code.js'),
  'utf8'
);

function loadBridge(overrides = {}) {
  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Number,
    Object,
    String,
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'support-email-bank/Code.js' });
  return sandbox;
}

function message({ id, millis, to = '', cc = '' }) {
  return {
    getId: () => id,
    getDate: () => new Date(millis),
    getTo: () => to,
    getCc: () => cc,
  };
}

test('support email bridge selects exact messages, not unrelated replies from matching threads', () => {
  const checkpoint = { millis: 1_000, ids: [] };
  const addressed = message({
    id: 'support-message',
    millis: 2_000,
    to: 'support@usbarkrangersmap.com',
  });
  const unrelatedReply = message({
    id: 'unrelated-reply',
    millis: 3_000,
    to: 'someone@example.com',
  });
  const bridge = loadBridge({
    GmailApp: {
      search: (_query, start) => start === 0
        ? [{ getMessages: () => [unrelatedReply, addressed] }]
        : [],
    },
  });

  const found = bridge.findSupportMessages_(checkpoint);
  assert.deepEqual(Array.from(found, (item) => item.getId()), ['support-message']);
});

test('support email checkpoint suppresses repeats and advances only at the newest timestamp', () => {
  const bridge = loadBridge();
  const checkpoint = { millis: 2_000, ids: ['already-seen'] };

  bridge.advanceCheckpoint_(checkpoint, message({ id: 'same-time', millis: 2_000 }));
  assert.deepEqual(checkpoint, { millis: 2_000, ids: ['already-seen', 'same-time'] });

  bridge.advanceCheckpoint_(checkpoint, message({ id: 'newest', millis: 4_000 }));
  assert.equal(JSON.stringify(checkpoint), JSON.stringify({ millis: 4_000, ids: ['newest'] }));
});

test('support email bridge accepts only Discord webhook credentials and clamps previews', () => {
  const bridge = loadBridge();
  assert.throws(() => bridge.requireDiscordWebhook_('https://example.com/hook'));
  assert.match(
    bridge.requireDiscordWebhook_('https://discord.com/api/webhooks/1/token'),
    /^https:\/\/discord\.com/
  );
  assert.equal(bridge.cleanDiscordText_('a'.repeat(20), 8), 'aaaaaaa…');
});
