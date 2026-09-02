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

test('fresh production navigations enter the immutable 0.142 shell before any worker exists', () => {
    assert.deepEqual(firebaseConfig.hosting.redirects, [
        {
            source: '/',
            destination: '/index.v142.html',
            type: 302
        },
        {
            source: '/index.html',
            destination: '/index.v142.html',
            type: 302
        }
    ]);

    const privateEntryPath = path.join(__dirname, '..', '01-code', 'app', 'index.v142.html');
    const privateEntry = fs.readFileSync(privateEntryPath, 'utf8');
    assert.match(privateEntry, /modules\/dataService\.v142\.js/);
    assert.doesNotMatch(privateEntry, /modules\/dataService\.js\?v=12/);
});
