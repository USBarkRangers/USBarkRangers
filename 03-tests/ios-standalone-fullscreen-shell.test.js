const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '01-code', 'app');
const indexHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');

test('iOS standalone mode is identified before the first stylesheet paints', () => {
    const classScript = indexHtml.indexOf("classList.add('bark-ios-standalone-fullscreen')");
    const mainStylesheet = indexHtml.indexOf('href="styles.css');
    assert.ok(classScript >= 0);
    assert.ok(mainStylesheet > classScript);
    assert.match(indexHtml, /viewport-fit=cover/);
    assert.match(indexHtml, /--bark-ios-app-height/);
    assert.ok(indexHtml.indexOf('--bark-ios-app-height') < mainStylesheet);
});

test('the iOS app shell uses the stable large viewport without changing other phones', () => {
    assert.match(styles, /html\.bark-ios-standalone-fullscreen[\s\S]*height:\s*100lvh/);
    assert.match(styles, /height:\s*var\(--bark-ios-app-height,\s*100lvh\)/);
    assert.match(styles, /html\.bark-ios-standalone-fullscreen #map,[\s\S]*\.ui-view[\s\S]*height:\s*100lvh/);
    assert.match(styles, /html\.bark-ios-standalone-fullscreen \.glass-nav\s*\{\s*position:\s*absolute;/);
    assert.match(styles, /safe-area-inset-top/);
    assert.match(styles, /height:\s*calc\(75px \+ env\(safe-area-inset-bottom/);
});
