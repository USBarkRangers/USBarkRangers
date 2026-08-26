const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '01-code', 'app');
const indexHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');
const trophyStyles = fs.readFileSync(path.join(appDir, 'styles', 'trophyCase.css'), 'utf8');

test('iOS standalone mode is identified before the first stylesheet paints', () => {
    const classScript = indexHtml.indexOf("classList.add('bark-ios-standalone-fullscreen')");
    const mainStylesheet = indexHtml.indexOf('href="styles.css');
    assert.ok(classScript >= 0);
    assert.ok(mainStylesheet > classScript);
    assert.match(indexHtml, /viewport-fit=cover/);
    assert.match(indexHtml, /--bark-ios-app-height/);
    assert.ok(indexHtml.indexOf('--bark-ios-app-height') < mainStylesheet);
});

test('iOS standalone height follows the usable viewport instead of the physical screen', () => {
    assert.match(indexHtml, /Number\(window\.innerHeight\)/);
    assert.match(indexHtml, /Number\(root\.clientHeight\)/);
    assert.match(indexHtml, /Math\.floor\(Math\.min\(\.\.\.viewportHeights\)\)/);
    assert.doesNotMatch(indexHtml, /Number\(screen\.(?:width|height)\)/);
    assert.doesNotMatch(indexHtml, /visualViewport\.addEventListener/);
});

test('the iOS app shell uses the stable large viewport without changing other phones', () => {
    assert.match(styles, /html\.bark-ios-standalone-fullscreen[\s\S]*height:\s*100lvh/);
    assert.match(styles, /height:\s*var\(--bark-ios-app-height,\s*100lvh\)/);
    assert.match(styles, /html\.bark-ios-standalone-fullscreen #map,[\s\S]*\.ui-view[\s\S]*height:\s*100lvh/);
    assert.match(styles, /html\.bark-ios-standalone-fullscreen \.glass-nav\s*\{\s*position:\s*absolute;/);
    assert.match(styles, /safe-area-inset-top/);
    assert.match(styles, /height:\s*calc\(75px \+ env\(safe-area-inset-bottom/);
});

test('the park action footer does not apply the bottom safe area twice', () => {
    const footerRule = trophyStyles.match(/\.panel-sticky-footer\s*\{[\s\S]*?\n\}/);
    assert.ok(footerRule, 'panel sticky footer rule should exist');
    assert.match(footerRule[0], /padding-bottom:\s*10px\s*!important/);
    assert.doesNotMatch(footerRule[0], /safe-area-inset-bottom/);
    assert.match(trophyStyles, /@media\s*\(max-width:\s*767px\)[\s\S]*#slide-panel\s*\{[\s\S]*padding-bottom:\s*0/);
});

test('profile and refresh controls clear the top safe area', () => {
    assert.match(styles, /#settings-gear-btn\s*\{[\s\S]*top:\s*max\(22px,\s*calc\(env\(safe-area-inset-top,\s*0px\)\s*\+\s*10px\)\)/);
    assert.match(styles, /\.update-toast\s*\{[\s\S]*top:\s*max\(24px,\s*calc\(env\(safe-area-inset-top,\s*0px\)\s*\+\s*12px\)\)/);
    assert.match(styles, /\.update-toast\s*\{[\s\S]*translateY\(calc\(-100%\s*-\s*env\(safe-area-inset-top,\s*0px\)\s*-\s*32px\)\)/);
    assert.match(styles, /\.update-toast\.show\s*\{\s*transform:\s*translateX\(-50%\)\s*translateY\(0\)/);
});

test('bottom navigation does not install the fixed-surface touchmove canceler', () => {
    const uiController = fs.readFileSync(path.join(appDir, 'modules', 'uiController.js'), 'utf8');
    assert.doesNotMatch(uiController, /bindFixedSurfaceScrollGuard\(bottomNav\)/);
    assert.match(uiController, /addEventListener\('pointerup'/);
});
