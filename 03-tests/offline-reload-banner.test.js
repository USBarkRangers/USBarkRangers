const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.join(__dirname, '..', '01-code', 'app');
const index = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(appRoot, 'styles.css'), 'utf8');
const core = fs.readFileSync(path.join(appRoot, 'core', 'app.js'), 'utf8');

function countId(id) {
    return Array.from(index.matchAll(new RegExp(`id=["']${id}["']`, 'g'))).length;
}

test('offline recovery banner has a blue reload action and accessible dismiss control', () => {
    for (const id of [
        'auth-failure-message',
        'auth-failure-title',
        'auth-failure-detail',
        'auth-failure-reload',
        'auth-failure-dismiss'
    ]) {
        assert.equal(countId(id), 1, `${id} must be unique`);
    }

    assert.match(index, /<strong id="auth-failure-title">You appear offline<\/strong>/);
    assert.match(index, /Saved visits will keep retrying\. If syncing looks stuck, reload here\./);
    assert.match(index, /id="auth-failure-reload"[^>]*>Reload<\/button>/);
    assert.match(index, /id="auth-failure-dismiss"[\s\S]*?aria-label="Dismiss offline warning"[\s\S]*?&times;<\/button>/);

    assert.match(styles, /\.auth-failure-banner\s*\{[\s\S]*background:\s*rgba\(33,\s*150,\s*243,/);
    assert.match(styles, /\.auth-failure-banner \.auth-failure-reload\s*\{[\s\S]*min-height:\s*44px/);
    assert.match(styles, /\.auth-failure-banner \.auth-failure-dismiss\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px/);
    assert.match(styles, /body:has\(\.live-walk-banner\[style\*="display: flex"\]\) \.auth-failure-banner/);
});

test('reload restarts the page directly and dismiss is visual-only', () => {
    assert.match(core, /reloadButton\.addEventListener\('click',\s*\(\)\s*=>\s*window\.location\.reload\(\)\)/);
    assert.doesNotMatch(core, /reloadButton[\s\S]{0,300}(?:signOut|localStorage\.clear|syncUserProgress)/);
    assert.match(core, /message\.hidden\s*=\s*true;[\s\S]{0,400}offlineNoticeDismissed\s*=\s*true/);
    assert.doesNotMatch(core, /dismissButton[\s\S]{0,400}(?:signOut|localStorage\.clear|cancelPendingServerConfirmations)/);
    assert.match(core, /function showOfflineRecoveryNotice/);
    assert.match(core, /function hideOfflineRecoveryNotice/);
    assert.match(core, /title\.textContent\s*=\s*'Sign-in unavailable'/);
    assert.match(core, /setAttribute\('aria-label',\s*'Dismiss sign-in warning'\)/);
    assert.match(core, /setAttribute\('aria-label',\s*'Dismiss offline warning'\)/);
});
