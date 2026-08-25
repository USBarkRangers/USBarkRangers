const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appDir = path.join(__dirname, '..', '01-code', 'app');

function loadLayoutContract() {
    const context = { window: { BARK: {} } };
    vm.runInNewContext(
        fs.readFileSync(path.join(appDir, 'modules', 'searchEngine.js'), 'utf8'),
        context,
        { filename: 'modules/searchEngine.js' }
    );
    return context.window.BARK.searchSuggestionLayout;
}

test('search suggestions use all available space but retain the 250px cap', () => {
    const layout = loadLayoutContract();
    assert.equal(layout.calculateMaxHeight({
        viewportBottom: 844,
        inputBottom: 115,
        navTop: 769
    }), 250);
});

test('search suggestions shrink above the navigation in short landscape', () => {
    const layout = loadLayoutContract();
    assert.equal(layout.calculateMaxHeight({
        viewportBottom: 360,
        inputBottom: 115,
        navTop: 285
    }), 158);
});

test('search suggestions never report a negative visible height', () => {
    const layout = loadLayoutContract();
    assert.equal(layout.calculateMaxHeight({
        viewportBottom: 180,
        inputBottom: 175,
        navTop: 180
    }), 0);
});

test('search-open panels escape both normal-phone and recovered-Android clipping', () => {
    const styles = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');
    const androidStyles = fs.readFileSync(
        path.join(appDir, 'styles', 'riskyAndroidDesktopViewportRecovery.css'),
        'utf8'
    );

    assert.match(styles, /#filter-panel\.search-suggestions-open\s*\{\s*overflow:\s*visible/);
    assert.match(androidStyles, /#filter-panel\.search-suggestions-open\s*\{\s*overflow:\s*visible/);
});
