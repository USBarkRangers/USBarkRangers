const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const ANDROID_USER_AGENT = 'Mozilla/5.0 (Linux; Android 16; SM-S948U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const STATIC_TEXT_ENTRY_IDS = [
    'park-search',
    'tripNameInput',
    'miles-input',
    'account-signin-email',
    'account-signin-password',
    'account-create-username',
    'account-create-email',
    'account-create-password',
    'account-reset-email',
    'account-delete-confirm-input',
    'feedback-subject-input',
    'feedback-message',
    'feedback-name',
    'feedback-email',
    'opt-max-stops',
    'opt-max-hours'
];

async function openAndroidKeyboardShell(browser, viewport) {
    const context = await newBarkContext(browser, {
        viewport,
        screen: viewport,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: ANDROID_USER_AGENT
    });
    await context.addInitScript(({ width, height }) => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
        window.__barkKeyboardVisualHeight = height;
        const viewportTarget = new EventTarget();
        Object.defineProperties(viewportTarget, {
            width: { configurable: true, get: () => width },
            height: { configurable: true, get: () => window.__barkKeyboardVisualHeight },
            offsetTop: { configurable: true, get: () => 0 },
            offsetLeft: { configurable: true, get: () => 0 },
            scale: { configurable: true, get: () => 1 }
        });
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            get: () => viewportTarget
        });
        window.__barkKeyboardViewport = viewportTarget;
    }, viewport);

    const page = await context.newPage();
    await page.goto(`${BASE_URL}?androidKeyboardSettle=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.BARK
        && window.BARK.viewportCoordinator
        && !document.getElementById('bark-loader')
        && document.getElementById('main-nav')
    ), undefined, { timeout: 30000 });
    return { context, page };
}

async function installVisibleKeyboardFixtures(page) {
    return page.evaluate((ids) => {
        const missing = ids.filter(id => !document.getElementById(id));
        if (missing.length) return { missing, fixtureIds: [] };

        const fixture = document.createElement('div');
        fixture.id = 'keyboard-area-test-fixture';
        fixture.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;z-index:-1;';
        const fixtureIds = [];
        ids.forEach((id, index) => {
            const source = document.getElementById(id);
            const clone = source.tagName === 'TEXTAREA'
                ? document.createElement('textarea')
                : document.createElement('input');
            if (clone.tagName === 'INPUT') clone.type = source.getAttribute('type') || 'text';
            clone.id = `keyboard-fixture-${index}`;
            clone.setAttribute('aria-label', `Keyboard fixture for ${id}`);
            fixture.appendChild(clone);
            fixtureIds.push(clone.id);
        });

        ['inline-start-input', 'inline-end-input'].forEach((sourceId, index) => {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = `keyboard-fixture-dynamic-${index}`;
            input.setAttribute('aria-label', `Keyboard fixture for ${sourceId}`);
            fixture.appendChild(input);
            fixtureIds.push(input.id);
        });
        document.body.appendChild(fixture);
        return { missing, fixtureIds };
    }, STATIC_TEXT_ENTRY_IDS);
}

async function runStaleKeyboardDismissal(page, fixtureId, fullHeight) {
    await page.evaluate(({ id, height }) => {
        const input = document.getElementById(id);
        window.__barkKeyboardVisualHeight = height;
        window.__barkKeyboardViewport.dispatchEvent(new Event('resize'));
        input.focus();
        window.__barkKeyboardVisualHeight = Math.round(height * 0.56);
        window.__barkKeyboardViewport.dispatchEvent(new Event('resize'));
    }, { id: fixtureId, height: fullHeight });
    await page.waitForFunction(() => document.body.classList.contains('keyboard-open'));

    await page.evaluate((id) => {
        document.getElementById(id).blur();
        // Reproduce the Galaxy failure: Chrome sends another resize while its
        // visual viewport still has the keyboard-sized height.
        window.__barkKeyboardViewport.dispatchEvent(new Event('resize'));
    }, fixtureId);
    await page.waitForTimeout(260);

    const staleState = await page.evaluate(() => ({
        lift: Number(document.documentElement.dataset.barkNavContentLift || 0),
        settling: document.body.classList.contains('bark-keyboard-settling'),
        panelHeight: document.getElementById('slide-panel').getBoundingClientRect().height
    }));
    expect(staleState.settling).toBe(true);
    expect(staleState.lift).toBe(0);
    expect(staleState.panelHeight).toBeGreaterThan(0);

    await page.evaluate((height) => {
        window.__barkKeyboardVisualHeight = height;
        window.__barkKeyboardViewport.dispatchEvent(new Event('resize'));
    }, fullHeight);
    await page.waitForFunction(() => (
        !document.body.classList.contains('keyboard-open')
        && !document.body.classList.contains('bark-keyboard-settling')
        && document.documentElement.dataset.barkNavContentLift === '0'
    ));
}

test('Galaxy-sized Android keeps the nav down through every app keyboard area', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'Android keyboard simulation runs in Chromium');
    const viewport = { width: 480, height: 1040 };
    const { context, page } = await openAndroidKeyboardShell(browser, viewport);
    try {
        const fixtures = await installVisibleKeyboardFixtures(page);
        expect(fixtures.missing).toEqual([]);
        expect(fixtures.fixtureIds).toHaveLength(STATIC_TEXT_ENTRY_IDS.length + 2);

        for (const fixtureId of fixtures.fixtureIds) {
            await runStaleKeyboardDismissal(page, fixtureId, viewport.height);
        }

        const finalGeometry = await page.evaluate(() => {
            const nav = document.getElementById('main-nav').getBoundingClientRect();
            return {
                lift: Number(document.documentElement.dataset.barkNavContentLift || 0),
                navBottom: nav.bottom,
                innerHeight: window.innerHeight
            };
        });
        expect(finalGeometry.lift).toBe(0);
        expect(finalGeometry.navBottom).toBeGreaterThanOrEqual(finalGeometry.innerHeight - 1);
    } finally {
        await context.close();
    }
});

test('Android with no final keyboard resize keeps the known-good nav position frozen', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'Android keyboard simulation runs in Chromium');
    const viewport = { width: 360, height: 640 };
    const { context, page } = await openAndroidKeyboardShell(browser, viewport);
    try {
        const fixtures = await installVisibleKeyboardFixtures(page);
        expect(fixtures.missing).toEqual([]);
        const fixtureId = fixtures.fixtureIds[0];

        await page.evaluate(({ id, height }) => {
            const input = document.getElementById(id);
            input.focus();
            window.__barkKeyboardVisualHeight = Math.round(height * 0.55);
            window.__barkKeyboardViewport.dispatchEvent(new Event('resize'));
        }, { id: fixtureId, height: viewport.height });
        await page.waitForFunction(() => document.body.classList.contains('keyboard-open'));
        await page.evaluate((id) => {
            document.getElementById(id).blur();
            window.__barkKeyboardViewport.dispatchEvent(new Event('resize'));
        }, fixtureId);

        await page.waitForTimeout(1350);
        const state = await page.evaluate(() => ({
            lift: Number(document.documentElement.dataset.barkNavContentLift || 0),
            settling: document.body.classList.contains('bark-keyboard-settling'),
            keyboardOpen: document.body.classList.contains('keyboard-open')
        }));
        expect(state).toEqual({ lift: 0, settling: true, keyboardOpen: false });
    } finally {
        await context.close();
    }
});

test('Android ignores the transient fixed-nav rectangle on the first restored keyboard frame', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'Android keyboard simulation runs in Chromium');
    const viewport = { width: 412, height: 844 };
    const { context, page } = await openAndroidKeyboardShell(browser, viewport);
    try {
        const fixtures = await installVisibleKeyboardFixtures(page);
        expect(fixtures.missing).toEqual([]);
        const fixtureId = fixtures.fixtureIds[0];

        await page.evaluate(({ id, height }) => {
            const input = document.getElementById(id);
            input.focus();
            window.__barkKeyboardVisualHeight = Math.round(height * 0.61);
            window.__barkKeyboardViewport.dispatchEvent(new Event('resize'));
        }, { id: fixtureId, height: viewport.height });
        await page.waitForFunction(() => document.body.classList.contains('keyboard-open'));

        await page.evaluate(({ id, height }) => {
            const root = document.documentElement;
            window.__barkTransientLiftMax = Number(root.dataset.barkNavContentLift || 0);
            window.__barkTransientLiftObserver = new MutationObserver(() => {
                window.__barkTransientLiftMax = Math.max(
                    window.__barkTransientLiftMax,
                    Number(root.dataset.barkNavContentLift || 0)
                );
            });
            window.__barkTransientLiftObserver.observe(root, {
                attributes: true,
                attributeFilter: ['data-bark-nav-content-lift']
            });

            document.getElementById(id).blur();
            const navContent = [...document.querySelectorAll(
                '#main-nav .nav-item svg, #main-nav .nav-item > span'
            )];
            const originalRects = navContent.map(element => element.getBoundingClientRect);
            navContent.forEach((element, index) => {
                const originalRect = originalRects[index];
                element.getBoundingClientRect = function transientKeyboardRect() {
                    const rect = originalRect.call(this);
                    return {
                        width: rect.width,
                        height: rect.height,
                        top: rect.top + 70,
                        bottom: rect.bottom + 70,
                        left: rect.left,
                        right: rect.right,
                        x: rect.x,
                        y: rect.y + 70
                    };
                };
            });

            window.__barkKeyboardVisualHeight = height;
            window.__barkKeyboardViewport.dispatchEvent(new Event('resize'));
            requestAnimationFrame(() => {
                navContent.forEach((element, index) => {
                    element.getBoundingClientRect = originalRects[index];
                });
            });
        }, { id: fixtureId, height: viewport.height });

        await page.waitForFunction(() => (
            !document.body.classList.contains('bark-keyboard-settling')
            && document.documentElement.dataset.barkNavContentLift === '0'
        ));
        await page.waitForTimeout(240);

        const state = await page.evaluate(() => {
            if (window.__barkTransientLiftObserver) window.__barkTransientLiftObserver.disconnect();
            const nav = document.getElementById('main-nav').getBoundingClientRect();
            return {
                maximumLift: window.__barkTransientLiftMax,
                finalLift: Number(document.documentElement.dataset.barkNavContentLift || 0),
                navBottom: nav.bottom,
                innerHeight: window.innerHeight
            };
        });
        expect(state.maximumLift).toBe(0);
        expect(state.finalLift).toBe(0);
        expect(state.navBottom).toBeGreaterThanOrEqual(state.innerHeight - 1);
    } finally {
        await context.close();
    }
});

const KEYBOARD_GEOMETRY_PROFILES = [
    { name: 'old-small-portrait', viewport: { width: 320, height: 568 } },
    { name: 'old-small-landscape', viewport: { width: 568, height: 320 } },
    { name: 'modern-phone-portrait', viewport: { width: 412, height: 915 } },
    { name: 'modern-phone-landscape', viewport: { width: 915, height: 412 } },
    { name: 's26-ultra-class-portrait', viewport: { width: 480, height: 1040 } },
    { name: 's26-ultra-class-landscape', viewport: { width: 1040, height: 480 } },
    { name: 'foldable-outer', viewport: { width: 320, height: 720 } },
    { name: 'foldable-inner', viewport: { width: 884, height: 1104 } }
];

for (const profile of KEYBOARD_GEOMETRY_PROFILES) {
    test(`${profile.name} recovers the nav after keyboard dismissal`, async ({ browser, browserName }) => {
        test.skip(browserName !== 'chromium', 'Android keyboard simulation runs in Chromium');
        const { context, page } = await openAndroidKeyboardShell(browser, profile.viewport);
        try {
            const fixtures = await installVisibleKeyboardFixtures(page);
            expect(fixtures.missing).toEqual([]);
            await runStaleKeyboardDismissal(page, fixtures.fixtureIds[0], profile.viewport.height);
            const state = await page.evaluate(() => ({
                lift: Number(document.documentElement.dataset.barkNavContentLift || 0),
                settling: document.body.classList.contains('bark-keyboard-settling')
            }));
            expect(state).toEqual({ lift: 0, settling: false });
        } finally {
            await context.close();
        }
    });
}
