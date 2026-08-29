const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const firebaseConfig = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'firebase.json'),
    'utf8'
));

test('production hosting matches the beta ten-minute static cache policy', () => {
    const cachePolicies = firebaseConfig.hosting.headers.flatMap(rule =>
        rule.headers
            .filter(header => header.key.toLowerCase() === 'cache-control')
            .map(header => ({ source: rule.source, value: header.value }))
    );

    assert.deepEqual(cachePolicies, [{ source: '**', value: 'max-age=600' }]);
    assert.equal(JSON.stringify(cachePolicies).includes('no-store'), false);
});
