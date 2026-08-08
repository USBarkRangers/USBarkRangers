const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Canvas encoding needs a browser, but the sizing arithmetic in front of it does
// not, and that is the part that decides whether an upload fits inside the
// callable's per-image cap.
function loadImages() {
    const context = { window: { BARK: {} }, document: {}, console };
    context.window.window = context.window;

    const source = fs.readFileSync(
        path.join(__dirname, '..', '01-code', 'app', 'utils', 'imageDownscale.js'),
        'utf8'
    );
    vm.runInNewContext(source, context, { filename: 'utils/imageDownscale.js' });
    return context.window.BARK.images;
}

test('a big photo is scaled to the long edge with its aspect ratio intact', () => {
    const { scaledSize } = loadImages();

    const landscape = scaledSize(4032, 3024, 1600);
    assert.equal(landscape.width, 1600);
    assert.equal(landscape.height, 1200);

    const portrait = scaledSize(3024, 4032, 1600);
    assert.equal(portrait.width, 1200);
    assert.equal(portrait.height, 1600);
});

test('an image already under the limit is never upscaled', () => {
    const { scaledSize } = loadImages();

    const small = scaledSize(800, 600, 1600);
    assert.equal(small.width, 800);
    assert.equal(small.height, 600);
});

test('an extreme aspect ratio still yields at least one pixel on the short edge', () => {
    const { scaledSize } = loadImages();

    const sliver = scaledSize(8000, 3, 1600);
    assert.equal(sliver.width, 1600);
    assert.ok(sliver.height >= 1, 'a zero-height canvas would throw on draw');
});

test('a degenerate image reports no size rather than dividing by zero', () => {
    const { scaledSize } = loadImages();
    assert.equal(scaledSize(0, 0, 1600), null);
});

test('the upload is renamed to match the JPEG it actually became', () => {
    const { jpegName } = loadImages();

    assert.equal(jpegName('IMG_2931.PNG'), 'IMG_2931.jpg');
    assert.equal(jpegName('photo.heic'), 'photo.jpg');
    assert.equal(jpegName('/Users/someone/Pictures/shot.png'), 'shot.jpg');
    assert.equal(jpegName(''), 'screenshot.jpg');
    assert.equal(jpegName(undefined), 'screenshot.jpg');
});
