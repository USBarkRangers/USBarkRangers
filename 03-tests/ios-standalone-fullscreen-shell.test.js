const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '01-code', 'app');
const indexHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');
const viewportStyles = fs.readFileSync(path.join(appDir, 'styles', 'viewportShell.css'), 'utf8');
const viewportCoordinator = fs.readFileSync(path.join(appDir, 'modules', 'viewportCoordinator.js'), 'utf8');
const trophyStyles = fs.readFileSync(path.join(appDir, 'styles', 'trophyCase.css'), 'utf8');

test('the viewport shell is isolated in dedicated files', () => {
    assert.match(indexHtml, /viewport-fit=cover/);
    assert.match(indexHtml, /styles\/viewportShell\.css\?v=\d+/);
    assert.match(indexHtml, /modules\/viewportCoordinator\.js\?v=\d+/);
    assert.doesNotMatch(indexHtml, /--bark-ios-app-height/);
    assert.doesNotMatch(indexHtml, /Number\(screen\.(?:width|height)\)/);
    assert.doesNotMatch(indexHtml, /Math\.min\(\.\.\.viewportHeights\)/);
});

test('CSS owns the full-screen shell and one variable owns bottom clearance', () => {
    assert.match(viewportStyles, /height:\s*100dvh/);
    assert.match(viewportStyles, /--bark-nav-total-height/);
    assert.match(viewportStyles, /--bark-viewport-bottom-lift/);
    assert.match(viewportStyles, /\.glass-nav\s*\{[\s\S]*position:\s*fixed/);
    assert.match(viewportStyles, /#slide-panel\s*\{[\s\S]*bottom:\s*var\(--bark-nav-total-height\)/);
    assert.match(viewportStyles, /\.leaflet-bottom\s*\{[\s\S]*--bark-map-control-bottom-clearance/);
    assert.match(viewportStyles, /\.filtered-pins-indicator\s*\{[\s\S]*--bark-map-indicator-bottom-clearance/);
});

test('the fallback adjusts only bottom UI and never resizes the app shell', () => {
    assert.match(viewportCoordinator, /calculateRequiredBottomLift/);
    assert.match(viewportCoordinator, /--bark-viewport-bottom-lift/);
    assert.doesNotMatch(viewportCoordinator, /style\.height\s*=/);
    assert.doesNotMatch(viewportCoordinator, /--bark-ios-app-height/);
    assert.doesNotMatch(viewportCoordinator, /visualViewport\.addEventListener/);
    assert.doesNotMatch(styles, /html\.bark-ios-standalone-fullscreen \.glass-nav/);
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
