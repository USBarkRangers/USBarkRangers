const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(repoRoot, '01-code/app/index.html'), 'utf8');
const controllerSource = fs.readFileSync(path.join(repoRoot, '01-code/app/modules/paywallController.js'), 'utf8');

test('the annual tier stays visible without a popularity badge in any paywall state', () => {
    assert.match(indexSource, /Standard (?:—|&mdash;) \$15\/year/);
    assert.doesNotMatch(indexSource, /Most popular/i);
    assert.doesNotMatch(controllerSource, /Most popular/i);
});
