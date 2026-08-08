const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The drawing needs a browser. Deciding where the logo goes does not, and that is
// the part that used to be wrong: the logo drifted off the corner as it grew, and
// the saved image has to land in the same place the preview showed.
function loadGeometry() {
    const context = { window: { BARK: {} }, document: {}, console };
    context.window.window = context.window;

    const source = fs.readFileSync(
        path.join(__dirname, '..', '01-code', 'app', 'modules', 'watermarkTool.js'),
        'utf8'
    );
    vm.runInNewContext(source, context, { filename: 'modules/watermarkTool.js' });
    return context.window.BARK.watermarkGeometry;
}

// A stand-in for the trimmed logo: the real one is 688x833 after its transparent
// padding comes off.
const LOGO = { logoW: 688, logoH: 833 };

function layoutFor(geometry, corner, sizePercent, photo) {
    const size = photo || { w: 1200, h: 900 };
    return geometry.computeLayout({
        photoW: size.w,
        photoH: size.h,
        logoW: LOGO.logoW,
        logoH: LOGO.logoH,
        sizePercent: sizePercent,
        corner: corner
    });
}

/** Gap between the logo box and each edge of the photo. */
function insets(layout) {
    return {
        left: layout.logo.x - layout.photoX,
        top: layout.logo.y - layout.photoY,
        right: (layout.photoX + layout.photoW) - (layout.logo.x + layout.logo.w),
        bottom: (layout.photoY + layout.photoH) - (layout.logo.y + layout.logo.h)
    };
}

test('every corner sits at the same inset, at every logo size', () => {
    const geometry = loadGeometry();

    [1, 10, 25, 50].forEach((sizePercent) => {
        geometry.CORNERS.forEach((corner) => {
            const gaps = insets(layoutFor(geometry, corner, sizePercent));
            const near = corner.indexOf('top') === 0 ? gaps.top : gaps.bottom;
            const side = corner.indexOf('left') > 0 ? gaps.left : gaps.right;
            const expected = 1200 * 0.02;

            assert.equal(near, expected, `${corner} at ${sizePercent}% sits ${near}px from its horizontal edge`);
            assert.equal(side, expected, `${corner} at ${sizePercent}% sits ${side}px from its vertical edge`);
        });
    });
});

test('growing the logo does not walk it away from its corner', () => {
    const geometry = loadGeometry();

    // The bug: the logo bitmap carried transparent padding, so its visible edge
    // pulled away from the corner in proportion to its own size.
    const small = insets(layoutFor(geometry, 'bottom-right', 5));
    const large = insets(layoutFor(geometry, 'bottom-right', 50));

    assert.equal(small.right, large.right);
    assert.equal(small.bottom, large.bottom);
});

test('the four corners are exact mirrors of each other', () => {
    const geometry = loadGeometry();

    const topLeft = layoutFor(geometry, 'top-left', 20);
    const topRight = layoutFor(geometry, 'top-right', 20);
    const bottomLeft = layoutFor(geometry, 'bottom-left', 20);
    const bottomRight = layoutFor(geometry, 'bottom-right', 20);

    assert.equal(insets(topLeft).left, insets(topRight).right);
    assert.equal(insets(topLeft).top, insets(bottomLeft).bottom);
    assert.equal(insets(bottomRight).right, insets(bottomLeft).left);
    assert.equal(insets(bottomRight).bottom, insets(topRight).top);
});

test('the saved image places the logo exactly where the preview did', () => {
    const geometry = loadGeometry();

    // The preview is capped at 1200px wide; export runs at the photo's real size.
    // Both go through computeLayout, so the boxes have to stay proportional.
    const preview = geometry.renderedPhotoSize(4032, 3024, false);
    const full = geometry.renderedPhotoSize(4032, 3024, true);
    assert.equal(preview.width, 1200);
    assert.equal(full.width, 4032);

    geometry.CORNERS.forEach((corner) => {
        const onScreen = layoutFor(geometry, corner, 18, { w: preview.width, h: preview.height });
        const saved = layoutFor(geometry, corner, 18, { w: full.width, h: full.height });

        const ratio = (box, layout) => ({
            x: box.x / layout.canvasW,
            y: box.y / layout.canvasH,
            w: box.w / layout.canvasW,
            h: box.h / layout.canvasH
        });
        const a = ratio(onScreen.logo, onScreen);
        const b = ratio(saved.logo, saved);

        ['x', 'y', 'w', 'h'].forEach((key) => {
            assert.ok(Math.abs(a[key] - b[key]) < 0.001,
                `${corner} ${key}: preview ${a[key]} vs saved ${b[key]}`);
        });
    });
});

test('the logo keeps its aspect ratio', () => {
    const geometry = loadGeometry();

    const layout = layoutFor(geometry, 'top-left', 30);
    assert.equal(layout.logo.w, 1200 * 0.3);
    assert.ok(Math.abs(layout.logo.h / layout.logo.w - LOGO.logoH / LOGO.logoW) < 1e-9);
});

test('an unknown corner falls back to the original bottom right', () => {
    const geometry = loadGeometry();

    assert.equal(layoutFor(geometry, 'middle', 10).corner, 'bottom-right');
    assert.equal(geometry.DEFAULT_CORNER, 'bottom-right');
});

test('a point snaps to the corner of the quadrant it is in', () => {
    const geometry = loadGeometry();
    const photo = { x: 100, y: 100, w: 1000, h: 800 };   // centre at 600, 500

    assert.equal(geometry.cornerFromPoint(150, 150, photo), 'top-left');
    assert.equal(geometry.cornerFromPoint(1050, 150, photo), 'top-right');
    assert.equal(geometry.cornerFromPoint(150, 850, photo), 'bottom-left');
    assert.equal(geometry.cornerFromPoint(1050, 850, photo), 'bottom-right');

    // Just either side of the midlines, and the midline itself, which must not
    // land between two answers.
    assert.equal(geometry.cornerFromPoint(599, 499, photo), 'top-left');
    assert.equal(geometry.cornerFromPoint(601, 501, photo), 'bottom-right');
    assert.ok(geometry.CORNERS.includes(geometry.cornerFromPoint(600, 500, photo)));
});

test('a point outside the photo still resolves to the nearest corner', () => {
    const geometry = loadGeometry();
    const photo = { x: 100, y: 100, w: 1000, h: 800 };

    assert.equal(geometry.cornerFromPoint(-500, -500, photo), 'top-left');
    assert.equal(geometry.cornerFromPoint(9000, 9000, photo), 'bottom-right');
});

test('arrow keys step to the neighbouring corner and stop at the edges', () => {
    const geometry = loadGeometry();
    const nudge = geometry.cornerAfterNudge;

    assert.equal(nudge('bottom-right', -1, 0), 'bottom-left');
    assert.equal(nudge('bottom-left', 0, -1), 'top-left');
    assert.equal(nudge('top-left', 1, 0), 'top-right');
    assert.equal(nudge('top-right', 0, 1), 'bottom-right');

    // Already against that edge: no move, which the caller reads as "nothing to do".
    assert.equal(nudge('top-left', -1, 0), 'top-left');
    assert.equal(nudge('top-left', 0, -1), 'top-left');
    assert.equal(nudge('bottom-right', 1, 0), 'bottom-right');
    assert.equal(nudge('bottom-right', 0, 1), 'bottom-right');
});

test('a photo is downscaled for the preview but never blown up', () => {
    const geometry = loadGeometry();

    const big = geometry.renderedPhotoSize(4032, 3024, false);
    assert.equal(big.width, 1200);
    assert.equal(big.height, 900);

    const small = geometry.renderedPhotoSize(800, 600, false);
    assert.equal(small.width, 800);
    assert.equal(small.height, 600);

    const portrait = geometry.renderedPhotoSize(3024, 4032, false);
    assert.equal(portrait.width, 1200);
    assert.equal(portrait.height, 1600);
});

test('a zero-size logo is laid out without dividing by zero', () => {
    const geometry = loadGeometry();

    const layout = geometry.computeLayout({
        photoW: 1200, photoH: 900, logoW: 0, logoH: 0, sizePercent: 10, corner: 'top-left'
    });
    assert.equal(layout.logo.h, 0);
    assert.ok(Number.isFinite(layout.logo.x));
    assert.ok(Number.isFinite(layout.logo.y));
});
