const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

/**
 * A page with the first-open disclaimer already accepted. Left up, that modal
 * covers the whole app and every gesture below lands on it instead.
 */
async function newWatermarkPage(browser, options) {
    const context = await newBarkContext(browser, options);
    await context.addInitScript(() => {
        try { localStorage.setItem('barkTermsAgreement', '1'); } catch (err) { /* storage blocked */ }
    });
    return { context: context, page: await context.newPage() };
}

async function openLoadedApp(page) {
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}watermarkDragSmoke=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.BARK &&
        typeof window.BARK.initWatermarkTool === 'function' &&
        document.getElementById('wm-logo-handle')
    ), { timeout: 30000 });
    await expect(page.locator('#disclaimer-modal')).toBeHidden();

    // The boot loader covers the app until auth resolves, and a gesture aimed at
    // the canvas would land on it instead.
    await page.waitForFunction(() => !document.getElementById('bark-loader'), { timeout: 30000 });
}

/** Put a generated photo through the real file input and wait for the first paint. */
async function loadPhoto(page) {
    await page.evaluate(async () => {
        const home = [...document.querySelectorAll('.nav-item')]
            .find((item) => item.textContent.trim().startsWith('Home'));
        if (home) home.click();

        const canvas = document.createElement('canvas');
        canvas.width = 1600;
        canvas.height = 1200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(0, 0, 1600, 1200);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'smoke.png', { type: 'image/png' }));
        const input = document.getElementById('wm-upload');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#wm-logo-handle')).toBeVisible();
    await page.waitForFunction(() => {
        const handle = document.getElementById('wm-logo-handle');
        return Boolean(handle && handle.style.width);
    }, { timeout: 10000 });
}

/** The handle's box as percentages of the canvas, which is what the drawing uses. */
async function handleBox(page) {
    return page.evaluate(() => {
        const handle = document.getElementById('wm-logo-handle');
        const left = parseFloat(handle.style.left);
        const top = parseFloat(handle.style.top);
        return {
            left: left,
            top: top,
            right: 100 - (left + parseFloat(handle.style.width)),
            bottom: 100 - (top + parseFloat(handle.style.height)),
            corner: handle.getAttribute('aria-label').match(/currently ([a-z ]+)\./)[1]
        };
    });
}

async function setLogoSize(page, percent) {
    await page.evaluate((value) => {
        const slider = document.getElementById('wm-logo-size');
        slider.value = String(value);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, percent);
}

/** A real press-move-release, so pointer capture and the snap are both exercised. */
async function dragHandleTo(page, fractionX, fractionY) {
    const handle = await page.locator('#wm-logo-handle').boundingBox();
    const stage = await page.locator('#wm-stage').boundingBox();
    expect(handle).toBeTruthy();
    expect(stage).toBeTruthy();

    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(
        stage.x + stage.width * fractionX,
        stage.y + stage.height * fractionY,
        { steps: 12 }
    );
    await page.mouse.up();
    await page.waitForTimeout(250);          // let the snap animation land
}

test.describe('watermark corner drag', () => {
    test('the logo snaps to whichever corner it is dragged to, at the same inset', async ({ browser }) => {
        const { context, page } = await newWatermarkPage(browser, { viewport: { width: 1280, height: 900 } });
        const consoleErrors = [];
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });

        await openLoadedApp(page);
        await loadPhoto(page);
        await setLogoSize(page, 20);

        const start = await handleBox(page);
        expect(start.corner).toBe('bottom right');

        const targets = [
            ['top-left', 0.12, 0.12, 'top left'],
            ['top-right', 0.88, 0.12, 'top right'],
            ['bottom-left', 0.12, 0.88, 'bottom left'],
            ['bottom-right', 0.88, 0.88, 'bottom right']
        ];

        const seen = {};
        for (const [name, fx, fy, label] of targets) {
            await dragHandleTo(page, fx, fy);
            const box = await handleBox(page);
            expect(box.corner, `dragging to ${name}`).toBe(label);
            seen[name] = box;
        }

        // Same gap from the photo edge in all four corners, to within a rounding hair.
        const horizontal = [seen['top-left'].left, seen['bottom-left'].left,
            seen['top-right'].right, seen['bottom-right'].right];
        const vertical = [seen['top-left'].top, seen['top-right'].top,
            seen['bottom-left'].bottom, seen['bottom-right'].bottom];
        horizontal.forEach((value) => expect(Math.abs(value - horizontal[0])).toBeLessThan(0.01));
        vertical.forEach((value) => expect(Math.abs(value - vertical[0])).toBeLessThan(0.01));

        expect(consoleErrors).toEqual([]);
        await context.close();
    });

    test('the logo holds its corner as it grows', async ({ browser }) => {
        const { context, page } = await newWatermarkPage(browser, { viewport: { width: 1280, height: 900 } });

        await openLoadedApp(page);
        await loadPhoto(page);

        // The old bug: the logo's transparent padding scaled with it, so the visible
        // badge crept inward as the slider went up.
        await setLogoSize(page, 5);
        const small = await handleBox(page);
        await setLogoSize(page, 50);
        const large = await handleBox(page);

        expect(Math.abs(small.right - large.right)).toBeLessThan(0.01);
        expect(Math.abs(small.bottom - large.bottom)).toBeLessThan(0.01);

        await context.close();
    });

    test('the logo asset is not downloaded until a photo is picked', async ({ browser }) => {
        const { context, page } = await newWatermarkPage(browser, { viewport: { width: 1280, height: 900 } });

        // It is a 600KB PNG that used to be fetched at boot for every visitor,
        // including the ones who never open this tool.
        const logoRequests = [];
        page.on('request', (request) => {
            if (request.url().includes('WatermarkBARK')) logoRequests.push(request.url());
        });

        await openLoadedApp(page);
        expect(logoRequests).toEqual([]);

        await loadPhoto(page);
        await page.waitForFunction(() => {
            const handle = document.getElementById('wm-logo-handle');
            return Boolean(handle && handle.style.width);
        });
        expect(logoRequests.length).toBe(1);

        await context.close();
    });

    test('saving still produces a full-resolution image, from the dragged corner', async ({ browser }) => {
        const { context, page } = await newWatermarkPage(browser, { viewport: { width: 1280, height: 900 } });

        await openLoadedApp(page);
        await loadPhoto(page);
        await page.locator('#wm-logo-handle').focus();
        await page.keyboard.press('ArrowUp');            // move off the default corner
        await page.waitForTimeout(200);

        await page.check('#wm-high-res');                 // export at the photo's real size
        await page.click('#wm-download');

        await expect(page.locator('#wm-save-overlay')).toHaveClass(/active/);
        await expect(page.locator('#wm-save-download')).toBeEnabled({ timeout: 15000 });
        await expect(page.locator('#wm-save-status')).toContainText(/ready/i);

        // The thumbnail is a real render, not a blank canvas.
        const thumb = await page.evaluate(() => {
            const img = document.getElementById('wm-save-preview');
            return { src: (img.src || '').slice(0, 22), width: img.naturalWidth };
        });
        expect(thumb.src).toContain('data:image/jpeg');
        expect(thumb.width).toBeGreaterThan(0);

        // The visible canvas stays at preview resolution even with full-res ticked;
        // that is what keeps dragging cheap on a big photo.
        const canvasWidth = await page.evaluate(() => document.getElementById('wm-canvas').width);
        expect(canvasWidth).toBeLessThanOrEqual(1200 + Math.ceil(1600 * 0.08) * 2);

        await context.close();
    });

    test('arrow keys move the logo between corners', async ({ browser }) => {
        const { context, page } = await newWatermarkPage(browser, { viewport: { width: 1280, height: 900 } });

        await openLoadedApp(page);
        await loadPhoto(page);

        await page.locator('#wm-logo-handle').focus();
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(200);
        expect((await handleBox(page)).corner).toBe('bottom left');

        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        expect((await handleBox(page)).corner).toBe('top left');

        // Already against that edge, so nothing should move.
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        expect((await handleBox(page)).corner).toBe('top left');

        await context.close();
    });

    test('the clear button never covers the logo, in any corner, on a phone', async ({ browser }) => {
        const { context, page } = await newWatermarkPage(browser, {
            viewport: { width: 375, height: 812 },
            isMobile: true,
            hasTouch: true
        });

        await openLoadedApp(page);
        await loadPhoto(page);

        // The button is a fixed 44px while the canvas here is ~230px wide, so
        // overlaying it on the image covered a top-right logo completely.
        for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
            await page.locator('#wm-logo-handle').focus();
            await page.keyboard.press(key);
            await page.waitForTimeout(200);

            const boxes = await page.evaluate(() => {
                const handle = document.getElementById('wm-logo-handle').getBoundingClientRect();
                const clear = document.getElementById('wm-clear').getBoundingClientRect();
                return {
                    corner: document.getElementById('wm-logo-handle')
                        .getAttribute('aria-label').match(/currently ([a-z ]+)\./)[1],
                    overlapX: Math.max(0, Math.min(handle.right, clear.right) - Math.max(handle.left, clear.left)),
                    overlapY: Math.max(0, Math.min(handle.bottom, clear.bottom) - Math.max(handle.top, clear.top))
                };
            });

            expect(Math.min(boxes.overlapX, boxes.overlapY),
                `clear button overlaps the ${boxes.corner} logo`).toBe(0);
        }

        await context.close();
    });

    test('on a phone only the handle swallows the touch, so the page still scrolls', async ({ browser }) => {
        const { context, page } = await newWatermarkPage(browser, {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });

        await openLoadedApp(page);
        await loadPhoto(page);

        // `touch-action: none` over the whole photo would cost the page its scroll.
        const touchActions = await page.evaluate(() => ({
            handle: getComputedStyle(document.getElementById('wm-logo-handle')).touchAction,
            canvas: getComputedStyle(document.getElementById('wm-canvas')).touchAction,
            stage: getComputedStyle(document.getElementById('wm-stage')).touchAction,
            layerHitTest: getComputedStyle(document.getElementById('wm-logo-layer')).pointerEvents
        }));

        expect(touchActions.handle).toBe('none');
        expect(touchActions.canvas).not.toBe('none');
        expect(touchActions.stage).not.toBe('none');
        expect(touchActions.layerHitTest).toBe('none');

        // And a scroll gesture starting over the photo really does move the view.
        await page.locator('#wm-canvas').scrollIntoViewIfNeeded();
        const canvas = await page.locator('#wm-canvas').boundingBox();
        const viewport = page.viewportSize();
        const pointerY = Math.min(canvas.y + canvas.height / 2, viewport.height - 60);
        const before = await page.evaluate(() => document.getElementById('home-view').scrollTop);
        await page.mouse.move(canvas.x + canvas.width / 2, pointerY);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => document.getElementById('home-view').scrollTop);
        expect(after).toBeGreaterThan(before);

        await context.close();
    });
});
